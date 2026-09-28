import { appendFileSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openIndex } from '../../src/lib/server/index/db';
import { browse, familyDiff, families, ftsQuery, getRecipe, usedBy } from '../../src/lib/server/index/query';
import { SCHEMA_VERSION } from '../../src/lib/server/index/schema';
import { syncVault } from '../../src/lib/server/index/sync';
import { Watcher } from '../../src/lib/server/watcher';
import { save } from '../../src/lib/server/save';
import { fixtureVault, recipe, type TempVault } from '../helpers/vault';

let v: TempVault;
beforeEach(async () => {
	v = await fixtureVault();
});
afterEach(() => v.cleanup());

const slugs = (r: { items: { slug: string }[] }) => r.items.map((i) => i.slug);

describe('sync', () => {
	it('indexes every fixture, then skips unchanged files', () => {
		const n = (v.ctx.db.prepare('SELECT count(*) FROM recipes').pluck().get() as number);
		expect(n).toBe(22);
		const again = syncVault(v.ctx.db, v.ctx.paths);
		expect(again).toMatchObject({ scanned: 22, indexed: 0, unchanged: 22, removed: 0, problems: [] });
		const forced = syncVault(v.ctx.db, v.ctx.paths, { force: true });
		expect(forced.indexed).toBe(22);
	});

	it('keeps the last good rows of a file that stops parsing, flagged with its codes', () => {
		const file = join(v.dir, 'recipes/crepes.md');
		writeFileSync(file, readFileSync(file, 'utf8').replace('unit: cup', 'unit: tasse'));
		const r = syncVault(v.ctx.db, v.ctx.paths);
		expect(r.problems).toEqual([{ file: 'recipes/crepes.md', codes: ['E201'] }]);
		const d = getRecipe(v.ctx.db, 'crepes')!;
		expect(d.recipe.title).toBe('Crêpes minces');
		expect(d.broken?.map((b) => b.code)).toEqual(['E201']);
		expect(slugs(browse(v.ctx.db, { q: 'crepes' }))).toEqual(['crepes']);
	});

	it('drops rows whose file is gone, and flags a slug that does not match its file', () => {
		unlinkSync(join(v.dir, 'recipes/crepes.md'));
		writeFileSync(join(v.dir, 'recipes/autre-nom.md'), recipe('Galette', 'slug: galette\n'));
		const r = syncVault(v.ctx.db, v.ctx.paths);
		expect(r.removed).toBe(1);
		expect(r.problems).toEqual([{ file: 'recipes/autre-nom.md', codes: ['E113'] }]);
		expect(getRecipe(v.ctx.db, 'crepes')).toBeUndefined();
	});

	it('loses nothing when cache/ is deleted', () => {
		v.ctx.db.close();
		rmSync(join(v.dir, 'cache'), { recursive: true });
		const { db, fresh } = openIndex(join(v.dir, 'cache/index.db'));
		expect(fresh).toBe(true);
		expect(syncVault(db, v.ctx.paths).indexed).toBe(22);
		expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
		v.ctx.db = db;
	});

	it('rebuilds an index from another schema version', () => {
		v.ctx.db.pragma('user_version = 999');
		v.ctx.db.close();
		const { db, fresh } = openIndex(join(v.dir, 'cache/index.db'));
		expect(fresh).toBe(true);
		expect(db.prepare('SELECT count(*) FROM recipes').pluck().get()).toBe(0);
		v.ctx.db = db;
	});
});

describe('search and browse', () => {
	it('builds prefix queries from folded words', () => {
		expect(ftsQuery('Lasag  bœuf!')).toBe('"lasag"* "boeuf"*');
		expect(ftsQuery('  ')).toBeUndefined();
	});

	it('is accent- and ligature-insensitive, prefix-matching, across title, ingredients, body, author', () => {
		expect(slugs(browse(v.ctx.db, { q: 'boeuf' }))).toContain('lasagna-bolognaise'); // bœuf haché
		expect(slugs(browse(v.ctx.db, { q: 'bœuf' }))).toContain('pate-chinois'); // boeuf haché
		expect(slugs(browse(v.ctx.db, { q: 'creme' }))).toContain('sucre-a-la-creme');
		expect(slugs(browse(v.ctx.db, { q: 'lasag' })).sort()).toEqual(['lasagna-bolognaise', 'lasagna-courgettes', 'lasagna-epinards-ricotta']);
		expect(slugs(browse(v.ctx.db, { q: 'ricotta' }))).toEqual(['lasagna-epinards-ricotta']);
		expect(slugs(browse(v.ctx.db, { q: 'firmin' }))).toEqual(['lasagna-epinards-ricotta']);
		expect(slugs(browse(v.ctx.db, { q: 'ecumant' }))).toEqual(['soupe-aux-pois']);
		expect(browse(v.ctx.db, { q: 'zzzz' }).total).toBe(0);
	});

	it('ranks title matches first', () => {
		expect(slugs(browse(v.ctx.db, { q: 'pizza' }))[0]).toMatch(/pizza/);
	});

	it('filters by facets and counts each facet without its own filter', () => {
		const r = browse(v.ctx.db, { family: 'lasagna' });
		expect(r.total).toBe(3);
		expect(r.facets.family.find((f) => f.value === 'tarte-aux-pommes')?.count).toBe(2);
		expect(r.facets.tags.find((t) => t.value === 'vegetarien')?.count).toBe(2);
		expect(browse(v.ctx.db, { family: 'lasagna', tags: ['vegetarien', 'four'] }).total).toBe(2);
		expect(browse(v.ctx.db, { season: 'hiver' }).total).toBeGreaterThan(2);
		expect(slugs(browse(v.ctx.db, { status: 'verified', family: 'lasagna' }))).toEqual(['lasagna-epinards-ricotta']);
		expect(browse(v.ctx.db, { time: '30' }).items.every((c) => c.total_s !== null && c.total_s <= 1800)).toBe(true);
		expect(browse(v.ctx.db, { servings: '7+' }).items.every((c) => (c.servings ?? 0) >= 7)).toBe(true);
	});

	it('maps tag aliases to canonical tags and marks unknown ones pending', () => {
		const all = browse(v.ctx.db, {}).facets.tags;
		expect(all.find((t) => t.value === 'quebecois')?.pending).toBe(false);
		expect(all.find((t) => t.value === 'cabane-a-sucre')?.pending).toBe(true); // not in the seed vocabulary
	});

	it('sorts and paginates', () => {
		const p1 = browse(v.ctx.db, { sort: 'title', pageSize: 5 });
		expect(p1.pages).toBe(5);
		expect(p1.items).toHaveLength(5);
		const p5 = browse(v.ctx.db, { sort: 'title', pageSize: 5, page: 5 });
		expect(p5.items).toHaveLength(2);
		const time = browse(v.ctx.db, { sort: 'time', pageSize: 100 }).items.map((c) => c.total_s).filter((t) => t !== null) as number[];
		expect(time).toEqual([...time].sort((a, b) => a - b));
		expect(browse(v.ctx.db, { sort: 'rating' }).items[0].slug).toMatch(/pate-chinois|pouding-chomeur|lasagna-bolognaise/);
	});
});

describe('families', () => {
	it('lists families with variant counts', () => {
		expect(families(v.ctx.db)).toEqual([
			{ slug: 'lasagna', label: null, count: 3 },
			{ slug: 'tarte-aux-pommes', label: null, count: 2 }
		]);
	});

	it('computes the diff table', () => {
		const d = familyDiff(v.ctx.db, 'lasagna')!;
		expect(d.variants.map((x) => x.slug)).toHaveLength(3);
		expect(d.common).toEqual(expect.arrayContaining(['ail', 'feuilles de lasagne', 'tomates concassées']));
		expect(d.unique['lasagna-epinards-ricotta']).toEqual(expect.arrayContaining(['ricotta', 'épinards']));
		expect(d.unique['lasagna-bolognaise']).toContain('bœuf haché');
		expect(d.differs).toMatchObject({ servings: true, total_s: true });
	});

	it('knows which recipes use a sub-recipe', () => {
		expect(usedBy(v.ctx.db, 'pate-brisee').map((r) => r.slug).sort()).toEqual([
			'tarte-au-sucre',
			'tarte-aux-pommes-grand-mere',
			'tarte-aux-pommes-streusel'
		]);
	});
});

describe('watcher', () => {
	it('commits an outside edit, flags a broken one without committing, ignores the app’s own writes', async () => {
		const seen: string[] = [];
		const w = new Watcher(v.ctx, { debounceMs: 30, onHandled: (rel, o) => seen.push(`${rel}:${o}`) });
		w.start();
		try {
			const file = join(v.dir, 'recipes/crepes.md');
			// Several writes in a row, like an editor saving: one handled change.
			writeFileSync(file, readFileSync(file, 'utf8').replace('Crêpes minces', 'Crêpes fines'));
			appendFileSync(file, '\nUne note de plus.\n');
			await new Promise((r) => setTimeout(r, 10));
			await w.idle();
			expect(seen).toEqual(['recipes/crepes.md:committed']);
			expect(v.git('log', '-1', '--format=%s').trim()).toBe('edit (external): Crêpes fines');
			expect(getRecipe(v.ctx.db, 'crepes')?.recipe.title).toBe('Crêpes fines');

			seen.length = 0;
			writeFileSync(file, readFileSync(file, 'utf8').replace('unit: cup', 'unit: tasse'));
			await new Promise((r) => setTimeout(r, 10));
			await w.idle();
			expect(seen).toEqual(['recipes/crepes.md:flagged']);
			expect(v.git('log', '-1', '--format=%s').trim()).toBe('edit (external): Crêpes fines');
			expect(getRecipe(v.ctx.db, 'crepes')?.broken?.[0].code).toBe('E201');
			expect(browse(v.ctx.db, { q: 'crepes fines' }).total).toBe(1);

			seen.length = 0;
			await save(v.ctx, [{ text: recipe('Nouvelle recette') }]);
			await new Promise((r) => setTimeout(r, 10));
			await w.idle();
			expect(seen).toEqual(['recipes/nouvelle-recette.md:ignored']);
			expect(v.git('log', '-1', '--format=%s').trim()).toBe('add: Nouvelle recette');
		} finally {
			w.stop();
		}
	});
});
