// The ingredient view (plan 03, Phase 6): its queries, and the edits made
// from it (fields, one alias, "Fusionner dans…", Q25 B).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseIngredient, withPatch } from '../../src/lib/ingredients/registry';
import { commitPaths } from '../../src/lib/server/git';
import { addAlias, editEntry, ingredientView, mergeEntry, type EntryInput } from '../../src/lib/server/ingredient';
import { syncVault } from '../../src/lib/server/index/sync';
import { appendPrice } from '../../src/lib/server/prices';
import { linkKey, QueueError } from '../../src/lib/server/queue';
import { loadVocab } from '../../src/lib/server/vocab';
import { AUTHOR, fixtureVault, recipe, type TempVault } from '../helpers/vault';

let v: TempVault;
beforeEach(async () => {
	v = await fixtureVault();
});
afterEach(() => v.cleanup());

const view = (slug: string, on?: string) => ingredientView(v.ctx.db, slug, loadVocab(v.ctx.paths.vocab), on)!;
const hashOf = (slug: string) => v.ctx.db.prepare('SELECT file_hash FROM registry WHERE slug = ?').pluck().get(slug) as string;
const lastCommit = () => v.git('log', '-1', '--format=%s').trim();
const touched = () => v.git('show', '--name-status', '--format=', 'HEAD').trim().split('\n');
const lineItem = (slug: string, name: string) => v.ctx.db.prepare('SELECT item FROM ingredients WHERE slug = ? AND name = ?').pluck().get(slug, name);

function input(slug: string, patch: Partial<EntryInput> = {}): EntryInput {
	const e = view(slug).entry;
	return {
		names: e.names,
		category: e.category,
		defaultUnit: e.defaultUnit ?? '',
		staple: e.staple,
		auGout: e.auGout,
		density: e.density !== undefined ? String(e.density) : '',
		weights: Object.entries(e.weights).map(([unit, g]) => ({ unit, grams: String(g) })),
		substitutes: e.substitutes,
		allergens: e.allergens,
		...patch
	};
}

describe('the ingredient view', () => {
	it('is undefined for a slug not in the registry', () => {
		expect(ingredientView(v.ctx.db, 'nope', loadVocab(v.ctx.paths.vocab))).toBeUndefined();
	});

	it('lists the recipes by quantity used, converted to default_unit (cups through the density), with the vault total', () => {
		const f = view('farine');
		expect([f.unit, f.unitFrom]).toEqual(['g', 'default']);
		const amounts = f.uses.map((u) => u.amount!);
		expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
		// 1 cup of flour = 250 ml × 0.53 g/ml.
		expect(f.uses.find((u) => u.slug === 'crepes')!.amount).toBeCloseTo(132.5);
		expect(f.uses.find((u) => u.slug === 'lasagna-bolognaise')!.amount).toBe(50);
		expect(f.total.recipes).toBe(f.uses.length);
		expect(f.total.amount).toBeCloseTo(amounts.reduce((a, b) => a + b, 0));
		expect(f.total.unconverted).toBe(0);
	});

	it('puts quantities that do not convert after the rest, out of the total', () => {
		const s = view('sucre');
		const i = s.uses.findIndex((u) => u.amount === undefined);
		expect(i).toBeGreaterThan(0);
		expect(s.uses.slice(i).every((u) => u.amount === undefined)).toBe(true);
		expect(s.total.unconverted).toBe(s.uses.length - i);
		// A pinch has no weight for sugar: never estimated.
		expect(s.uses.find((u) => u.slug === 'sauce-tomate-maison')?.amount).toBeUndefined();
	});

	it('shows substitutes both ways and the unresolved names that drift towards it', () => {
		const t = view('tomates-concassees');
		expect(t.substitutes.map((s) => s.slug)).toEqual(['tomates-fraiches', 'coulis-de-tomate']);
		expect(t.substituteFor.map((s) => s.slug)).toEqual(['tomates-fraiches']);
		expect(t.drift.map((d) => d.key)).toContain('tomates');
		// An ambiguous name shows on each of its owners.
		expect(view('huile-vegetale').drift.find((d) => d.key === 'huile')).toMatchObject({ ambiguous: true });
	});

	it('prices: history oldest first, the change of the unit price from the previous row, the current one, staleness', async () => {
		await appendPrice(v.ctx, { ingredient: 'tomates-concassees', amount: 1.99, packQty: 796, packUnit: 'ml', date: '2026-09-27' });
		await appendPrice(v.ctx, { ingredient: 'tomates-concassees', amount: 1.78, packQty: 800, packUnit: 'g', date: '2026-09-28' });
		const t = view('tomates-concassees', '2026-10-01');
		expect(t.history.map((h) => [h.amount, h.current])).toEqual([
			[0.89, false],
			[1.99, false],
			[1.78, true]
		]);
		// g against ml: no density for canned tomatoes, so no comparison.
		expect(t.history[1].change).toBeUndefined();
		// 1.78 / 800 g against 1.99 / 796 ml: still not comparable.
		expect(t.history[2].change).toBeUndefined();
		await appendPrice(v.ctx, { ingredient: 'tomates-concassees', amount: 0.98, packQty: 400, packUnit: 'g', date: '2026-09-29' });
		const u = view('tomates-concassees', '2026-10-01');
		// 0.98 / 400 g against 1.78 / 800 g: +10 %.
		expect(u.history.at(-1)!.change).toBeCloseTo(0.1);
		expect(u.current).toMatchObject({ amount: 0.98, stale: false });
		expect(view('tomates-concassees', '2027-10-01').current!.stale).toBe(true);
	});
});

describe('editing from the view', () => {
	it('adds an alias: the recipes writing it resolve, one commit, no recipe file touched', async () => {
		expect(lineItem('lasagna-courgettes', 'feuilles de lasagne')).toBeNull();
		await addAlias(v.ctx, 'pates-alimentaires', hashOf('pates-alimentaires'), 'fr', 'feuilles  de lasagne');
		expect(lineItem('lasagna-courgettes', 'feuilles de lasagne')).toBe('pates-alimentaires');
		expect(lastCommit()).toBe('ingredient: pates-alimentaires + "feuilles de lasagne"');
		expect(touched()).toEqual(['M\tingredients/pates-alimentaires.md']);
		await expect(addAlias(v.ctx, 'pates-alimentaires', hashOf('pates-alimentaires'), 'fr', 'Feuilles de lasagne')).rejects.toThrow(/déjà un nom/);
	});

	it('refuses an edit based on a file that changed since the page was opened', async () => {
		const old = hashOf('sucre');
		await addAlias(v.ctx, 'sucre', old, 'fr', 'sucre granulé');
		await expect(addAlias(v.ctx, 'sucre', old, 'fr', 'sucre blanc')).rejects.toThrow(/a changé/);
		await expect(editEntry(v.ctx, 'sucre', old, input('sucre', { staple: false }))).rejects.toThrow(/a changé/);
	});

	it('saves the fields in place, keeping comments and notes; the index follows', async () => {
		const p = join(v.dir, 'ingredients/tomates-concassees.md');
		writeFileSync(p, readFileSync(p, 'utf8').replace('category: conserve', '# boîtes\ncategory: conserve'));
		await commitPaths(v.dir, ['ingredients'], 'comment', AUTHOR);
		syncVault(v.ctx.db, v.ctx.paths);
		await editEntry(
			v.ctx,
			'tomates-concassees',
			hashOf('tomates-concassees'),
			input('tomates-concassees', {
				density: '1,05',
				weights: [
					{ unit: 'can', grams: '796' },
					{ unit: '', grams: '' }
				],
				allergens: ['sulfites'],
				names: { fr: ['tomates concassées', 'tomates en dés'], en: [] },
				substitutes: ['coulis-de-tomate']
			})
		);
		expect(lastCommit()).toBe('ingredient: edit tomates-concassees');
		const text = readFileSync(p, 'utf8');
		expect(text).toContain('# boîtes');
		expect(text).toContain('Boîte de 400 g standard.');
		expect(text).toContain('density: 1.05');
		expect(text).toContain('weights: {can: 796}');
		const e = parseIngredient(text, { fileStem: 'tomates-concassees' }).entry!;
		expect(e).toMatchObject({ density: 1.05, weights: { can: 796 }, allergens: ['sulfites'], substitutes: ['coulis-de-tomate'], names: { fr: ['tomates concassées', 'tomates en dés'], en: [] } });
		const w = view('tomates-concassees');
		expect(w.entry.density).toBe(1.05);
		expect(w.substituteFor.map((s) => s.slug)).toEqual(['tomates-fraiches']);
		// Removing an alias unresolves the lines using it.
		expect(v.ctx.db.prepare("SELECT count(*) FROM ingredients WHERE key = 'pulpe de tomate' AND item IS NOT NULL").pluck().get()).toBe(0);
	});

	it('refuses what would not pass the check, and a save that changes nothing', async () => {
		const h = hashOf('sel');
		await expect(editEntry(v.ctx, 'sel', h, input('sel'))).rejects.toThrow(/rien n’a changé/);
		await expect(editEntry(v.ctx, 'sel', h, input('sel', { density: '-1' }))).rejects.toThrow(/densité/);
		await expect(editEntry(v.ctx, 'sel', h, input('sel', { substitutes: ['nope'] }))).rejects.toThrow(/substitut inconnu/);
		await expect(editEntry(v.ctx, 'sel', h, input('sel', { substitutes: ['sel'] }))).rejects.toThrow(/substitut inconnu/);
		await expect(editEntry(v.ctx, 'sel', h, input('sel', { allergens: ['plutonium'] }))).rejects.toThrow(/allergène/);
		await expect(editEntry(v.ctx, 'sel', h, input('sel', { names: { fr: [' '], en: [] } }))).rejects.toThrow(/au moins un nom/);
		await expect(editEntry(v.ctx, 'sel', h, input('sel', { weights: [{ unit: 'piece', grams: 'x' }] }))).rejects.toThrow(/poids/);
		expect(lastCommit()).toBe('fixtures');
	});

	it('"Relier ici" links a drifting name to this entry', async () => {
		await linkKey(v.ctx, 'tomates', 'tomates-concassees', hashOf('tomates-concassees'));
		expect(view('tomates-concassees').drift.map((d) => d.key)).not.toContain('tomates');
		expect(lastCommit()).toBe('ingredient: tomates-concassees + "tomates"');
	});
});

describe('Fusionner dans… (Q25 B)', () => {
	it('moves names, rules, substitutes and allergens, rewrites substitute links, deletes the file: one commit', async () => {
		const p = join(v.dir, 'ingredients/tomates-fraiches.md');
		writeFileSync(p, withPatch(readFileSync(p, 'utf8'), { allergens: ['sulfites'], addRules: [{ names: ['tomates'], unit: ['count'] }] }));
		await commitPaths(v.dir, ['ingredients'], 'setup', AUTHOR);
		syncVault(v.ctx.db, v.ctx.paths);
		const names = view('tomates-fraiches').entry.names;
		await mergeEntry(v.ctx, 'tomates-fraiches', 'coulis-de-tomate', hashOf('tomates-fraiches'), hashOf('coulis-de-tomate'));
		expect(lastCommit()).toBe('ingredient: merge tomates-fraiches into coulis-de-tomate');
		expect(touched().sort()).toEqual(['D\tingredients/tomates-fraiches.md', 'M\tingredients/coulis-de-tomate.md', 'M\tingredients/tomates-concassees.md']);
		expect(existsSync(p)).toBe(false);
		const c = view('coulis-de-tomate').entry;
		for (const n of names.fr) expect(c.names.fr.map((x) => x.toLowerCase())).toContain(n.toLowerCase());
		expect(c.when).toEqual([{ names: ['tomates'], unit: ['count'] }]);
		expect(c.allergens).toContain('sulfites');
		expect(c.substitutes).toEqual(['tomates-concassees']);
		expect(view('tomates-concassees').entry.substitutes).toEqual(['coulis-de-tomate']);
		expect(v.ctx.db.prepare("SELECT count(*) FROM ingredients WHERE item = 'tomates-fraiches'").pluck().get()).toBe(0);
		expect(v.ctx.db.prepare('SELECT count(*) FROM registry_problems').pluck().get()).toBe(
			v.ctx.db.prepare("SELECT count(*) FROM registry_problems WHERE diagnostics NOT LIKE '%tomates-fraiches%'").pluck().get()
		);
	});

	it('the recipes using the absorbed entry resolve to the target', async () => {
		const before = v.ctx.db.prepare("SELECT slug, position FROM ingredients WHERE item = 'margarine'").all();
		await mergeEntry(v.ctx, 'margarine', 'beurre', hashOf('margarine'), hashOf('beurre'));
		for (const r of before as { slug: string; position: number }[])
			expect(v.ctx.db.prepare('SELECT item FROM ingredients WHERE slug = ? AND position = ?').pluck().get(r.slug, r.position)).toBe('beurre');
		// Each listed the other: after the merge, neither itself nor the absorbed one.
		expect(view('beurre').entry.substitutes).toEqual([]);
		expect(view('beurre').entry.names.fr).toContain('margarine');
	});

	it('is refused when prices.csv has rows for the absorbed entry, or a recipe names it in item:', async () => {
		await expect(mergeEntry(v.ctx, 'oeuf', 'beurre', hashOf('oeuf'))).rejects.toThrow(/prices\.csv/);
		writeFileSync(join(v.dir, 'recipes/override.md'), recipe('Override', '', '## Préparation\n\n1. Mélanger.\n').replace('name: farine }', 'name: farine, item: cassonade }'));
		await commitPaths(v.dir, ['recipes'], 'override', AUTHOR);
		syncVault(v.ctx.db, v.ctx.paths);
		await expect(mergeEntry(v.ctx, 'cassonade', 'sucre', hashOf('cassonade'))).rejects.toThrow(/item: » \(override\)/);
		await expect(mergeEntry(v.ctx, 'sucre', 'sucre', hashOf('sucre'))).rejects.toThrow(QueueError);
		await expect(mergeEntry(v.ctx, 'sucre', 'nope', hashOf('sucre'))).rejects.toThrow(/n’existe pas/);
		expect(existsSync(join(v.dir, 'ingredients/oeuf.md'))).toBe(true);
		expect(lastCommit()).toBe('override');
	});

	it('is refused on a stale page', async () => {
		const old = hashOf('margarine');
		await addAlias(v.ctx, 'margarine', old, 'fr', 'margarine molle');
		await expect(mergeEntry(v.ctx, 'margarine', 'beurre', old)).rejects.toThrow(/a changé/);
	});
});
