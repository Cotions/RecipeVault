import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { recipeCost, subRecipeFactor, type CostEntry, type CostPrice, type CostSources } from '../../src/lib/ingredients/cost';
import { measure, noteSize, packsOf, parseConversions, type Conversions, type Convertible } from '../../src/lib/ingredients/units';
import { seedVocab } from '../../src/lib/server/vault';
import { buildRecipe } from '../../src/lib/vault/build';
import type { Recipe, Unit } from '../../src/lib/vault/types';

// The seed factors, read from docs/VOCAB.md like a new vault does.
const CONV: Conversions = parseConversions(parse(seedVocab(readFileSync('docs/VOCAB.md', 'utf8'))['conversions.yaml'], { version: '1.2' }));

/** How many packs of `packQty packUnit` the amount is. */
function packs(qty: number, unit: Unit, packQty: number, packUnit: Unit, ing: Convertible = {}, note?: string, conv = CONV) {
	return packsOf(measure(qty, unit, ing, conv, noteSize(note, 'fr')), measure(packQty, packUnit, ing, conv));
}

describe('conversions', () => {
	it('reads the seed factors from VOCAB.md, and ignores what is not a factor of the right class', () => {
		expect(CONV.volume).toMatchObject({ cup: 250, tbsp: 15, tsp: 5, qt: 1136, pint: 568 });
		expect(CONV.mass).toMatchObject({ lb: 453.6, oz: 28.35, kg: 1000 });
		expect(CONV.volume.pinch).toBeUndefined();
		expect(parseConversions({ mass: { cup: 250, g: 1, kg: -1, lb: 'x' }, volume: [] })).toEqual({ mass: { g: 1 }, volume: {} });
		expect(parseConversions(undefined)).toEqual({ mass: {}, volume: {} });
	});

	it('within mass and within volume, by the factors', () => {
		expect(packs(800, 'g', 400, 'g')).toBe(2);
		expect(packs(1, 'lb', 1, 'kg')).toBeCloseTo(0.4536);
		expect(packs(2, 'cup', 1, 'l')).toBe(0.5);
		expect(packs(3, 'tbsp', 250, 'ml')).toBeCloseTo(0.18);
		expect(packs(1, 'qt', 1, 'l')).toBeCloseTo(1.136);
	});

	it('the factors are data: US measures when the vault says so', () => {
		const us = parseConversions({ volume: { ml: 1, l: 1000, qt: 946, pint: 473 } });
		expect(packs(1, 'qt', 1, 'l', {}, undefined, us)).toBeCloseTo(0.946);
		// No factor for cup in this file: nothing to convert with.
		expect(packs(1, 'cup', 1, 'l', {}, undefined, us)).toBeUndefined();
	});

	it('mass ↔ volume only through the density, never guessed', () => {
		expect(packs(2, 'cup', 2, 'kg')).toBeUndefined();
		expect(packs(2, 'cup', 2, 'kg', { density: 0.53 })).toBeCloseTo(0.1325);
		expect(packs(500, 'g', 1, 'l', { density: 1.03 })).toBeCloseTo(0.4854, 3);
		// tbsp through the density (Q11 A)…
		expect(packs(2, 'tbsp', 1, 'kg', { density: 0.85 })).toBeCloseTo(0.0255);
		// …unless the entry weighs a tbsp itself.
		expect(packs(2, 'tbsp', 1, 'kg', { density: 0.85, weights: { tbsp: 14 } })).toBeCloseTo(0.028);
	});

	it('counts through the weights or a pack in the same unit; a pinch only through weights', () => {
		expect(packs(3, 'piece', 6, 'piece')).toBe(0.5);
		expect(packs(3, 'piece', 1, 'kg')).toBeUndefined();
		expect(packs(3, 'piece', 1, 'kg', { weights: { piece: 150 } })).toBeCloseTo(0.45);
		expect(packs(2, 'clove', 1, 'piece', { weights: { clove: 5, piece: 50 } })).toBeCloseTo(0.2);
		expect(packs(1, 'pinch', 1, 'kg')).toBeUndefined();
		expect(packs(1, 'pinch', 1, 'kg', { weights: { pinch: 0.4 } })).toBeCloseTo(0.0004);
	});

	it('containers: the same unit, or the size in the note (Q13 B)', () => {
		expect(packs(2, 'can', 1, 'can')).toBe(2);
		expect(packs(1, 'can', 400, 'g')).toBeUndefined();
		expect(packs(1, 'can', 400, 'g', {}, '796 g')).toBeCloseTo(1.99);
		expect(packs(1, 'can', 1, 'l', { density: 1.05 }, '19 oz (540 ml)')).toBeCloseTo(0.54);
		expect(packs(1, 'can', 1, 'kg', { density: 1.05 }, '796 ml')).toBeCloseTo(0.8358);
		expect(noteSize('1-1/2 lb', 'fr')).toEqual([{ qty: 1.5, unit: 'lb' }]);
		expect(noteSize('environ 2,5 kg', 'fr')).toEqual([{ qty: 2.5, unit: 'kg' }]);
		// Two sizes, an alternative, no size: nothing.
		expect(noteSize('398 ml ou 796 ml', 'fr')).toBeUndefined();
		expect(noteSize('égouttées', 'fr')).toBeUndefined();
	});

	it('a multipack in the note is the whole pack (N × size); unsure forms stay unpriced', () => {
		expect(noteSize('2 x 400 g', 'fr')).toEqual([{ qty: 800, unit: 'g' }]);
		expect(noteSize('6 × 355 ml', 'fr')).toEqual([{ qty: 2130, unit: 'ml' }]);
		expect(noteSize('paquet de 2 X 225 g', 'fr')).toEqual([{ qty: 450, unit: 'g' }]);
		expect(packs(1, 'packet', 1, 'kg', {}, '2 x 400 g')).toBeCloseTo(0.8);
		expect(noteSize('2 x 14 oz (2 x 398 ml)', 'fr')).toBeUndefined();
		expect(noteSize('6x355 ml', 'fr')).toBeUndefined();
		expect(noteSize('0 x 400 g', 'fr')).toBeUndefined();
	});

	it('a leading decimal point is a decimal: .75 l is 0.75 l, never 75 l', () => {
		expect(noteSize('.75 l', 'fr')).toEqual([{ qty: 0.75, unit: 'l' }]);
		expect(noteSize('bouteille de .5 l', 'fr')).toEqual([{ qty: 0.5, unit: 'l' }]);
		expect(noteSize(',75 l', 'fr')).toEqual([{ qty: 0.75, unit: 'l' }]);
		// A match never starts inside a number or right after a dot.
		expect(noteSize('de.75 l', 'fr')).toBeUndefined();
		expect(noteSize('1.75 l', 'fr')).toEqual([{ qty: 1.75, unit: 'l' }]);
		expect(packs(1, 'bottle', 750, 'ml', {}, '.75 l')).toBeCloseTo(1);
	});
});

// A small invented world: entries, prices, recipes.
const ENTRIES: Record<string, CostEntry> = {
	tomates: { staple: false, density: 1.03 },
	farine: { staple: false, density: 0.53 },
	beurre: { staple: true, density: 0.91 },
	sel: { staple: true },
	oeuf: { staple: false, weights: { piece: 55 } },
	oignon: { staple: false, weights: { piece: 150 } },
	persil: { staple: false },
	lait: { staple: false, density: 1.03 }
};
const PRICES: Record<string, CostPrice> = {
	tomates: { amount: 0.89, packQty: 400, packUnit: 'g', date: '2026-09-01' },
	farine: { amount: 4.99, packQty: 2.5, packUnit: 'kg', date: '2026-09-01' },
	beurre: { amount: 5.99, packQty: 454, packUnit: 'g', date: '2025-01-01' },
	oeuf: { amount: 4.2, packQty: 12, packUnit: 'piece', date: '2026-09-01' },
	lait: { amount: 5.2, packQty: 4, packUnit: 'l', date: '2026-09-01' },
	persil: { amount: 1.49, packQty: 1, packUnit: 'bunch', date: '2026-09-01' }
};

const recipe = (fm: Record<string, unknown>): Recipe => buildRecipe({ schema: 3, title: fm.slug, ...fm }, []);

function world(recipes: Recipe[], items: Record<string, (string | undefined)[]>): CostSources {
	const bySlug = new Map(recipes.map((r) => [r.slug, r]));
	return {
		itemAt: (s, p) => items[s]?.[p],
		entry: (s) => ENTRIES[s],
		price: (s) => PRICES[s],
		recipe: (s) => bySlug.get(s),
		conversions: CONV,
		today: '2026-09-27'
	};
}

describe('recipe cost', () => {
	it('the worked example: 800 g of tomatoes at 0,89 $ per 400 g = 1,78 $', () => {
		const r = recipe({ slug: 'sauce', servings: 4, ingredients: [{ items: [{ qty: 800, unit: 'g', name: 'tomates' }] }] });
		const c = recipeCost(r, world([r], { sauce: ['tomates'] }));
		expect(c.total).toBeCloseTo(1.78, 10);
		expect(c.perServing).toBeCloseTo(0.445, 10);
		expect(c).toMatchObject({ priced: 1, counted: 1, coverage: 1, enough: true, stale: false });
	});

	it('coverage leaves out staples and to_taste; a priced staple still adds to the total (Q17)', () => {
		const r = recipe({
			slug: 'gratin',
			servings: 4,
			ingredients: [
				{
					items: [
						{ qty: 800, unit: 'g', name: 'tomates' },
						{ qty: 2, unit: 'tbsp', name: 'beurre' },
						{ name: 'sel', to_taste: true },
						{ qty: 1, unit: 'piece', name: 'oignon' },
						{ qty: 1, unit: 'cup', name: 'lait' },
						{ name: 'persil haché', qty: 2, unit: 'tbsp' },
						{ name: 'fromage inventé', qty: 100, unit: 'g' }
					]
				}
			]
		});
		const c = recipeCost(r, world([r], { gratin: ['tomates', 'beurre', 'sel', 'oignon', 'lait', 'persil', undefined] }));
		// tomates, oignon (no price), lait, persil (bunch vs tbsp), fromage (unresolved) count; beurre and sel do not.
		expect(c.counted).toBe(5);
		expect(c.priced).toBe(2);
		const byName = Object.fromEntries(c.lines.map((l) => [l.name, l]));
		expect(byName.beurre).toMatchObject({ staple: true, counted: false, stale: true });
		expect(byName.beurre.cost).toBeCloseTo(((2 * 15 * 0.91) / 454) * 5.99);
		expect(byName.sel).toMatchObject({ counted: false, reason: 'no-price' });
		expect(byName.oignon.reason).toBe('no-price');
		expect(byName['persil haché'].reason).toBe('no-conversion');
		expect(byName['fromage inventé']).toMatchObject({ reason: 'unresolved', counted: true });
		expect(c.total).toBeCloseTo(1.78 + 0.325 + byName.beurre.cost!);
		expect(c.stale).toBe(true);
		// 2 of 5 is below 70 %: no figure (Q14 A).
		expect(c.enough).toBe(false);
	});

	it('ranges: the upper qty, per serving by the lower servings (Q15); alt when the main unit fails', () => {
		const r = recipe({
			slug: 'crepes',
			servings: 4,
			servings_max: 6,
			ingredients: [
				{
					items: [
						{ qty: 2, qty_max: 3, unit: 'piece', name: 'oeufs' },
						{ qty: 1, unit: 'packet', name: 'farine', alt: { qty: 2, unit: 'cup' } }
					]
				}
			]
		});
		const c = recipeCost(r, world([r], { crepes: ['oeuf', 'farine'] }));
		expect(c.lines[0].cost).toBeCloseTo(1.05);
		expect(c.lines[1].cost).toBeCloseTo(((2 * 250 * 0.53) / 2500) * 4.99);
		expect(c.perServing).toBeCloseTo(c.total / 4);
	});

	it('optional items and optional groups are out of cost and coverage (Q18); `or` costs the main entry', () => {
		const r = recipe({
			slug: 'salade',
			ingredients: [
				{ items: [{ qty: 800, unit: 'g', name: 'tomates', or: ['poivrons'] }, { qty: 1, unit: 'cup', name: 'lait', optional: true }] },
				{ group: 'Garniture', optional: true, items: [{ qty: 3, unit: 'piece', name: 'oeufs' }] }
			]
		});
		const c = recipeCost(r, world([r], { salade: ['tomates', 'lait', 'oeuf'] }));
		expect(c.total).toBeCloseTo(1.78);
		expect(c.counted).toBe(1);
		expect(c.lines.filter((l) => l.reason === 'optional')).toHaveLength(2);
		expect(c.perServing).toBeNull();
	});

	it('when nothing counts (staples only), a figure only once every line is priced', () => {
		const r = recipe({ slug: 'roux', ingredients: [{ items: [{ qty: 2, unit: 'tbsp', name: 'beurre' }, { qty: 2, unit: 'tbsp', name: 'farine' }, { name: 'sel', to_taste: true }] }] });
		const half = recipeCost(r, world([r], { roux: ['beurre', 'sel', 'sel'] }));
		expect(half).toMatchObject({ counted: 0, coverage: null, enough: false });
		expect(half.total).toBeGreaterThan(0);
		const all = recipeCost(r, { ...world([r], { roux: ['beurre', 'farine', 'sel'] }), entry: (s) => (s === 'farine' ? { ...ENTRIES.farine, staple: true } : ENTRIES[s]) });
		expect(all).toMatchObject({ counted: 0, enough: true });
	});

	it('when nothing counts, a line with no amount (a bare staple, not to taste) does not hold the figure back', () => {
		const r = recipe({ slug: 'pate', ingredients: [{ items: [{ qty: 2, unit: 'cup', name: 'farine' }, { name: 'sel' }, { name: 'eau' }] }] });
		const staple = (s: string) => (s === 'farine' ? { ...ENTRIES.farine, staple: true } : s === 'eau' ? { staple: true } : ENTRIES[s]);
		const c = recipeCost(r, { ...world([r], { pate: ['farine', 'sel', 'eau'] }), entry: staple });
		expect(c.lines.map((l) => [l.name, l.amount, l.cost !== undefined])).toEqual([
			['farine', true, true],
			['sel', false, false],
			['eau', false, false]
		]);
		expect(c).toMatchObject({ counted: 0, coverage: null, enough: true });
		// No line with an amount at all: nothing to show.
		const bare = recipe({ slug: 'b', ingredients: [{ items: [{ name: 'sel' }] }] });
		expect(recipeCost(bare, world([bare], { b: ['sel'] })).enough).toBe(false);
	});

	it('a line with no quantity counts and is unpriced; a count unit alone is one', () => {
		const r = recipe({ slug: 'x', ingredients: [{ items: [{ name: 'farine' }, { unit: 'bunch', name: 'persil' }] }] });
		const c = recipeCost(r, world([r], { x: ['farine', 'persil'] }));
		expect(c.lines.map((l) => [l.reason, l.cost])).toEqual([
			['no-qty', undefined],
			[undefined, 1.49]
		]);
	});
});

describe('sub-recipes (Q16 A)', () => {
	const pate = recipe({
		slug: 'pate',
		yield: { qty: 2, unit: 'piece', note: 'abaisses' },
		ingredients: [{ items: [{ qty: 2.5, unit: 'cup', name: 'farine' }, { qty: 1, unit: 'cup', name: 'beurre' }, { qty: 1, unit: 'piece', name: 'oeuf', optional: true }] }]
	});
	const items = { pate: ['farine', 'beurre', 'oeuf'], tarte: ['pate', 'tomates'] };

	it('flattens the sub-recipe, scaled against its yield', () => {
		const tarte = recipe({
			slug: 'tarte',
			servings: 8,
			ingredients: [{ items: [{ qty: 1, unit: 'piece', name: 'pâte', recipe: 'pate', buy_instead: true }, { qty: 400, unit: 'g', name: 'tomates' }] }]
		});
		const c = recipeCost(tarte, world([tarte, pate], items));
		const sub = c.lines.filter((l) => l.via.length);
		expect(sub.map((l) => [l.name, l.via, l.position])).toEqual([
			['farine', ['pate'], 0],
			['beurre', ['pate'], 0],
			['oeuf', ['pate'], 0]
		]);
		// Half the pastry: half its flour and butter.
		expect(sub[0].cost).toBeCloseTo((((2.5 * 250 * 0.53) / 2500) * 4.99) / 2);
		expect(sub[1].cost).toBeCloseTo((((250 * 0.91) / 454) * 5.99) / 2);
		// farine and tomates count; butter is a staple, the egg optional.
		expect([c.priced, c.counted]).toEqual([2, 2]);
		expect(c.total).toBeCloseTo(sub[0].cost! + sub[1].cost! + 0.89);
	});

	it('"1 piece" of a sub-recipe serving several, with no yield object, is ambiguous (a portion or the whole): unpriced', () => {
		// One crust of a pie dough that "serves 8" is not 1/8 of it.
		const base = recipe({ slug: 'base', servings: 8, ingredients: [{ items: [{ qty: 800, unit: 'g', name: 'tomates' }] }] });
		const one = recipe({ slug: 'one', ingredients: [{ items: [{ qty: 1, unit: 'piece', name: 'base', recipe: 'base' }] }] });
		const c = recipeCost(one, world([one, base], { base: ['tomates'] }));
		expect(c.lines).toMatchObject([{ reason: 'no-scale', counted: true }]);
		expect(c.total).toBe(0);
		expect(c.enough).toBe(false);
		// A yield written as text does not settle it either.
		const texte = recipe({ slug: 'texte', servings: 1, yield: '2 abaisses', ingredients: [] });
		expect(subRecipeFactor({ name: 'x', qty: { raw: 1, value: 1 }, unit: 'piece' }, texte, CONV)).toBeUndefined();
		// Nor does a servings range, even from 1.
		const range = recipe({ slug: 'range', servings: 1, servings_max: 2, ingredients: [] });
		expect(subRecipeFactor({ name: 'x', qty: { raw: 1, value: 1 }, unit: 'piece' }, range, CONV)).toBeUndefined();
	});

	it('by servings only when both readings agree: the sub-recipe serves exactly one and gives no yield', () => {
		const base = recipe({ slug: 'base', servings: 1, ingredients: [{ items: [{ qty: 800, unit: 'g', name: 'tomates' }] }] });
		const two = recipe({ slug: 'two', ingredients: [{ items: [{ qty: 2, unit: 'piece', name: 'base', recipe: 'base' }] }] });
		expect(recipeCost(two, world([two, base], { base: ['tomates'] })).total).toBeCloseTo(1.78 * 2);
		// A yield object in pieces is the unambiguous way to say "makes 2 crusts".
		const pate = recipe({ slug: 'pate2', servings: 8, yield: { qty: 2, unit: 'piece' }, ingredients: [] });
		expect(subRecipeFactor({ name: 'x', qty: { raw: 1, value: 1 }, unit: 'piece' }, pate, CONV)).toBe(0.5);
	});

	it('a sub-recipe in another unit than its yield is one unpriced line', () => {
		const base = recipe({ slug: 'base', servings: 4, ingredients: [{ items: [{ qty: 800, unit: 'g', name: 'tomates' }] }] });
		const cup = recipe({ slug: 'cup', ingredients: [{ items: [{ qty: 1, unit: 'cup', name: 'base', recipe: 'base' }] }] });
		const c = recipeCost(cup, world([cup, base], { base: ['tomates'] }));
		expect(c.lines).toMatchObject([{ reason: 'no-scale', counted: true }]);
		expect(subRecipeFactor({ name: 'x', qty: { raw: 500, value: 500 }, unit: 'ml' }, recipe({ slug: 'y', yield: { qty: 1, unit: 'l' }, ingredients: [] }), CONV)).toBe(0.5);
		// A yield given as text scales nothing.
		expect(subRecipeFactor({ name: 'x', qty: { raw: 1, value: 1 }, unit: 'cup' }, recipe({ slug: 'y', yield: '2 abaisses', ingredients: [] }), CONV)).toBeUndefined();
	});

	it('a missing sub-recipe and a cycle are one unpriced line, never a loop', () => {
		const a = recipe({ slug: 'a', ingredients: [{ items: [{ qty: 1, unit: 'piece', name: 'b', recipe: 'b' }, { qty: 1, unit: 'piece', name: 'z', recipe: 'z' }] }] });
		const b = recipe({ slug: 'b', yield: { qty: 1, unit: 'piece' }, ingredients: [{ items: [{ qty: 1, unit: 'piece', name: 'a', recipe: 'a' }, { qty: 400, unit: 'g', name: 'tomates' }] }] });
		const c = recipeCost(a, world([a, b], { b: [undefined, 'tomates'] }));
		expect(c.lines.map((l) => [l.name, l.reason ?? 'priced'])).toEqual([
			['a', 'cycle'],
			['tomates', 'priced'],
			['z', 'no-recipe']
		]);
		expect(c.total).toBeCloseTo(0.89);
	});
});

describe('links', () => {
	it('a queue row id needs no escaping', async () => {
		const { queueRowId, queueHref, ingredientHref, ingredientRowHref } = await import('../../src/lib/render/links');
		expect(queueRowId('creme 35 %')).toBe('k-creme-35-');
		expect(queueHref("huile d'olive")).toBe("/resoudre?cle=huile%20d'olive#k-huile-d-olive");
		expect(ingredientHref('farine')).toBe('/ingredients/farine');
		expect(ingredientRowHref('farine')).toBe('/ingredients#i-farine');
	});
});
