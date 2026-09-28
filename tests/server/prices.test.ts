import { appendFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ingredientIndex } from '../../src/lib/server/ingredients';
import { syncVault } from '../../src/lib/server/index/sync';
import { appendPrice, currentPricesOf, knownShops, PriceError, priceProblems, syncPrices } from '../../src/lib/server/prices';
import { Watcher } from '../../src/lib/server/watcher';
import { fixtureVault, type TempVault } from '../helpers/vault';

let v: TempVault;
beforeEach(async () => {
	v = await fixtureVault();
});
afterEach(() => v.cleanup());

const lastCommit = () => v.git('log', '-1', '--format=%s').trim();
const touched = () => v.git('show', '--name-only', '--format=', 'HEAD').trim().split('\n');
const lines = () => v.read('prices.csv').trimEnd().split('\n');

describe('prices in the index', () => {
	it('loads prices.csv at sync; the current price is the latest row', () => {
		const cur = currentPricesOf(v.ctx.db, ['tomates-concassees', 'oeuf', 'farine']);
		expect(cur.get('tomates-concassees')).toMatchObject({ amount: 0.89, packQty: 400, packUnit: 'g', shop: 'IGA' });
		expect(cur.has('farine')).toBe(false);
		expect(priceProblems(v.ctx.db, 'CAD')).toEqual([]);
		// Unchanged file: skipped.
		expect(syncPrices(v.ctx.db, v.ctx.paths, 'CAD').changed).toBe(false);
	});

	it('reports bad lines and unknown slugs; creating the entry clears its warning', () => {
		appendFileSync(join(v.dir, 'prices.csv'), '2026-09-27,farine,abc,CAD,1,kg,,\n2026-09-27,sirop-invente,7.99,CAD,540,ml,,\n');
		const r = syncVault(v.ctx.db, v.ctx.paths);
		expect(r.prices).toMatchObject({ changed: true, rows: 3, skipped: 1 });
		expect(priceProblems(v.ctx.db, 'CAD').map((p) => [p.code, p.line])).toEqual([
			['E813', 4],
			['W814', 5]
		]);
		writeFileSync(join(v.dir, 'ingredients/sirop-invente.md'), '---\nslug: sirop-invente\ncategory: epicerie\nnames:\n  fr: [sirop inventé]\n---\n');
		syncVault(v.ctx.db, v.ctx.paths);
		expect(priceProblems(v.ctx.db, 'CAD').map((p) => p.code)).toEqual(['E813']);
	});

	it('a row in another currency is shown but not current; changing the currency reloads', () => {
		appendFileSync(join(v.dir, 'prices.csv'), '2026-09-27,tomates-concassees,0.79,USD,400,g,,\n');
		syncVault(v.ctx.db, v.ctx.paths);
		expect(currentPricesOf(v.ctx.db, ['tomates-concassees']).get('tomates-concassees')?.amount).toBe(0.89);
		expect(priceProblems(v.ctx.db, 'CAD').map((p) => p.code)).toEqual(['W815']);
		const r = syncVault(v.ctx.db, v.ctx.paths, { currency: 'USD' });
		expect(r.prices.changed).toBe(true);
		expect(currentPricesOf(v.ctx.db, ['tomates-concassees']).get('tomates-concassees')?.amount).toBe(0.79);
	});

	it('a vault without prices.csv has no prices', () => {
		rmSync(join(v.dir, 'prices.csv'));
		expect(syncVault(v.ctx.db, v.ctx.paths).prices).toEqual({ rows: 0, changed: true, skipped: 0 });
		expect(v.ctx.db.prepare('SELECT count(*) FROM current_price').pluck().get()).toBe(0);
	});
});

describe('appendPrice', () => {
	it('appends one line and commits only prices.csv, as `price: <slug> <amount> / <pack>`', async () => {
		const before = lines().length;
		const { row, commit } = await appendPrice(v.ctx, { ingredient: 'farine', amount: 4.99, packQty: 2.5, packUnit: 'kg', shop: 'Épicerie Aubin', date: '2026-09-27' });
		expect(commit).toMatch(/^[0-9a-f]{40}$/);
		expect(lastCommit()).toBe('price: farine 4.99 / 2.5 kg');
		expect(touched()).toEqual(['prices.csv']);
		expect(lines()).toHaveLength(before + 1);
		expect(lines().at(-1)).toBe('2026-09-27,farine,4.99,CAD,2.5,kg,Épicerie Aubin,');
		expect(row.line).toBe(before + 1);
		expect(currentPricesOf(v.ctx.db, ['farine']).get('farine')).toMatchObject({ amount: 4.99, line: before + 1 });
		expect(v.git('status', '--porcelain').trim()).toBe('');
		// The app's own write is not an outside edit.
		expect(v.ctx.ownWrites.has('prices.csv')).toBe(true);
		expect(knownShops(v.ctx.db, ['Marché inventé'])).toEqual(['IGA', 'Épicerie Aubin', 'Marché inventé']);
	});

	it('creates prices.csv with its header in a vault without one', async () => {
		rmSync(join(v.dir, 'prices.csv'));
		v.git('commit', '-qam', 'rm');
		await appendPrice(v.ctx, { ingredient: 'sel', amount: 1.29, packQty: 1, packUnit: 'kg' });
		expect(lines()[0]).toBe('date,ingredient,amount,currency,pack_qty,pack_unit,shop,note');
		expect(lines()).toHaveLength(2);
		expect(lines()[1]).toMatch(/^\d{4}-\d{2}-\d{2},sel,1.29,CAD,1,kg,,$/);
	});

	it('refuses an unknown ingredient, a bad amount, pack or date, and changes nothing', async () => {
		const text = v.read('prices.csv');
		const base = { ingredient: 'farine', amount: 1, packQty: 1, packUnit: 'kg' };
		await expect(appendPrice(v.ctx, { ...base, ingredient: 'nexiste-pas' })).rejects.toThrow(PriceError);
		await expect(appendPrice(v.ctx, { ...base, amount: NaN })).rejects.toThrow(/montant/);
		await expect(appendPrice(v.ctx, { ...base, packQty: 0 })).rejects.toThrow(/format/);
		await expect(appendPrice(v.ctx, { ...base, packUnit: 'livre' })).rejects.toThrow(/unité/);
		await expect(appendPrice(v.ctx, { ...base, date: '27/09/2026' })).rejects.toThrow(/AAAA-MM-JJ/);
		expect(v.read('prices.csv')).toBe(text);
	});

	it('puts the file back when the commit fails', async () => {
		const text = v.read('prices.csv');
		writeFileSync(join(v.dir, '.git/index.lock'), '');
		try {
			await expect(appendPrice(v.ctx, { ingredient: 'farine', amount: 4.99, packQty: 2.5, packUnit: 'kg' })).rejects.toThrow(/rien n’a changé/);
		} finally {
			rmSync(join(v.dir, '.git/index.lock'), { force: true });
		}
		expect(v.read('prices.csv')).toBe(text);
		expect(v.ctx.ownWrites.has('prices.csv')).toBe(false);
		expect(currentPricesOf(v.ctx.db, ['farine']).has('farine')).toBe(false);
		expect(v.git('status', '--porcelain').trim()).toBe('');
	});
});

describe('the ingredient index', () => {
	const slugs = (f: Parameters<typeof ingredientIndex>[1] = {}) => ingredientIndex(v.ctx.db, f, '2026-09-27').map((r) => r.slug);

	it('by default: unpriced first, the most used first, then the name', () => {
		const rows = ingredientIndex(v.ctx.db, {}, '2026-09-27');
		const firstPriced = rows.findIndex((r) => r.price);
		expect(firstPriced).toBeGreaterThan(0);
		expect(rows.slice(firstPriced).every((r) => r.price)).toBe(true);
		const unpriced = rows.slice(0, firstPriced).map((r) => r.recipes);
		expect(unpriced).toEqual([...unpriced].sort((a, b) => b - a));
		expect(rows[0].recipes).toBeGreaterThan(0);
		const tomates = rows.find((r) => r.slug === 'tomates-concassees')!;
		expect(tomates.price).toMatchObject({ amount: 0.89, packQty: 400, packUnit: 'g', shop: 'IGA', date: '2026-09-26', stale: false });
	});

	it('sorts by name, category, recipes, price date, and in reverse', () => {
		const byName = ingredientIndex(v.ctx.db, { sort: 'nom' }).map((r) => r.name);
		expect(byName).toEqual([...byName].sort(new Intl.Collator('fr', { sensitivity: 'base' }).compare));
		expect(slugs({ sort: 'nom', reverse: true })).toEqual(slugs({ sort: 'nom' }).reverse());
		const cats = ingredientIndex(v.ctx.db, { sort: 'categorie' }).map((r) => r.category);
		expect(cats).toEqual([...cats].sort());
		const counts = ingredientIndex(v.ctx.db, { sort: 'recettes' }).map((r) => r.recipes);
		expect(counts).toEqual([...counts].sort((a, b) => b - a));
		expect(slugs({ sort: 'date' }).slice(0, 2)).toEqual(['oeuf', 'tomates-concassees']);
	});

	it('filters by category, priced, staple and text', () => {
		expect(ingredientIndex(v.ctx.db, { category: 'conserve' }).every((r) => r.category === 'conserve')).toBe(true);
		expect(slugs({ priced: true }).sort()).toEqual(['oeuf', 'tomates-concassees']);
		expect(slugs({ priced: false })).not.toContain('oeuf');
		expect(ingredientIndex(v.ctx.db, { staple: true }).every((r) => r.staple)).toBe(true);
		// Any alias, folded.
		expect(slugs({ q: 'tomatoes' })).toContain('tomates-concassees');
		expect(slugs({ q: 'OEUF' })).toContain('oeuf');
	});

	it('flags a price more than a year old', () => {
		expect(ingredientIndex(v.ctx.db, { priced: true }, '2027-09-27').every((r) => r.price!.stale)).toBe(true);
	});
});

describe('watcher', () => {
	it('reloads prices.csv edited outside the app, then commits it', async () => {
		const w = new Watcher(v.ctx, { debounceMs: 20 });
		w.start();
		try {
			appendFileSync(join(v.dir, 'prices.csv'), '2026-09-27,farine,4.49,CAD,2.5,kg,,\n');
			await new Promise((r) => setTimeout(r, 10));
			await w.idle();
		} finally {
			w.stop();
		}
		expect(currentPricesOf(v.ctx.db, ['farine']).get('farine')?.amount).toBe(4.49);
		expect(lastCommit()).toBe('edit (external): prices.csv');
	});
});
