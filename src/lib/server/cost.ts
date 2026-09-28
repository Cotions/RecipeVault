// A recipe's cost from the index (plan 03, Phase 5): the parsed recipes, the
// resolved item of each line (`ingredients.item`, by slug and position), the
// registry's densities and weights, and the current prices. The arithmetic is
// src/lib/ingredients/cost.ts; this only answers its lookups, memoised for one
// computation.

import { recipeCost, type CostEntry, type CostPrice, type RecipeCost } from '../ingredients/cost';
import { today } from '../ingredients/prices';
import type { RegistryEntry } from '../ingredients/types';
import type { Conversions } from '../ingredients/units';
import type { Recipe, Unit } from '../vault/types';
import type { DB } from './index/db';
import { getRecipe } from './index/query';

function memo<T>(f: (k: string) => T): (k: string) => T {
	const m = new Map<string, T>();
	return (k) => {
		if (!m.has(k)) m.set(k, f(k));
		return m.get(k)!;
	};
}

/** The cost of the recipe `slug`, or undefined when it is not in the index. */
export function costOfRecipe(db: DB, slug: string, conversions: Conversions, on = today()): RecipeCost | undefined {
	// A file that fails its check keeps its last good version in the index: that is what is costed.
	const recipeOf = memo((s) => getRecipe(db, s)?.recipe as Recipe | undefined);
	const top = recipeOf(slug);
	if (!top) return undefined;
	const itemsStmt = db.prepare('SELECT position, item FROM ingredients WHERE slug = ?');
	const itemsOf = memo((s) => new Map((itemsStmt.all(s) as { position: number; item: string | null }[]).map((r) => [r.position, r.item ?? undefined])));
	const entryStmt = db.prepare('SELECT entry_json FROM registry WHERE slug = ?').pluck();
	const entryOf = memo((s): CostEntry | undefined => {
		const j = entryStmt.get(s) as string | undefined;
		if (!j) return undefined;
		const e = JSON.parse(j) as RegistryEntry;
		return { staple: e.staple, density: e.density, weights: e.weights };
	});
	const priceStmt = db.prepare('SELECT amount, pack_qty, pack_unit, date FROM current_price WHERE ingredient = ?');
	const priceOf = memo((s): CostPrice | undefined => {
		const r = priceStmt.get(s) as { amount: number; pack_qty: number; pack_unit: string; date: string } | undefined;
		return r && { amount: r.amount, packQty: r.pack_qty, packUnit: r.pack_unit as Unit, date: r.date };
	});
	return recipeCost(top, {
		itemAt: (s, pos) => itemsOf(s).get(pos),
		entry: entryOf,
		price: priceOf,
		recipe: recipeOf,
		conversions,
		today: on
	});
}
