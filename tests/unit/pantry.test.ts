// The pantry tiers (plan 03, Phase 7, Q19 A, Q20 A): src/lib/ingredients/pantry.ts.

import { describe, expect, it } from 'vitest';
import { pantrySearch, type PantryNeed, type PantryRecipe, type PantryWorld } from '../../src/lib/ingredients/pantry';

const STAPLES = ['sel', 'farine', 'beurre', 'sucre'];
const world = (substitutes: Record<string, string[]> = {}, allergens: Record<string, string[]> = {}): PantryWorld => ({
	staples: new Set(STAPLES),
	substitutes: new Map(Object.entries(substitutes)),
	allergenSlugs: new Map(Object.entries(allergens).map(([a, s]) => [a, new Set(s)]))
});
const item = (...accepted: string[]): PantryNeed => ({ kind: 'item', accepted, staple: accepted.some((s) => STAPLES.includes(s)) });
function recipe(slug: string, needs: PantryNeed[], extra: Partial<PantryRecipe> = {}): PantryRecipe {
	const uses = new Set<string>();
	const walk = (ns: PantryNeed[]) => ns.forEach((n) => (n.kind === 'item' ? n.accepted.forEach((s) => uses.add(s)) : (n.buy && uses.add(n.buy), walk(n.needs))));
	walk(needs);
	return { slug, title: slug, rating: null, totalS: null, needs, unresolved: 0, uses, ...extra };
}

const crepes = recipe('crepes', [item('farine'), item('oeuf'), item('lait'), item('sel')]);

describe('pantrySearch', () => {
	it('prêt when nothing required is missing; assumed staples are not required unless picked', () => {
		const [r] = pantrySearch([crepes], { have: ['oeuf', 'lait'] }, world());
		expect(r).toMatchObject({ tier: 'pret', required: 2, matched: 2, coverage: 1, missing: [], used: 2 });
		const [picked] = pantrySearch([crepes], { have: ['oeuf', 'lait', 'farine'] }, world());
		expect(picked).toMatchObject({ tier: 'pret', required: 3, matched: 3, used: 3 });
	});

	it('without the staples assumed, they are required like the rest', () => {
		const [r] = pantrySearch([crepes], { have: ['oeuf', 'lait'], assumeStaples: false }, world());
		expect(r).toMatchObject({ tier: 'presque', required: 4, matched: 2, missing: [['farine'], ['sel']] });
	});

	it('a recipe using none of the picked ingredients is not a result, even when its staples are all had', () => {
		const shortbread = recipe('sables', [item('farine'), item('beurre'), item('sucre')]);
		expect(pantrySearch([shortbread], { have: ['lait'] }, world())).toEqual([]);
		expect(pantrySearch([shortbread], { have: ['beurre'] }, world()).map((r) => r.tier)).toEqual(['pret']);
	});

	it('an `or` line is met by any of its choices', () => {
		const tarte = recipe('tarte', [item('sirop-d-erable', 'melasse'), item('cassonade')]);
		const [r] = pantrySearch([tarte], { have: ['melasse', 'cassonade'] }, world());
		expect(r.tier).toBe('pret');
		const [m] = pantrySearch([tarte], { have: ['cassonade'] }, world());
		expect(m.missing).toEqual([['sirop-d-erable', 'melasse']]);
	});

	it('substitution: every missing need replaced by something had, in the entry’s direction only', () => {
		const r = recipe('gateau', [item('oeuf'), item('margarine')]);
		const subs = { margarine: ['beurre'] };
		// beurre is a staple, assumed had: margarine → beurre.
		const [a] = pantrySearch([r], { have: ['oeuf'] }, world(subs));
		expect(a).toMatchObject({ tier: 'substitution', swaps: [{ missing: 'margarine', with: 'beurre' }] });
		// The other way does not hold: beurre lists no substitute.
		const b = recipe('gateau-beurre', [item('oeuf'), item('creme')]);
		const [c] = pantrySearch([b], { have: ['oeuf'] }, world({ lait: ['creme'] }));
		expect(c.tier).toBe('presque');
		expect(c.swaps).toEqual([]);
	});

	it('never swaps in an ingredient she avoids, by name or by allergen', () => {
		const r = recipe('gateau', [item('oeuf'), item('margarine')]);
		const w = world({ margarine: ['beurre'] }, { lait: ['beurre'] });
		for (const q of [{ avoid: ['beurre'] }, { allergens: ['lait'] }]) {
			const [a] = pantrySearch([r], { have: ['oeuf'], ...q }, w);
			expect(a).toMatchObject({ tier: 'presque', swaps: [], missing: [['margarine']] });
		}
	});

	it('presque at two missing, idées beyond', () => {
		const r = recipe('ragout', [item('boeuf'), item('carotte'), item('oignon'), item('patate')]);
		expect(pantrySearch([r], { have: ['boeuf', 'carotte'] }, world())[0].tier).toBe('presque');
		expect(pantrySearch([r], { have: ['boeuf'] }, world())[0].tier).toBe('idees');
	});

	it('a sub-recipe counts its own needs; `buy_instead` is met by the bought entry', () => {
		const pate: PantryNeed = { kind: 'sub', buy: 'pate-a-tarte', needs: [item('farine'), item('saindoux')], unresolved: 1 };
		const tarte = recipe('tarte-au-sucre', [item('cassonade'), pate]);
		const [made] = pantrySearch([tarte], { have: ['cassonade'] }, world());
		expect(made).toMatchObject({ tier: 'presque', missing: [['saindoux']], unresolved: 1 });
		const [bought] = pantrySearch([tarte], { have: ['cassonade', 'pate-a-tarte'] }, world());
		expect(bought).toMatchObject({ tier: 'pret', required: 2, matched: 2, used: 2, unresolved: 0 });
	});

	it('"doit contenir" keeps only recipes using every pinned item, and counts them as had', () => {
		const a = recipe('a', [item('oeuf'), item('lait')]);
		const b = recipe('b', [item('oeuf'), item('jambon')]);
		const r = pantrySearch([a, b], { have: ['oeuf'], must: ['lait'] }, world());
		expect(r.map((x) => [x.slug, x.tier])).toEqual([['a', 'pret']]);
	});

	it('"à éviter" and allergens leave out a recipe using them anywhere, optional lines included', () => {
		const a = recipe('a', [item('oeuf'), item('lait')]);
		const b = recipe('b', [item('oeuf')], { uses: new Set(['oeuf', 'noix-de-grenoble']) });
		const w = world({}, { noix: ['noix-de-grenoble'], lait: ['lait', 'beurre'] });
		expect(pantrySearch([a, b], { have: ['oeuf'], avoid: ['lait'] }, w).map((x) => x.slug)).toEqual(['b']);
		expect(pantrySearch([a, b], { have: ['oeuf'], allergens: ['noix'] }, w).map((x) => x.slug)).toEqual(['a']);
		expect(pantrySearch([a, b], { have: ['oeuf'], allergens: ['noix', 'lait'] }, w)).toEqual([]);
	});

	it('unresolved lines are not required and are reported', () => {
		const r = recipe('soupe', [item('pois')], { unresolved: 2 });
		expect(pantrySearch([r], { have: ['pois'] }, world())[0]).toMatchObject({ tier: 'pret', unresolved: 2, coverage: 1 });
	});

	it('sorts by tier, coverage, fewest missing, most picks used, rating, time, title', () => {
		const rs = [
			recipe('c', [item('oeuf'), item('x'), item('y')]),
			recipe('b', [item('oeuf'), item('x')], { rating: 3 }),
			recipe('a', [item('oeuf'), item('x')], { rating: 5 }),
			recipe('d', [item('oeuf')], { totalS: 600 }),
			recipe('e', [item('oeuf')], { totalS: 300 })
		];
		expect(pantrySearch(rs, { have: ['oeuf'] }, world()).map((x) => x.slug)).toEqual(['e', 'd', 'a', 'b', 'c']);
	});
});
