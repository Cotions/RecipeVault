// Duplicate detection's pure parts (plan 05, Phase 5; Q10 A, Q11 B, Q16 C):
// element sets, the weighted Jaccard, and prefix filtering against brute force.

import { describe, expect, it } from 'vitest';
import {
	DUPLICATE_THRESHOLD,
	elementSet,
	familyExcluded,
	MIN_ELEMENTS,
	rarityWeights,
	recipeLines,
	similarPairs,
	similarPairsBrute,
	similarTo,
	simIndex,
	splitSets,
	weightedJaccard,
	type SimLine,
	type SimRecipe
} from '../../src/lib/ingredients/similar';
import { Resolver } from '../../src/lib/ingredients/resolve';
import { checkFile } from '../../src/lib/vault/check';

const L = (item: string | null, o: Partial<SimLine> = {}): SimLine => ({
	item,
	key: o.key ?? (item ?? 'x'),
	recipe: null,
	optional: false,
	groupOptional: false,
	toTaste: false,
	qty: 1,
	qtyMax: null,
	unit: 'cup',
	...o
});

describe('element set (Q10 A)', () => {
	it('keeps staples, counts a sub-recipe as one element, uses the lookup key of an unresolved line', () => {
		const s = elementSet([
			L('farine'),
			L('sel', { qty: null, unit: null }),
			L(null, { key: 'beouf hache' }),
			L(null, { key: 'abaisse', recipe: 'pate-brisee' })
		]);
		expect(s.elements).toEqual(['farine', 'k:beouf hache', 'r:pate-brisee', 'sel']);
	});

	it('leaves out optional lines, optional groups and to_taste lines; one element per identity', () => {
		const s = elementSet([
			L('farine'),
			L('farine', { qty: 2 }),
			L('noix', { optional: true }),
			L('glace', { groupOptional: true }),
			L('poivre', { toTaste: true, qty: null, unit: null })
		]);
		expect(s.elements).toEqual(['farine']);
	});

	it('ignores `or` choices: the main line counts', () => {
		const text = `---\nschema: 3\ntitle: Test\nlang: fr\ningredients:\n  - items:\n      - { qty: 1, unit: cup, name: beurre, or: [margarine] }\n      - { qty: 1, unit: cup, name: sucre }\n      - { qty: 2, unit: cup, name: farine }\n  - group: Garniture\n    optional: true\n    items:\n      - { qty: 1, unit: cup, name: noix }\nextracted_by: ai\n---\n\n## Préparation\n\n1. Mélanger.\n`;
		const recipe = checkFile(text).recipe!;
		const resolver = new Resolver(
			[
				{ key: 'beurre', skey: 'beurre', slug: 'beurre' },
				{ key: 'margarine', skey: 'margarine', slug: 'margarine' },
				{ key: 'sucre', skey: 'sucre', slug: 'sucre' }
			]
		);
		const s = elementSet(recipeLines(recipe, resolver));
		expect(s.elements).toEqual(['beurre', 'k:farine', 'sucre']);
	});

	it('two copies of one card have the same amounts; another amount differs', () => {
		const a = elementSet([L('farine'), L('sucre', { qty: 0.5 })]);
		const b = elementSet([L('sucre', { qty: 0.5 }), L('farine')]);
		const c = elementSet([L('farine'), L('sucre', { qty: 0.75 })]);
		expect(a.amounts).toBe(b.amounts);
		expect(a.amounts).not.toBe(c.amounts);
	});
});

describe('similarity (Q11 B)', () => {
	const w = new Map([
		['a', 1],
		['b', 2],
		['c', 3],
		['d', 4]
	]);
	const weight = (e: string) => w.get(e)!;

	it('is the weighted Jaccard: shared weight over the union weight', () => {
		expect(weightedJaccard(['a', 'b', 'c'], ['a', 'b', 'c'], weight)).toBe(1);
		expect(weightedJaccard(['a', 'b', 'c'], ['b', 'c', 'd'], weight)).toBeCloseTo(5 / 10);
		expect(weightedJaccard(['a'], ['d'], weight)).toBe(0);
		expect(weightedJaccard([], [], weight)).toBe(0);
	});

	it('weighs a rare element more than a common one: ln(1 + N/df)', () => {
		const ws = rarityWeights([{ elements: ['sel', 'chipits'] }, { elements: ['sel'] }, { elements: ['sel'] }, { elements: ['sel'] }]);
		expect(ws.get('sel')).toBeCloseTo(Math.log(2));
		expect(ws.get('chipits')).toBeCloseTo(Math.log(5));
	});

	it('shared staples alone score low; a shared rare ingredient scores high', () => {
		const sets = [
			['beurre', 'farine', 'oeuf', 'sucre', 'chipits'],
			['beurre', 'farine', 'oeuf', 'sucre', 'dattes'],
			['beurre', 'farine', 'oeuf', 'sucre', 'dattes', 'gruau'],
			...Array.from({ length: 20 }, (_, i) => ['beurre', 'farine', 'oeuf', 'sucre', `x${i}`])
		].map((e) => ({ elements: [...e].sort() }));
		const ws = rarityWeights(sets);
		const weight = (e: string) => ws.get(e)!;
		const cookiesVsDates = weightedJaccard(sets[0].elements, sets[1].elements, weight);
		const datesVsDates = weightedJaccard(sets[1].elements, sets[2].elements, weight);
		expect(cookiesVsDates).toBeLessThan(0.5);
		expect(datesVsDates).toBeGreaterThan(cookiesVsDates + 0.2);
		// Plain Jaccard would call the cookies and the date squares close (4/6).
		expect(4 / 6).toBeGreaterThan(cookiesVsDates);
	});

	it('splits two sets into shared and only-in-each', () => {
		expect(splitSets(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual({ shared: ['b', 'c'], onlyA: ['a'], onlyB: ['d'] });
	});
});

describe('same-family pairs (Q16 C)', () => {
	const r = (family: string | null, qty = 1): Pick<SimRecipe, 'family' | 'elements' | 'amounts'> => ({ family, ...elementSet([L('a', { qty }), L('b'), L('c')]) });
	it('are left out, unless the same card twice (same set and amounts)', () => {
		expect(familyExcluded(r('tarte'), r('tarte', 2))).toBe(true);
		expect(familyExcluded(r('tarte'), r('tarte'))).toBe(false);
		expect(familyExcluded(r('tarte'), r('gateau', 2))).toBe(false);
		expect(familyExcluded(r(null), r(null, 2))).toBe(false);
	});
});

/** Deterministic random recipes: `n` sets over a skewed vocabulary, some families, some near-copies. */
function randomRecipes(n: number, seed = 7): SimRecipe[] {
	let s = seed;
	const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
	const vocab = Array.from({ length: 120 }, (_, i) => `e${i}`);
	// Skewed: low indices (staples) far more likely.
	const draw = () => vocab[Math.floor(vocab.length * rand() ** 2.5)];
	const out: SimRecipe[] = [];
	for (let i = 0; i < n; i++) {
		let lines: SimLine[];
		if (i > 10 && rand() < 0.2) {
			// A near copy of an earlier one: one element changed, maybe.
			const src = out[Math.floor(rand() * out.length)];
			const els = src.elements.filter(() => rand() > 0.15);
			if (rand() < 0.5) els.push(draw());
			lines = els.map((e) => L(e));
		} else lines = Array.from({ length: 2 + Math.floor(rand() * 10) }, () => L(draw(), { qty: Math.floor(rand() * 3) }));
		out.push({ slug: `r${String(i).padStart(4, '0')}`, family: rand() < 0.2 ? `f${Math.floor(rand() * 5)}` : null, ...elementSet(lines) });
	}
	return out;
}

describe('candidates by prefix filtering', () => {
	const recipes = randomRecipes(400);
	const ws = rarityWeights(recipes);
	const weight = (e: string) => ws.get(e) ?? 1;

	it.each([0.3, 0.5, DUPLICATE_THRESHOLD, 0.8, 0.95, 1])('finds exactly the pairs brute force finds at %s', (t) => {
		const fast = similarPairs(recipes, weight, t);
		const brute = similarPairsBrute(recipes, weight, t);
		expect(fast).toEqual(brute);
		if (t <= 0.8) expect(brute.length).toBeGreaterThan(0);
	});

	it('never pairs a recipe with fewer than MIN_ELEMENTS elements', () => {
		const tiny = [
			{ slug: 'cafe', family: null, ...elementSet([L('cafe'), L('eau')]) },
			{ slug: 'cafe-2', family: null, ...elementSet([L('cafe'), L('eau')]) }
		];
		expect(MIN_ELEMENTS).toBe(3);
		expect(similarPairs(tiny, () => 1, 0.5)).toEqual([]);
	});

	it('one recipe against the vault (a paste) finds what the all-pairs pass finds for it', () => {
		const idx = simIndex(recipes);
		for (const q of recipes.slice(0, 80)) {
			const got = similarTo(q, idx, weight, DUPLICATE_THRESHOLD, q.slug).map((x) => x.slug).sort();
			const want = similarPairsBrute(recipes, weight, DUPLICATE_THRESHOLD)
				.filter((p) => p.a === q.slug || p.b === q.slug)
				.map((p) => (p.a === q.slug ? p.b : p.a))
				.sort();
			expect(got, q.slug).toEqual(want);
		}
	});
});
