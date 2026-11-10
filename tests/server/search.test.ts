import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { browse, COURSE_TAGS, ideas, seasonOf } from '../../src/lib/server/index/query';
import { closest, holds, maxEdits } from '../../src/lib/server/index/search';
import { syncVault } from '../../src/lib/server/index/sync';
import { fixtureVault, type TempVault } from '../helpers/vault';

let v: TempVault;
beforeEach(async () => {
	v = await fixtureVault();
});
afterEach(() => v.cleanup());

const slugs = (r: { items: { slug: string }[] }) => r.items.map((i) => i.slug);

/** An invented recipe with one ingredient line. */
function add(slug: string, title: string, name: string, lang = 'fr', extra = '') {
	writeFileSync(
		join(v.dir, 'recipes', `${slug}.md`),
		`---\nschema: 3\ntitle: ${title}\nlang: ${lang}\n${extra}ingredients:\n  - items:\n      - { qty: 2, unit: cup, name: ${name} }\nextracted_by: ai\n---\n\n## Préparation\n\n1. Mélanger.\n`
	);
}

describe('search', () => {
	beforeEach(() => {
		// Potatoes: another entry whose French name starts with « pomme », in another category.
		writeFileSync(
			join(v.dir, 'ingredients', 'pomme-de-terre.md'),
			'---\nslug: pomme-de-terre\ncategory: legume\nnames:\n  fr: [pomme de terre, pommes de terre, patate, patates]\n  en: [potato, potatoes]\ndefault_unit: piece\nstaple: false\nsubstitutes: []\nallergens: []\n---\n'
		);
		add('apple-crunch', 'Apple Crunch', 'apple', 'en');
		add('puree-maison', 'Purée maison', 'pommes de terre');
		syncVault(v.ctx.db, v.ctx.paths);
	});

	it('finds an ingredient by its other names (pomme ↔ apple)', () => {
		expect(slugs(browse(v.ctx.db, { q: 'pomme' }))).toContain('apple-crunch');
		expect(slugs(browse(v.ctx.db, { q: 'apple' }))).toEqual(expect.arrayContaining(['apple-crunch', 'tarte-aux-pommes-streusel']));
		expect(browse(v.ctx.db, { q: 'pomme' }).terms).toEqual(expect.arrayContaining(['pomme', 'apple']));
	});

	it('keeps another ingredient’s compound name whole (pomme is not pommes de terre)', () => {
		expect(slugs(browse(v.ctx.db, { q: 'pomme' }))).not.toContain('puree-maison');
		expect(slugs(browse(v.ctx.db, { q: 'pommes' }))).not.toContain('puree-maison');
		expect(slugs(browse(v.ctx.db, { q: 'pommes de terre' }))).toContain('puree-maison');
		// While typing the compound, its recipes stay.
		expect(slugs(browse(v.ctx.db, { q: 'pommes de t' }))).toContain('puree-maison');
		// The other names of the compound's entry find it too.
		expect(slugs(browse(v.ctx.db, { q: 'patate' }))).toEqual(expect.arrayContaining(['puree-maison', 'pate-chinois']));
	});

	it('lists the titles that hold a word first, then the rest by where the words are', () => {
		const r = browse(v.ctx.db, { q: 'dessert pomme', pageSize: 100 });
		expect(r.items.length).toBeGreaterThan(0);
		// « Tarte aux pommes » holds one word in its title (dessert is a tag): a title hit all the same.
		expect(r.items.filter((c) => c.slug.startsWith('tarte-aux-pommes')).every((c) => c.section === 'title')).toBe(true);
		const p = browse(v.ctx.db, { q: 'pomme', pageSize: 100 });
		const order = p.items.map((c) => c.section);
		expect(order[0]).toBe('title');
		expect(p.sections?.map((s) => s.section)).toEqual([...new Set(order)]);
		expect(p.items.find((c) => c.slug === 'ketchup-aux-fruits')?.section).toBe('ingredients');
		expect(p.sections?.reduce((n, s) => n + s.count, 0)).toBe(p.total);
		expect(p.titleHits).toBe(order.filter((s) => s === 'title').length);
	});

	it('offers a close spelling, and searches it when the typed word finds nothing', () => {
		const r = browse(v.ctx.db, { q: 'tarre' });
		expect(r.suggestion).toEqual({ q: 'tarte', applied: true });
		expect(r.q).toBe('tarte');
		expect(r.total).toBeGreaterThan(0);
		expect(browse(v.ctx.db, { q: 'tarte' }).suggestion).toBeNull();
		expect(browse(v.ctx.db, { q: 'zzzzzz' })).toMatchObject({ total: 0, suggestion: null });
	});

	it('« Chercher exactement »: the typed word searched as is, the close spelling only offered', () => {
		const r = browse(v.ctx.db, { q: 'tarre', exact: true });
		expect(r.suggestion).toEqual({ q: 'tarte', applied: false });
		expect(r.q).toBe('tarre');
		expect(r.total).toBe(0);
	});

	it('allows one edit in a short word and two in a long one', () => {
		expect([3, 4, 6, 7, 10].map(maxEdits)).toEqual([0, 1, 1, 2, 2]);
		const vocab = new Map([
			['tourtiere', { display: 'tourtière', n: 5 }],
			['tarte', { display: 'tarte', n: 9 }]
		]);
		expect(closest('tourtire', vocab)?.display).toBe('tourtière');
		expect(closest('tourtierre', vocab)?.display).toBe('tourtière');
		expect(closest('tourtxyz', vocab)).toBeNull();
	});

	it('matches a run of words, the last a prefix, outside the compounds left out', () => {
		expect(holds(['pommes', 'de', 'terre'], ['pomme'])).toBe(true);
		expect(holds(['pommes', 'de', 'terre'], ['pomme'], [['pommes', 'de', 'terre']])).toBe(false);
		expect(holds(['pommes', 'de', 'terre', 'et', 'pommes'], ['pomme'], [['pommes', 'de', 'terre']])).toBe(true);
	});
});

describe('facet counts', () => {
	it('counts a tag in the current list, since tags add up', () => {
		const r = browse(v.ctx.db, { tags: ['dessert'] });
		const q = r.facets.tags.find((t) => t.value === 'quebecois')!;
		expect(q.count).toBe(browse(v.ctx.db, { tags: ['dessert', 'quebecois'] }).total);
	});

	it('lists a value that would leave nothing with count 0, after the others', () => {
		const r = browse(v.ctx.db, { tags: ['dessert'] });
		const counts = r.facets.tags.map((t) => t.count);
		const firstZero = counts.indexOf(0);
		expect(firstZero).toBeGreaterThan(0);
		expect(counts.slice(firstZero).every((n) => n === 0)).toBe(true);
		// Every season of the box is listed, even one no dessert has.
		expect(r.facets.season.map((s) => s.value).sort()).toEqual(browse(v.ctx.db, {}).facets.season.map((s) => s.value).sort());
		// Without a filter, nothing counts 0.
		expect(browse(v.ctx.db, {}).facets.tags.every((t) => t.count > 0)).toBe(true);
	});
});

describe('ideas', () => {
	it('names the season of each month (Québec)', () => {
		expect([1, 3, 6, 9, 11, 12].map(seasonOf)).toEqual(['hiver', 'printemps', 'ete', 'automne', 'automne', 'hiver']);
	});

	it('draws a card at random, the season’s and the last added', () => {
		const x = ideas(v.ctx.db, new Date(2026, 10, 6));
		expect(x.random.length).toBeGreaterThan(1);
		expect(x.season?.season).toBe('automne');
		expect(x.season?.count).toBe(browse(v.ctx.db, { season: 'automne' }).total);
		expect(x.season?.cards.length).toBeLessThanOrEqual(3);
		expect(x.recent.map((c) => c.slug)).toEqual(slugs(browse(v.ctx.db, { sort: 'added', pageSize: 3 })));
	});
});

describe('search words', () => {
	const entry = (slug: string, fr: string[], en: string[]) =>
		writeFileSync(
			join(v.dir, 'ingredients', `${slug}.md`),
			`---\nslug: ${slug}\ncategory: legume\nnames:\n  fr: [${fr.join(', ')}]\n  en: [${en.join(', ')}]\ndefault_unit: piece\nstaple: false\nsubstitutes: []\nallergens: []\n---\n`
		);
	beforeEach(() => {
		// Invented: an aunt written as one word, a cake, a red pepper beside the fixture's green one, a note that only mentions a dish.
		add('tarte-aux-bleuets', 'Tarte aux bleuets', 'bleuets', 'fr', 'source: { type: family, author: Matante Yolande }\n');
		add('gateau-aux-carottes', 'Gâteau aux carottes', 'carottes');
		add('tartelettes-au-citron', 'Tartelettes au citron', 'sucre');
		add('porc-braise', 'Porc braisé', 'porc haché maigre');
		entry('poivron-rouge', ['piment rouge', 'poivron rouge'], ['red pepper']);
		add('salade-croquante', 'Salade croquante', 'piment rouge');
		writeFileSync(
			join(v.dir, 'recipes', 'relish-maison.md'),
			'---\nschema: 3\ntitle: Relish maison\nlang: fr\ningredients:\n  - items:\n      - { qty: 2, unit: cup, name: concombres }\nextracted_by: ai\n---\n\n## Préparation\n\n1. Mélanger.\n\n## Notes\n\nSe sert avec la tourtière.\n'
		);
		add('tourtiere-du-lac', 'Tourtière du Lac', 'porc haché');
		syncVault(v.ctx.db, v.ctx.paths);
	});

	it('reads the kin words every way: tante ⇄ matante, mémère ⇄ grand-mère', () => {
		expect(slugs(browse(v.ctx.db, { q: 'tante' }))).toEqual(expect.arrayContaining(['tarte-aux-bleuets', 'tarte-au-sucre']));
		expect(slugs(browse(v.ctx.db, { q: 'matante' }))).toEqual(expect.arrayContaining(['tarte-aux-bleuets', 'tarte-au-sucre']));
		expect(slugs(browse(v.ctx.db, { q: 'bleuets ma tante' }))).toContain('tarte-aux-bleuets');
		expect(slugs(browse(v.ctx.db, { q: 'memere' }))).toEqual(expect.arrayContaining(['tarte-aux-pommes-grand-mere', 'feves-au-lard']));
		expect(browse(v.ctx.db, { q: 'tante' }).terms).toContain('matante');
	});

	it('drops the little words next to others, and never reads one as a prefix', () => {
		expect(slugs(browse(v.ctx.db, { q: 'la tarte aux bleuets de ma tante' }))).toContain('tarte-aux-bleuets');
		expect(slugs(browse(v.ctx.db, { q: 'porc de ma' }))).toEqual(expect.arrayContaining(['porc-braise']));
		// Alone, « ma » is the word ma: not « maigre ».
		const ma = slugs(browse(v.ctx.db, { q: 'ma' }));
		expect(ma).toContain('tarte-au-sucre');
		expect(ma).not.toContain('porc-braise');
	});

	it('reads a dish word in English as its French name, a whole word', () => {
		expect(slugs(browse(v.ctx.db, { q: 'carrot cake' }))).toEqual(['gateau-aux-carottes']);
		const pie = slugs(browse(v.ctx.db, { q: 'pie' }));
		expect(pie).toEqual(expect.arrayContaining(['tarte-au-sucre', 'tarte-aux-pommes-streusel']));
		expect(pie).not.toContain('tartelettes-au-citron');
	});

	it('offers each word alone when together they find nothing', () => {
		const r = browse(v.ctx.db, { q: 'pomme zzzzqq' });
		expect(r.total).toBe(0);
		expect(r.partial).toEqual([
			{ q: 'pomme', count: browse(v.ctx.db, { q: 'pomme', pageSize: 1 }).total },
			{ q: 'zzzzqq', count: 0 }
		]);
		expect(browse(v.ctx.db, { q: 'zzzzqq' }).partial).toBeNull();
		expect(browse(v.ctx.db, { q: 'pomme' }).partial).toBeNull();
	});

	it('reads a word that heads ingredient names as all of them (poivron → piment vert, piment rouge)', () => {
		const r = browse(v.ctx.db, { q: 'poivron', pageSize: 100 });
		expect(slugs(r)).toEqual(expect.arrayContaining(['pizza-maison', 'salade-croquante']));
		// Each name narrows the list: a link per ingredient, by the name the box writes.
		expect(r.also?.map((a) => a.q).sort()).toEqual(['piment rouge', 'piment vert']);
		expect(r.also?.every((a) => a.count > 0 && a.count < r.total)).toBe(true);
		// The match line marks the other name it found.
		expect(r.items.find((c) => c.slug === 'pizza-maison')?.match).toMatchObject({ field: 'ingredients', texts: ['piment vert'], terms: ['piment', 'vert'] });
	});

	it('lists a recipe whose notes alone hold the words last, under « notes »', () => {
		const r = browse(v.ctx.db, { q: 'tourtiere', pageSize: 100 });
		expect(r.items.find((c) => c.slug === 'tourtiere-du-lac')?.section).toBe('title');
		expect(r.items.find((c) => c.slug === 'relish-maison')?.section).toBe('notes');
		expect(r.sections?.at(-1)?.section).toBe('notes');
	});
});

describe('ratings and idea lines', () => {
	it('counts the rated recipes, gives each card its rating, and each idea its course', () => {
		const r = browse(v.ctx.db, { sort: 'rating', pageSize: 100 });
		expect(r.rated).toBe(r.items.filter((c) => c.rating !== null).length);
		const x = ideas(v.ctx.db, new Date(2026, 10, 6));
		for (const c of x.recent) expect(c.tag === null || typeof c.tag === 'string').toBe(true);
		expect(x.random.some((c) => c.tag)).toBe(true);
	});
});

describe('names held apart', () => {
	beforeEach(() => {
		// Invented: allspice, known in Québec as « piment de la Jamaïque » — a spice, not a pepper.
		writeFileSync(
			join(v.dir, 'ingredients', 'epices-melangees.md'),
			'---\nslug: epices-melangees\ncategory: epice\nnames:\n  fr: [quatre-épices, piment de la Jamaïque]\n  en: [allspice]\ndefault_unit: g\nstaple: false\nsubstitutes: []\nallergens: []\n---\n'
		);
		writeFileSync(
			join(v.dir, 'ingredients', 'poivron-rouge.md'),
			'---\nslug: poivron-rouge\ncategory: legume\nnames:\n  fr: [piment rouge, poivron rouge]\n  en: [red pepper]\ndefault_unit: piece\nstaple: false\nsubstitutes: []\nallergens: []\n---\n'
		);
		add('gateau-epice', 'Gâteau épicé', 'piment de la Jamaïque');
		add('salade-rouge', 'Salade rouge', 'piment rouge');
		syncVault(v.ctx.db, v.ctx.paths);
	});

	it('leaves « piment de la Jamaïque » out of « piment », and offers it apart', () => {
		const r = browse(v.ctx.db, { q: 'piment', pageSize: 100 });
		expect(slugs(r)).toContain('salade-rouge');
		expect(slugs(r)).not.toContain('gateau-epice');
		expect(r.also?.find((a) => a.apart)).toEqual({ q: 'piment de la Jamaïque', count: 1, apart: true });
		// Its own name, or another of its names, still finds it.
		expect(slugs(browse(v.ctx.db, { q: 'piment de la jamaique' }))).toEqual(['gateau-epice']);
		expect(slugs(browse(v.ctx.db, { q: 'allspice' }))).toEqual(['gateau-epice']);
	});
});

describe('row lines and idea rails', () => {
	it('gives each row its course and its seasons, spring first', () => {
		const r = browse(v.ctx.db, { pageSize: 100 });
		for (const c of r.items) {
			const course = COURSE_TAGS.find((t) => c.tags.includes(t)) ?? null;
			expect(c.course).toBe(course);
			expect(c.seasons).toEqual([...c.seasons].sort((a, b) => ['printemps', 'ete', 'automne', 'hiver'].indexOf(a) - ['printemps', 'ete', 'automne', 'hiver'].indexOf(b)));
		}
		const autumn = slugs(browse(v.ctx.db, { season: 'automne', pageSize: 100 }));
		expect(r.items.filter((c) => c.seasons.includes('automne')).map((c) => c.slug).sort()).toEqual([...autumn].sort());
	});

	it('draws each rail from exactly the list its head links to', () => {
		const x = ideas(v.ctx.db, new Date(2026, 10, 6));
		const total = {
			long: browse(v.ctx.db, { tags: ['plat-principal'], time: 'plus' }).total,
			crowd: browse(v.ctx.db, { servings: '7+' }).total,
			liked: (v.ctx.db.prepare('SELECT count(*) FROM recipes WHERE rating >= 4').pluck().get() as number)
		};
		for (const key of ['long', 'crowd', 'liked'] as const) {
			const rail = x.rails.find((y) => y.key === key);
			if (total[key] < 3) expect(rail).toBeUndefined();
			else {
				expect(rail?.count).toBe(total[key]);
				expect(rail?.cards.length).toBe(3);
			}
		}
		expect(x.rails.find((y) => y.key === 'crowd')?.href ?? '/?portions=7%2B').toBe('/?portions=7%2B');
	});
});
