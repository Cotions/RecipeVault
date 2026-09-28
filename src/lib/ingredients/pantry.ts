// Pantry search, "qu'est-ce que je peux faire avec ce que j'ai"
// (docs/INGREDIENTS.md, "Pantry search"; plan 03, Phase 7, Q19, Q20). The
// tier rules, pure and browser-safe: the server builds each recipe's needs
// from the index (src/lib/server/index/pantry.ts) and evaluates them here.
//
//   have      = picked slugs (+ every staple when "supposer les essentiels")
//   required  = lines not optional, not in an optional group, not to_taste,
//               not a staple when staples are assumed (unless picked: a
//               picked staple counts, matched); an `or` line is met by
//               any of its choices; sub-recipes recurse (a `buy_instead`
//               sub-recipe is also met by a registry entry of its slug)
//   missing   = required − have;  coverage = matched / required
//
// Tiers, first that applies: prêt (nothing missing), substitution (every
// missing need has a substitute in `have`, in the missing item's direction),
// presque (≤ 2 missing), idées (the rest). A recipe is a result only when it
// uses at least one ingredient she picked: a recipe made of staples alone is
// not an answer to "what can I make with this".

export const TIERS = ['pret', 'substitution', 'presque', 'idees'] as const;
export type Tier = (typeof TIERS)[number];

/** How many missing items "presque" allows. */
export const ALMOST = 2;

/** One need of a recipe: met by any of `accepted` (the line's item and its `or` choices). */
export interface Need {
	kind: 'item';
	/** Registry slugs, the main one first. */
	accepted: string[];
	/** Any choice is a staple: out of `required` when staples are assumed. */
	staple: boolean;
}

/** A sub-recipe line: its own needs, or (with `buy_instead`) a registry entry of its slug. */
export interface SubNeed {
	kind: 'sub';
	/** The registry slug that buys it instead, when `buy_instead` and such an entry exists. */
	buy?: string;
	needs: PantryNeed[];
	/** Lines of the sub-recipe left out because they are not linked to the registry. */
	unresolved: number;
}

export type PantryNeed = Need | SubNeed;

export interface PantryRecipe {
	slug: string;
	title: string;
	rating: number | null;
	totalS: number | null;
	needs: PantryNeed[];
	/** Required lines not linked to the registry (or naming a missing sub-recipe): left out, and said so (Q19). */
	unresolved: number;
	/** Every registry slug the recipe uses, optional lines, `or` choices and sub-recipes included: for "doit contenir" and "à éviter". */
	uses: Set<string>;
}

export interface PantryQuery {
	/** Picked ingredient slugs. */
	have: string[];
	/** Pinned: only recipes using every one (and they count as had). */
	must?: string[];
	/** Recipes using any of these are left out. */
	avoid?: string[];
	/** Allergen slugs: recipes using an ingredient carrying one are left out. */
	allergens?: string[];
	/** "Supposer les essentiels" (Q19 A: on by default). */
	assumeStaples?: boolean;
}

export interface PantryWorld {
	staples: ReadonlySet<string>;
	/** slug → the slugs that can replace it (the entry's `substitutes`). */
	substitutes: ReadonlyMap<string, readonly string[]>;
	/** allergen → slugs of entries carrying it. */
	allergenSlugs: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface Swap {
	/** The missing ingredient. */
	missing: string;
	/** What she has that replaces it. */
	with: string;
}

export interface PantryResult {
	slug: string;
	title: string;
	tier: Tier;
	required: number;
	matched: number;
	/** matched / required; 1 when nothing is required. */
	coverage: number;
	/** Each missing need, as the slugs that would meet it (the main one first). */
	missing: string[][];
	/** The substitution tier: the swap for each missing need. */
	swaps: Swap[];
	/** Picked ingredients the recipe uses. */
	used: number;
	unresolved: number;
	rating: number | null;
	totalS: number | null;
}

interface Tally {
	required: number;
	matched: number;
	missing: string[][];
	unresolved: number;
}

function tally(needs: readonly PantryNeed[], have: ReadonlySet<string>, picked: ReadonlySet<string>, assume: boolean, t: Tally): void {
	for (const n of needs) {
		if (n.kind === 'sub') {
			if (n.buy && have.has(n.buy)) {
				t.required++;
				t.matched++;
				continue;
			}
			t.unresolved += n.unresolved;
			tally(n.needs, have, picked, assume, t);
			continue;
		}
		// An assumed staple is out of the count, unless she picked it: then it is one of hers.
		if (assume && n.staple && !n.accepted.some((s) => picked.has(s))) continue;
		t.required++;
		if (n.accepted.some((s) => have.has(s))) t.matched++;
		else t.missing.push(n.accepted);
	}
}

/** Collator-free comparison: nulls last. */
const cmpNum = (a: number | null, b: number | null, desc: boolean) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : desc ? b - a : a - b);

/**
 * Evaluate every recipe against the pantry. Results in tier order; within a
 * tier by coverage (high first), fewest missing, most picked ingredients used,
 * highest rating, shortest total time, then title.
 */
export function pantrySearch(recipes: Iterable<PantryRecipe>, q: PantryQuery, w: PantryWorld): PantryResult[] {
	const assume = q.assumeStaples ?? true;
	const picked = new Set([...q.have, ...(q.must ?? [])]);
	const have = new Set(picked);
	if (assume) for (const s of w.staples) have.add(s);
	const avoid = new Set(q.avoid ?? []);
	for (const a of q.allergens ?? []) for (const s of w.allergenSlugs.get(a) ?? []) avoid.add(s);
	const must = q.must ?? [];
	const out: PantryResult[] = [];
	for (const r of recipes) {
		if (must.some((s) => !r.uses.has(s))) continue;
		let avoided = false;
		for (const s of avoid)
			if (r.uses.has(s)) {
				avoided = true;
				break;
			}
		if (avoided) continue;
		const t: Tally = { required: 0, matched: 0, missing: [], unresolved: r.unresolved };
		tally(r.needs, have, picked, assume, t);
		const used = usedPicks(r.needs, picked, have);
		if (!used) continue;
		const swaps: Swap[] = [];
		for (const m of t.missing) {
			const sw = m.flatMap((s) => (w.substitutes.get(s) ?? []).filter((x) => have.has(x)).map((x) => ({ missing: s, with: x })))[0];
			if (sw) swaps.push(sw);
		}
		const tier: Tier = !t.missing.length ? 'pret' : swaps.length === t.missing.length ? 'substitution' : t.missing.length <= ALMOST ? 'presque' : 'idees';
		out.push({
			slug: r.slug,
			title: r.title,
			tier,
			required: t.required,
			matched: t.matched,
			coverage: t.required ? t.matched / t.required : 1,
			missing: t.missing,
			swaps: tier === 'substitution' ? swaps : [],
			used,
			unresolved: t.unresolved,
			rating: r.rating,
			totalS: r.totalS
		});
	}
	const order = new Map(TIERS.map((x, i) => [x, i]));
	return out.sort(
		(a, b) =>
			order.get(a.tier)! - order.get(b.tier)! ||
			b.coverage - a.coverage ||
			a.missing.length - b.missing.length ||
			b.used - a.used ||
			cmpNum(a.rating, b.rating, true) ||
			cmpNum(a.totalS, b.totalS, false) ||
			a.title.localeCompare(b.title, 'fr')
	);
}

/**
 * How many picked ingredients meet a need of the recipe (staples included:
 * picking *œufs* finds the crêpes even when eggs are assumed). A bought
 * sub-recipe counts its own slug, not what is inside it.
 */
function usedPicks(needs: readonly PantryNeed[], picked: ReadonlySet<string>, have: ReadonlySet<string>, seen = new Set<string>()): number {
	for (const n of needs) {
		if (n.kind === 'sub') {
			if (n.buy && have.has(n.buy)) {
				if (picked.has(n.buy)) seen.add(n.buy);
			} else usedPicks(n.needs, picked, have, seen);
			continue;
		}
		for (const s of n.accepted) if (picked.has(s)) seen.add(s);
	}
	return seen.size;
}
