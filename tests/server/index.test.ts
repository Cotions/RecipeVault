import { appendFileSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openIndex } from '../../src/lib/server/index/db';
import { browse, familyDiff, familyName, familyNames, families, ftsQuery, getRecipe, photoTiles, usedBy } from '../../src/lib/server/index/query';
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

	it('says why a result matched when its title does not', () => {
		const one = (q: string, slug: string) => browse(v.ctx.db, { q }).items.find((c) => c.slug === slug)!;
		expect(one('lasag', 'lasagna-bolognaise').match).toBeUndefined();
		expect(one('ricotta', 'lasagna-epinards-ricotta').match).toBeUndefined();
		expect(one('firmin', 'lasagna-epinards-ricotta').match).toEqual({ field: 'author', texts: ['Oncle Firmin'] });
		expect(one('boeuf', 'pate-chinois').match).toMatchObject({ field: 'ingredients' });
		const m = one('ecumant', 'soupe-aux-pois').match;
		expect(m).toMatchObject({ field: 'body', section: 'Préparation' });
		expect(m?.texts[0]).toContain('écumant');
		expect(browse(v.ctx.db, { q: 'ecumant' }).terms).toEqual(['ecumant']);
	});

	it('gives a title-sorted list its letter index', () => {
		const r = browse(v.ctx.db, { sort: 'title', pageSize: 5 });
		expect(r.letters).toHaveLength(26);
		const used = r.letters!.filter((l) => l.count);
		expect(used.reduce((n, l) => n + l.count, 0)).toBe(r.total);
		const l = r.letters!.find((x) => x.letter === 'L')!;
		expect(l.count).toBeGreaterThanOrEqual(3);
		// The page its first recipe is on: that page holds it, the page before holds none.
		const onPage = (n: number) => browse(v.ctx.db, { sort: 'title', pageSize: 5, page: n }).items;
		expect(onPage(l.page).some((c) => c.initial === 'L')).toBe(true);
		if (l.page > 1) expect(onPage(l.page - 1).some((c) => c.initial === 'L')).toBe(false);
		// Every recipe on exactly one page, with each page's guide words.
		const all = Array.from({ length: r.pages }, (_, i) => onPage(i + 1).map((c) => c.slug)).flat();
		expect(new Set(all).size).toBe(r.total);
		expect(r.guides).toHaveLength(r.pages);
		expect(r.letters!.find((x) => x.count === 0)?.page).toBe(0);
		expect(browse(v.ctx.db, { sort: 'added' }).letters).toBeNull();
		expect(browse(v.ctx.db, { q: 'lasag' }).letters).toBeNull();
	});

	it('ranks title matches first', () => {
		expect(slugs(browse(v.ctx.db, { q: 'pizza' }))[0]).toMatch(/pizza/);
	});

	it('lists every result whose title holds all the words before the others, and counts them', () => {
		let both = 0;
		for (const q of ['boeuf', 'creme', 'tomate', 'lasag', 'oignon', 'sucre']) {
			const r = browse(v.ctx.db, { q, pageSize: 100 });
			const flags = r.items.map((c) => c.in_title);
			expect(flags.every((f) => typeof f === 'boolean')).toBe(true);
			expect(r.titleHits).toBe(flags.filter(Boolean).length);
			// No title hit after the first other one.
			expect(flags.slice(flags.indexOf(false) < 0 ? flags.length : flags.indexOf(false)).some(Boolean)).toBe(false);
			if (r.titleHits && r.titleHits < r.total) both++;
		}
		expect(both).toBeGreaterThan(0);
		expect(browse(v.ctx.db, { q: 'lasag', sort: 'title' }).titleHits).toBeNull();
		expect(browse(v.ctx.db, {}).titleHits).toBeNull();
		expect(browse(v.ctx.db, {}).items[0].in_title).toBeUndefined();
	});

	it('gives each card its tags, in the vocabulary’s order then by name', () => {
		const order = ['plat-principal', 'vegetarien', 'four'];
		const cards = browse(v.ctx.db, { family: 'lasagna' }, { tagOrder: order }).items;
		expect(cards.every((c) => c.tags.length > 0)).toBe(true);
		for (const c of cards) {
			const known = c.tags.filter((t) => order.includes(t));
			expect(known).toEqual([...known].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
			expect(c.tags.slice(0, known.length)).toEqual(known);
			const rest = c.tags.slice(known.length);
			expect(rest).toEqual([...rest].sort());
		}
		const plain = browse(v.ctx.db, { family: 'lasagna' }).items;
		for (const c of plain) expect(c.tags).toEqual([...c.tags].sort());
		// A list that shows no tags does not fetch them.
		expect(browse(v.ctx.db, { family: 'lasagna' }, { withTags: false }).items.every((c) => c.tags.length === 0)).toBe(true);
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

	it('lists the recipes with a photo for the home page’s strip, newest first', () => {
		const tiles = photoTiles(v.ctx.db);
		expect(tiles.map((x) => x.slug)).toEqual(['muffins-bleuets']);
		expect(tiles[0].photo).toBe('final.jpg');
		writeFileSync(join(v.dir, 'recipes', 'tarte-en-photo.md'), recipe('Tarte en photo', 'media:\n  final: final.jpg\nadded: 2099-01-01\n'));
		syncVault(v.ctx.db, v.ctx.paths);
		expect(photoTiles(v.ctx.db).map((x) => x.slug)).toEqual(['tarte-en-photo', 'muffins-bleuets']);
		expect(photoTiles(v.ctx.db, 1)).toHaveLength(1);
	});

	it('sorts and paginates', () => {
		const p1 = browse(v.ctx.db, { sort: 'added', pageSize: 5 });
		expect(p1.pages).toBe(5);
		expect(p1.items).toHaveLength(5);
		const p5 = browse(v.ctx.db, { sort: 'added', pageSize: 5, page: 5 });
		expect(p5.items).toHaveLength(2);
		// By title, a page breaks where a letter changes when one is near the size (render/browselist.ts pageStarts).
		const t1 = browse(v.ctx.db, { sort: 'title', pageSize: 5 });
		for (let n = 1; n <= t1.pages; n++) {
			const r = browse(v.ctx.db, { sort: 'title', pageSize: 5, page: n });
			expect(r.items.length).toBeGreaterThanOrEqual(2);
			expect(r.items.length).toBeLessThanOrEqual(7);
		}
		const time = browse(v.ctx.db, { sort: 'time', pageSize: 100 }).items.map((c) => c.total_s).filter((t) => t !== null) as number[];
		expect(time).toEqual([...time].sort((a, b) => a - b));
		expect(browse(v.ctx.db, { sort: 'rating' }).items[0].slug).toMatch(/pate-chinois|pouding-chomeur|lasagna-bolognaise/);
	});
});

describe('families', () => {
	it('lists families with variant counts', () => {
		expect(families(v.ctx.db)).toEqual([
			{ slug: 'lasagna', label: null, name: 'Lasagnes aux courgettes', count: 3 },
			{ slug: 'tarte-aux-pommes', label: null, name: 'Tarte aux pommes streusel', count: 2 }
		]);
	});

	it('names a family by its label, else its shortest recipe title — never its slug', () => {
		expect(familyNames(v.ctx.db)).toEqual({ lasagna: 'Lasagnes aux courgettes', 'tarte-aux-pommes': 'Tarte aux pommes streusel' });
		v.ctx.db.prepare("UPDATE families SET label_fr = 'Lasagnes' WHERE slug = 'lasagna'").run();
		expect(familyName(v.ctx.db, 'lasagna')).toBe('Lasagnes');
		expect(familyDiff(v.ctx.db, 'lasagna')).toMatchObject({ name: 'Lasagnes', fallback: 'Lasagnes aux courgettes' });
		const card = browse(v.ctx.db, { family: 'tarte-aux-pommes' }).items.find((c) => c.slug.includes('grand'))!;
		expect(card).toMatchObject({ family_name: 'Tarte aux pommes streusel', family_size: 2, author: 'Grand-mère Alma' });
		expect(familyName(v.ctx.db, 'nothing-here')).toBeNull();
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
