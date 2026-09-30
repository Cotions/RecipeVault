// Duplicate detection by ingredient set (PLANNING.md, Gaps review, Tier 2;
// plan 05, Phase 5, Q10 A, Q11 B, Q16 C; docs/INGREDIENTS.md, "Duplicates").
// Pure and browser-safe: the server builds each recipe's lines from the index
// (src/lib/server/index/similar.ts) and calls these.
//
//   element set (Q10 A) = every line not optional (item or group) and not
//                   `to_taste`, as its registry slug, else `k:<lookup key>`;
//                   a sub-recipe line as one element `r:<slug>` (not
//                   flattened); `or` choices ignored; staples kept. A recipe
//                   with fewer than MIN_ELEMENTS elements never pairs.
//   weight (Q11 B) = ln(1 + N / df): N recipes in the vault, df those using
//                   the element — computed from the vault itself, so a staple
//                   counts for little with no list of "common ingredients".
//   similarity    = weighted Jaccard, Σ w(A ∩ B) / Σ w(A ∪ B).
//   candidates    = prefix filtering: with a global order (heaviest first),
//                   two sets scoring ≥ t share an element inside both their
//                   prefixes, a prefix being the elements whose predecessors
//                   weigh at most (1 − t) of the set. Exact scores only on
//                   candidates; `similarPairsBrute` checks it in the tests.

import type { Recipe } from '../vault/types';
import type { Resolver } from './resolve';

/** A line as the index has it (the `ingredients` table). */
export interface SimLine {
	item: string | null;
	key: string;
	recipe: string | null;
	optional: boolean;
	groupOptional: boolean;
	toTaste: boolean;
	qty: number | null;
	qtyMax: number | null;
	unit: string | null;
}

/** A recipe's element set, sorted, and the amounts of its counted lines (Q16 C: "the same card twice"). */
export interface SimSet {
	elements: string[];
	/** The counted lines' elements with their amounts, sorted: equal for two copies of one card. */
	amounts: string;
}

export interface SimRecipe extends SimSet {
	slug: string;
	family: string | null;
}

/** Fewer elements than this never pair: "café" and "vinaigrette" are not duplicates of anything. */
export const MIN_ELEMENTS = 3;

/**
 * Pairs at or above this score are flagged. Tuned on the invented corpus
 * (tests/duplicates-corpus.test.ts; plan 05, Phase 5: every planted copy
 * found, precision ≥ 90 %); recorded in docs/INGREDIENTS.md, "Duplicates".
 */
export const DUPLICATE_THRESHOLD = 0.65;

/** Whether a line counts in the set (Q10 A). */
export const counted = (l: Pick<SimLine, 'optional' | 'groupOptional' | 'toTaste'>) => !l.optional && !l.groupOptional && !l.toTaste;

/** The identity of a line: its sub-recipe, its registry entry, else its lookup key (the family diff's `COALESCE(item, 'k:' || key)`). */
export function elementOf(l: Pick<SimLine, 'item' | 'key' | 'recipe'>): string {
	if (l.recipe) return `r:${l.recipe}`;
	return l.item ?? `k:${l.key}`;
}

const num = (n: number | null) => (n === null ? '' : String(Math.round(n * 1e6) / 1e6));

/** The element set of a recipe's lines. */
export function elementSet(lines: SimLine[]): SimSet {
	const els = new Set<string>();
	const amounts: string[] = [];
	for (const l of lines) {
		if (!counted(l)) continue;
		const e = elementOf(l);
		els.add(e);
		amounts.push(`${e}|${num(l.qty)}|${num(l.qtyMax)}|${l.unit ?? ''}`);
	}
	return { elements: [...els].sort(), amounts: amounts.sort().join('\n') };
}

/** A recipe's lines as the index would store them: each item resolved (a recipe not yet saved: the paste, the form). */
export function recipeLines(recipe: Pick<Recipe, 'ingredients' | 'lang'>, resolver: Pick<Resolver, 'resolve'>): SimLine[] {
	return recipe.ingredients.flatMap((g) =>
		g.items.map((it) => {
			const r = resolver.resolve(it, recipe.lang);
			return {
				item: r.item,
				key: r.key,
				recipe: it.recipe ?? null,
				optional: !!it.optional,
				groupOptional: !!g.optional,
				toTaste: !!it.toTaste,
				qty: it.qty?.value ?? null,
				qtyMax: it.qtyMax?.value ?? null,
				unit: it.unit ?? null
			};
		})
	);
}

/** Element → weight, from how many of `sets` use it: ln(1 + N / df). */
export function rarityWeights(sets: { elements: string[] }[]): Map<string, number> {
	const df = new Map<string, number>();
	for (const s of sets) for (const e of s.elements) df.set(e, (df.get(e) ?? 0) + 1);
	const n = Math.max(sets.length, 1);
	const w = new Map<string, number>();
	for (const [e, d] of df) w.set(e, Math.log(1 + n / d));
	return w;
}

/** The weight of an element; one the vault does not use yet is as rare as can be (df = 1). */
export function weightOf(w: Map<string, number>, n: number, e: string): number {
	return w.get(e) ?? Math.log(1 + Math.max(n, 1));
}

/** Weighted Jaccard of two sorted element lists. */
export function weightedJaccard(a: string[], b: string[], weight: (e: string) => number): number {
	let inter = 0;
	let union = 0;
	let i = 0;
	let j = 0;
	while (i < a.length || j < b.length) {
		if (j >= b.length || (i < a.length && a[i] < b[j])) union += weight(a[i++]);
		else if (i >= a.length || b[j] < a[i]) union += weight(b[j++]);
		else {
			const x = weight(a[i]);
			inter += x;
			union += x;
			i++;
			j++;
		}
	}
	return union > 0 ? inter / union : 0;
}

/** Shared elements and those only in each, of two sorted lists. */
export function splitSets(a: string[], b: string[]): { shared: string[]; onlyA: string[]; onlyB: string[] } {
	const sb = new Set(b);
	const sa = new Set(a);
	return { shared: a.filter((e) => sb.has(e)), onlyA: a.filter((e) => !sb.has(e)), onlyB: b.filter((e) => !sa.has(e)) };
}

export interface SimPair {
	/** a < b. */
	a: string;
	b: string;
	score: number;
}

/**
 * Q16 C: two recipes of one family are declared versions; left out unless
 * they are the same card twice (identical element set and amounts).
 */
export function familyExcluded(x: Pick<SimRecipe, 'family' | 'elements' | 'amounts'>, y: Pick<SimRecipe, 'family' | 'elements' | 'amounts'>): boolean {
	if (!x.family || x.family !== y.family) return false;
	return !(x.amounts === y.amounts && x.elements.join('\n') === y.elements.join('\n'));
}

const EPS = 1e-9;

/** Each set's elements in the global order (heaviest first, then by name) and the prefix length for threshold `t`. */
function prefixes(recipes: SimRecipe[], weight: (e: string) => number, t: number): { order: string[]; len: number }[] {
	const cmp = (x: string, y: string) => weight(y) - weight(x) || (x < y ? -1 : x > y ? 1 : 0);
	return recipes.map((r) => {
		const order = [...r.elements].sort(cmp);
		const total = order.reduce((s, e) => s + weight(e), 0);
		// An element is in the prefix when what comes before it weighs at most (1 − t) of the set.
		let before = 0;
		let len = 0;
		for (const e of order) {
			if (before > (1 - t) * total + EPS) break;
			len++;
			before += weight(e);
		}
		return { order, len };
	});
}

/**
 * Every pair of `recipes` scoring ≥ `t`, by prefix filtering over an inverted
 * index (the fast path). Recipes under MIN_ELEMENTS never pair; family pairs
 * per Q16 C are left out. Sorted by score, then slugs.
 */
export function similarPairs(recipes: SimRecipe[], weight: (e: string) => number, t = DUPLICATE_THRESHOLD): SimPair[] {
	const rs = recipes.filter((r) => r.elements.length >= MIN_ELEMENTS);
	const pre = prefixes(rs, weight, t);
	const postings = new Map<string, number[]>();
	const out: SimPair[] = [];
	for (let i = 0; i < rs.length; i++) {
		const { order, len } = pre[i];
		const seen = new Set<number>();
		for (let k = 0; k < len; k++) {
			const list = postings.get(order[k]);
			if (list) for (const j of list) seen.add(j);
		}
		for (const j of seen) {
			const x = rs[i];
			const y = rs[j];
			if (familyExcluded(x, y)) continue;
			const score = weightedJaccard(x.elements, y.elements, weight);
			if (score >= t - EPS) out.push(x.slug < y.slug ? { a: x.slug, b: y.slug, score } : { a: y.slug, b: x.slug, score });
		}
		for (let k = 0; k < len; k++) {
			const list = postings.get(order[k]);
			if (list) list.push(i);
			else postings.set(order[k], [i]);
		}
	}
	return sortPairs(out);
}

/** Every pair checked: the reference `similarPairs` must equal. */
export function similarPairsBrute(recipes: SimRecipe[], weight: (e: string) => number, t = DUPLICATE_THRESHOLD): SimPair[] {
	const rs = recipes.filter((r) => r.elements.length >= MIN_ELEMENTS);
	const out: SimPair[] = [];
	for (let i = 0; i < rs.length; i++)
		for (let j = i + 1; j < rs.length; j++) {
			const x = rs[i];
			const y = rs[j];
			if (familyExcluded(x, y)) continue;
			const score = weightedJaccard(x.elements, y.elements, weight);
			if (score >= t - EPS) out.push(x.slug < y.slug ? { a: x.slug, b: y.slug, score } : { a: y.slug, b: x.slug, score });
		}
	return sortPairs(out);
}

export function sortPairs(ps: SimPair[]): SimPair[] {
	return ps.sort((p, q) => q.score - p.score || p.a.localeCompare(q.a) || p.b.localeCompare(q.b));
}

/** An element → recipes index over the prefixes, for one recipe not yet saved (`similarTo`). */
export interface SimIndex {
	recipes: SimRecipe[];
	/** Every element → the recipes using it (a query's prefix may be any of its elements). */
	postings: Map<string, number[]>;
}

export function simIndex(recipes: SimRecipe[]): SimIndex {
	const rs = recipes.filter((r) => r.elements.length >= MIN_ELEMENTS);
	const postings = new Map<string, number[]>();
	rs.forEach((r, i) => {
		for (const e of r.elements) {
			const list = postings.get(e);
			if (list) list.push(i);
			else postings.set(e, [i]);
		}
	});
	return { recipes: rs, postings };
}

/**
 * The vault recipes scoring ≥ `t` against one set (a paste or the form, not
 * saved): a vault recipe scoring ≥ t shares an element of the query's prefix
 * (the query's side of the prefix argument alone). `own` (the recipe being
 * edited) is left out.
 */
export function similarTo(
	q: Pick<SimRecipe, 'elements' | 'amounts' | 'family'>,
	index: SimIndex,
	weight: (e: string) => number,
	t = DUPLICATE_THRESHOLD,
	own?: string
): { slug: string; score: number }[] {
	if (q.elements.length < MIN_ELEMENTS) return [];
	const [{ order, len }] = prefixes([{ slug: '', family: null, ...q }], weight, t);
	const seen = new Set<number>();
	for (let k = 0; k < len; k++) for (const j of index.postings.get(order[k]) ?? []) seen.add(j);
	const out: { slug: string; score: number }[] = [];
	for (const j of seen) {
		const y = index.recipes[j];
		if (y.slug === own || familyExcluded(q, y)) continue;
		const score = weightedJaccard(q.elements, y.elements, weight);
		if (score >= t - EPS) out.push({ slug: y.slug, score });
	}
	return out.sort((x, y) => y.score - x.score || x.slug.localeCompare(y.slug));
}
