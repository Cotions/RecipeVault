// Consumed cost and coverage of a recipe (docs/INGREDIENTS.md, "Cost";
// plan 03, Phase 5, Q14–Q18). Browser-safe and pure: every lookup is a
// function the caller supplies. The resolved ingredient of a line is read
// through `itemAt(recipe, position)`, which the server answers from the index
// (`ingredients.item`), so a change to resolution needs no change here.

import type { Ingredient, Recipe, Unit } from '../vault/types';
import { isStale } from './prices';
import { UNIT_CLASS_OF } from './types';
import { measure, noteSize, packsOf, type Conversions, type Convertible } from './units';

/** Below this share of counted items priced, no figure is shown (Q14). */
export const COVERAGE_THRESHOLD = 0.7;

export interface CostEntry extends Convertible {
	staple: boolean;
}

export interface CostPrice {
	amount: number;
	packQty: number;
	packUnit: Unit;
	/** YYYY-MM-DD. */
	date: string;
}

export interface CostSources {
	/** The registry slug a recipe's line resolved to, by its position across groups; undefined when unresolved. */
	itemAt(recipe: string, position: number): string | undefined;
	entry(slug: string): CostEntry | undefined;
	/** The current price of an ingredient (the latest row in the configured currency). */
	price(slug: string): CostPrice | undefined;
	/** A sub-recipe, parsed. */
	recipe(slug: string): Recipe | undefined;
	conversions: Conversions;
	/** For staleness; YYYY-MM-DD. */
	today: string;
}

export type CostReason =
	/** Optional item or optional group: out of cost and coverage (Q18). */
	| 'optional'
	/** Not linked to the registry. */
	| 'unresolved'
	/** No current price. */
	| 'no-price'
	/** No quantity to price. */
	| 'no-qty'
	/** No common measure between the amount and the pack. */
	| 'no-conversion'
	/** The sub-recipe does not exist. */
	| 'no-recipe'
	/** The sub-recipe's yield or servings cannot scale this amount (Q16). */
	| 'no-scale'
	/** The sub-recipe uses a recipe it is part of (E213 blocks this; stay defensive). */
	| 'cycle';

export interface CostLine {
	/** Position in the recipe across groups; a sub-recipe's lines carry the position of the line that uses it. */
	position: number;
	/** The sub-recipes this line came through, outermost first; empty for the recipe's own lines. */
	via: string[];
	name: string;
	/** Registry slug, when resolved. */
	item?: string;
	/** Cost at the recipe's base servings. Absent when unpriced or excluded. */
	cost?: number;
	reason?: CostReason;
	staple: boolean;
	toTaste: boolean;
	/** In the coverage denominator: not optional, not `to_taste`, not a staple (Q17). */
	counted: boolean;
	/** The price used is more than a year old. */
	stale: boolean;
}

export interface RecipeCost {
	/** Consumed cost at the base servings, priced lines only. */
	total: number;
	/** Counted lines with a cost. */
	priced: number;
	counted: number;
	/** priced / counted; null when nothing counts. */
	coverage: number | null;
	/** Coverage reaches the threshold (or, when nothing counts, every line is priced): the figure is shown. */
	enough: boolean;
	/** total / servings (the lower bound, Q15); null without servings. */
	perServing: number | null;
	servings: number | null;
	/** Some price used is stale. */
	stale: boolean;
	lines: CostLine[];
}

/** The amount priced: the upper bound of a range (Q15). */
const upper = (q?: { value: number }, max?: { value: number }) => max?.value ?? q?.value;

/**
 * How many of the sub-recipe one line of `qty unit` is (Q16 A): against a
 * `yield` object in the same unit (or the same class, by the fixed factors);
 * else against `servings` when the line counts pieces; else undefined.
 */
export function subRecipeFactor(item: Ingredient, sub: Recipe, conv: Conversions): number | undefined {
	const q = upper(item.qty, item.qtyMax);
	if (q === undefined) return undefined;
	const unit: Unit = item.unit ?? 'piece';
	const y = typeof sub.yield === 'object' ? sub.yield : undefined;
	// The lower bound of a yield range: never under-state what one line costs.
	const yq = y?.qty?.value;
	const yu: Unit | undefined = y?.unit ?? (yq !== undefined ? 'piece' : undefined);
	if (yq && yu) {
		if (yu === unit) return q / yq;
		const cls = UNIT_CLASS_OF[unit];
		if (cls === UNIT_CLASS_OF[yu] && (cls === 'mass' || cls === 'volume')) {
			const f = conv[cls][unit];
			const fy = conv[cls][yu];
			if (f && fy) return (q * f) / (yq * fy);
		}
	}
	if (unit === 'piece' && sub.servings) return q / sub.servings;
	return undefined;
}

/** The consumed cost of one line: packs × price, or the reason it has none. */
function lineCost(item: Ingredient, entry: CostEntry, price: CostPrice, conv: Conversions, lang: Recipe['lang']): { cost?: number; reason?: CostReason } {
	let q = upper(item.qty, item.qtyMax);
	const unit: Unit | undefined = item.unit ?? (q !== undefined ? 'piece' : undefined);
	// "une boîte de tomates" without a qty is one of it; a mass or a volume without one is nothing.
	if (q === undefined && unit && (UNIT_CLASS_OF[unit] === 'count' || UNIT_CLASS_OF[unit] === 'container')) q = 1;
	if (q === undefined || !unit) return { reason: 'no-qty' };
	const pack = measure(price.packQty, price.packUnit, entry, conv);
	let packs = packsOf(measure(q, unit, entry, conv, noteSize(item.note, lang)), pack);
	// `alt` is the same amount in another measure: used when the main one cannot be priced.
	if (packs === undefined && item.alt) packs = packsOf(measure(upper(item.alt.qty, item.alt.qtyMax)!, item.alt.unit, entry, conv), pack);
	if (packs === undefined) return { reason: 'no-conversion' };
	return { cost: packs * price.amount };
}

/** Cost and coverage of a recipe, its sub-recipes flattened in (Q16 A). */
export function recipeCost(recipe: Recipe, src: CostSources, threshold = COVERAGE_THRESHOLD): RecipeCost {
	const lines: CostLine[] = [];
	walk(recipe, 1, [], undefined, new Set([recipe.slug]), src, lines);
	let total = 0;
	let priced = 0;
	let counted = 0;
	let stale = false;
	for (const l of lines) {
		if (l.cost !== undefined) {
			total += l.cost;
			stale ||= l.stale;
		}
		if (l.counted) {
			counted++;
			if (l.cost !== undefined) priced++;
		}
	}
	const coverage = counted ? priced / counted : null;
	const servings = recipe.servings ?? null;
	// Nothing counts (every line a staple or to taste): a figure only when every
	// line that has an amount is priced, else it would pass for complete.
	const pool = lines.filter((l) => l.reason !== 'optional' && !l.toTaste);
	return {
		total,
		priced,
		counted,
		coverage,
		enough: coverage === null ? pool.length > 0 && pool.every((l) => l.cost !== undefined) : coverage >= threshold,
		perServing: servings ? total / servings : null,
		servings,
		stale,
		lines
	};
}

function walk(recipe: Recipe, factor: number, via: string[], at: number | undefined, seen: Set<string>, src: CostSources, out: CostLine[]): void {
	let position = 0;
	for (const g of recipe.ingredients) {
		for (const item of g.items) {
			const pos = position++;
			const line: CostLine = {
				position: at ?? pos,
				via,
				name: item.name,
				staple: false,
				toTaste: !!item.toTaste,
				counted: false,
				stale: false
			};
			if (g.optional || item.optional) {
				out.push({ ...line, reason: 'optional' });
				continue;
			}
			if (item.recipe) {
				const sub = src.recipe(item.recipe);
				const unpriced = (reason: CostReason) => out.push({ ...line, reason, counted: !line.toTaste });
				if (seen.has(item.recipe)) unpriced('cycle');
				else if (!sub) unpriced('no-recipe');
				else {
					const f = subRecipeFactor(item, sub, src.conversions);
					if (f === undefined) unpriced('no-scale');
					else walk(sub, factor * f, [...via, item.recipe], at ?? pos, new Set([...seen, item.recipe]), src, out);
				}
				continue;
			}
			const slug = src.itemAt(recipe.slug, pos);
			const entry = slug ? src.entry(slug) : undefined;
			line.item = slug;
			line.staple = !!entry?.staple;
			line.counted = !line.toTaste && !line.staple;
			if (!slug || !entry) {
				out.push({ ...line, reason: 'unresolved' });
				continue;
			}
			const price = src.price(slug);
			if (!price) {
				out.push({ ...line, reason: 'no-price' });
				continue;
			}
			const r = lineCost(item, entry, price, src.conversions, recipe.lang);
			out.push(r.cost === undefined ? { ...line, reason: r.reason } : { ...line, cost: r.cost * factor, stale: isStale(price.date, src.today) });
		}
	}
}

/** A cost line as the recipe page gets it (optional lines left out). */
export interface CostLineView {
	name: string;
	item?: string;
	cost?: number;
	reason?: CostReason;
	counted: boolean;
	staple: boolean;
	stale: boolean;
	/** The title of the sub-recipe the line came through, if any. */
	via?: string;
	/** For an unresolved line of the recipe itself: its key in the resolve queue. */
	key?: string;
}

/** The recipe page's cost data: totals at the base servings. */
export type CostView = Pick<RecipeCost, 'total' | 'priced' | 'counted' | 'enough' | 'perServing' | 'stale'> & { lines: CostLineView[] };
