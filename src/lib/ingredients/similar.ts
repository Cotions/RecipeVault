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
//   flagged       = similarity ≥ DUPLICATE_THRESHOLD, or ≥ METHOD_FLOOR when
//                   the two methods are the same text (word pairs, Jaccard ≥
//                   METHOD_SIMILARITY): a copy with one ingredient swapped
//                   for another keeps its card's method (issue #13).
//   candidates    = prefix filtering: with a global order (heaviest first),
//                   two sets scoring ≥ t share an element inside both their
//                   prefixes, a prefix being the elements whose predecessors
//                   weigh at most (1 − t) of the set. Exact scores only on
//                   candidates; `similarPairsBrute` checks it in the tests.
//                   The same-method pairs below t come from a second prefix
//                   filter on the methods' word pairs (rarest first; plain
//                   Jaccard ≥ METHOD_SIMILARITY), their ingredients scored after.

import { stripMarkers } from '../vault/markers';
import { fold } from '../vault/normalize';
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
	/** The method's word pairs (`methodShingles`), for the second signal; absent: ingredients only. */
	method?: string[];
}

/** Fewer elements than this never pair: "café" and "vinaigrette" are not duplicates of anything. */
export const MIN_ELEMENTS = 3;

/**
 * Pairs at or above this score are flagged. Tuned on the invented corpus
 * (tests/duplicates-corpus.test.ts; plan 05, Phase 5: every planted copy
 * found, precision ≥ 90 %); recorded in docs/INGREDIENTS.md, "Duplicates".
 */
export const DUPLICATE_THRESHOLD = 0.65;

/**
 * The second signal (issue #13): a pair scoring at least this on ingredients
 * is flagged too when the two methods are the same text. Tuned on the corpus
 * and the bench (plan 05, "Issue #13"): every planted copy found, the swapped
 * ingredient included, precision ≥ 95 % on both.
 */
export const METHOD_FLOOR = 0.45;
/** Two methods are "the same text" from this Jaccard of their word pairs. */
export const METHOD_SIMILARITY = 0.8;
/** A method shorter than this many word pairs ("Mélanger. Cuire.") says nothing. */
export const METHOD_MIN_SHINGLES = 6;

/**
 * A recipe body's method as a sorted set of word pairs: headings out, folded
 * (case, accents), words of three letters or more (numbers, `de`, `et` out).
 */
export function methodShingles(body: string): string[] {
	const words = fold(
		stripMarkers(
			body
				.split('\n')
				.filter((l) => !/^\s*#/.test(l))
				.join('\n')
		)
	)
		.toLowerCase()
		.replace(/[^a-z]+/g, ' ')
		.split(' ')
		.filter((w) => w.length > 2);
	const out = new Set<string>();
	for (let i = 0; i + 1 < words.length; i++) out.add(`${words[i]} ${words[i + 1]}`);
	return [...out].sort();
}

/** Whether two methods are the same text (both long enough to say so). */
export function sameMethod(a: string[] | undefined, b: string[] | undefined): boolean {
	if (!a || !b || a.length < METHOD_MIN_SHINGLES || b.length < METHOD_MIN_SHINGLES) return false;
	let inter = 0;
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			inter++;
			i++;
			j++;
		} else if (a[i] < b[j]) i++;
		else j++;
	}
	return inter / (a.length + b.length - inter) >= METHOD_SIMILARITY - 1e-9;
}

/**
 * Whether a pair scoring `score` is flagged at `t`: above it, or above the
 * floor with the same method; `method` set whenever the methods are the same
 * text (above the floor), so a threshold sweep can apply the rule.
 */
function flagged(x: Pick<SimRecipe, 'method'>, y: Pick<SimRecipe, 'method'>, score: number, t: number): { method?: true } | null {
	const method = score >= METHOD_FLOOR - EPS && sameMethod(x.method, y.method);
	if (score < t - EPS && !method) return null;
	return method ? { method: true } : {};
}

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
	/** The ingredients' weighted Jaccard. */
	score: number;
	/** The two methods are the same text (and the score at least METHOD_FLOOR): flagged even below the threshold. */
	method?: true;
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
	const found = new Set<string>();
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
			const f = flagged(x, y, score, t);
			if (!f) continue;
			out.push(x.slug < y.slug ? { a: x.slug, b: y.slug, score, ...f } : { a: y.slug, b: x.slug, score, ...f });
			found.add(i < j ? `${i} ${j}` : `${j} ${i}`);
		}
		for (let k = 0; k < len; k++) {
			const list = postings.get(order[k]);
			if (list) list.push(i);
			else postings.set(order[k], [i]);
		}
	}
	// The second signal: pairs below t whose methods are the same text.
	for (const [i, j] of methodCandidates(rs)) {
		if (found.has(`${j} ${i}`)) continue;
		const x = rs[i];
		const y = rs[j];
		if (familyExcluded(x, y)) continue;
		const score = weightedJaccard(x.elements, y.elements, weight);
		const f = flagged(x, y, score, t);
		if (f) out.push(x.slug < y.slug ? { a: x.slug, b: y.slug, score, ...f } : { a: y.slug, b: x.slug, score, ...f });
	}
	return sortPairs(out);
}

/** Word pair → how many of `sets` have it: the methods' global order is rarest first. */
function methodFrequencies(rs: Pick<SimRecipe, 'method'>[]): Map<string, number> {
	const df = new Map<string, number>();
	for (const r of rs) if (r.method && r.method.length >= METHOD_MIN_SHINGLES) for (const w of r.method) df.set(w, (df.get(w) ?? 0) + 1);
	return df;
}

/** A method in the global order (rarest first) and its prefix for plain Jaccard ≥ METHOD_SIMILARITY. */
function methodPrefix(method: string[], df: Map<string, number>): string[] {
	const order = [...method].sort((x, y) => (df.get(x) ?? 0) - (df.get(y) ?? 0) || (x < y ? -1 : x > y ? 1 : 0));
	return order.slice(0, method.length - Math.ceil(METHOD_SIMILARITY * method.length - EPS) + 1);
}

/** Pairs `[i, j]` (j < i) of `rs` whose methods are the same text: prefix filtering on the word pairs, checked exactly. */
function methodCandidates(rs: Pick<SimRecipe, 'method'>[]): [number, number][] {
	const df = methodFrequencies(rs);
	// Word pairs as numbers in the global order (rarest first): a method sorted is its order, its prefix its head.
	const id = new Map([...df.keys()].sort((x, y) => df.get(x)! - df.get(y)! || (x < y ? -1 : 1)).map((w, k) => [w, k]));
	const sets = rs.map((r) => (r.method && r.method.length >= METHOD_MIN_SHINGLES ? Int32Array.from(r.method, (w) => id.get(w)!).sort() : null));
	const postings = new Map<number, number[]>();
	const out: [number, number][] = [];
	sets.forEach((x, i) => {
		if (!x) return;
		const n = x.length;
		const len = n - Math.ceil(METHOD_SIMILARITY * n - EPS) + 1;
		const seen = new Set<number>();
		for (let k = 0; k < len; k++) for (const j of postings.get(x[k]) ?? []) seen.add(j);
		for (const j of seen) {
			const y = sets[j]!;
			// Jaccard ≥ s needs the smaller set to be at least s of the larger one.
			if (Math.min(n, y.length) < METHOD_SIMILARITY * Math.max(n, y.length) - EPS) continue;
			if (overlapAtLeast(x, y)) out.push([i, j]);
		}
		for (let k = 0; k < len; k++) {
			const list = postings.get(x[k]);
			if (list) list.push(i);
			else postings.set(x[k], [i]);
		}
	});
	return out;
}

/** Plain Jaccard of two sorted number sets ≥ METHOD_SIMILARITY (as `sameMethod`). */
function overlapAtLeast(a: Int32Array, b: Int32Array): boolean {
	let inter = 0;
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			inter++;
			i++;
			j++;
		} else if (a[i] < b[j]) i++;
		else j++;
	}
	return inter / (a.length + b.length - inter) >= METHOD_SIMILARITY - 1e-9;
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
			const f = flagged(x, y, score, t);
			if (f) out.push(x.slug < y.slug ? { a: x.slug, b: y.slug, score, ...f } : { a: y.slug, b: x.slug, score, ...f });
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
	/** Every method word pair → the recipes using it, and how many do (the methods' order). */
	methods: Map<string, number[]>;
}

export function simIndex(recipes: SimRecipe[]): SimIndex {
	const rs = recipes.filter((r) => r.elements.length >= MIN_ELEMENTS);
	const postings = new Map<string, number[]>();
	const methods = new Map<string, number[]>();
	const add = (m: Map<string, number[]>, k: string, i: number) => {
		const list = m.get(k);
		if (list) list.push(i);
		else m.set(k, [i]);
	};
	rs.forEach((r, i) => {
		for (const e of r.elements) add(postings, e, i);
		if (r.method && r.method.length >= METHOD_MIN_SHINGLES) for (const w of r.method) add(methods, w, i);
	});
	return { recipes: rs, postings, methods };
}

/**
 * The vault recipes scoring ≥ `t` against one set (a paste or the form, not
 * saved): a vault recipe scoring ≥ t shares an element of the query's prefix
 * (the query's side of the prefix argument alone). `own` (the recipe being
 * edited) is left out.
 */
export function similarTo(
	q: Pick<SimRecipe, 'elements' | 'amounts' | 'family' | 'method'>,
	index: SimIndex,
	weight: (e: string) => number,
	t = DUPLICATE_THRESHOLD,
	own?: string
): { slug: string; score: number; method?: true }[] {
	if (q.elements.length < MIN_ELEMENTS) return [];
	const [{ order, len }] = prefixes([{ slug: '', ...q }], weight, t);
	const seen = new Set<number>();
	for (let k = 0; k < len; k++) for (const j of index.postings.get(order[k]) ?? []) seen.add(j);
	// The second signal: a vault method the same text shares a word pair of the query's method prefix.
	if (q.method && q.method.length >= METHOD_MIN_SHINGLES) {
		const df = new Map(q.method.map((w) => [w, index.methods.get(w)?.length ?? 0]));
		for (const w of methodPrefix(q.method, df)) for (const j of index.methods.get(w) ?? []) seen.add(j);
	}
	const out: { slug: string; score: number; method?: true }[] = [];
	for (const j of seen) {
		const y = index.recipes[j];
		if (y.slug === own || familyExcluded(q, y)) continue;
		const score = weightedJaccard(q.elements, y.elements, weight);
		const f = flagged(q, y, score, t);
		if (f) out.push({ slug: y.slug, score, ...f });
	}
	return out.sort((x, y) => y.score - x.score || x.slug.localeCompare(y.slug));
}

/**
 * Within one batch (a paste, `vault add` with several files), for each set
 * the earlier sets of the batch scoring ≥ `t` against it — the later file
 * names the earlier one, which is not saved yet. `null` for a file with no
 * recipe. Same rules as the vault pairs: MIN_ELEMENTS, Q16 C family pairs
 * out; `skip(i, j)` leaves out a pair (settled, or not being saved).
 */
export function batchPairs(
	sets: (Pick<SimRecipe, 'elements' | 'amounts' | 'family' | 'method'> | null)[],
	weight: (e: string) => number,
	t = DUPLICATE_THRESHOLD,
	skip: (i: number, j: number) => boolean = () => false
): { index: number; score: number; method?: true }[][] {
	return sets.map((x, i) => {
		if (!x || x.elements.length < MIN_ELEMENTS) return [];
		const out: { index: number; score: number; method?: true }[] = [];
		for (let j = 0; j < i; j++) {
			const y = sets[j];
			if (!y || y.elements.length < MIN_ELEMENTS || familyExcluded(x, y) || skip(i, j)) continue;
			const score = weightedJaccard(x.elements, y.elements, weight);
			const f = flagged(x, y, score, t);
			if (f) out.push({ index: j, score, ...f });
		}
		return out.sort((p, q) => q.score - p.score || p.index - q.index);
	});
}
