// The pantry query (plan 03, Phase 7; docs/INGREDIENTS.md, "It stays fast").
// Each recipe's needs are built from the index — `ingredients.item`, the `or`
// choices in `ingredient_or`, sub-recipes flattened — and kept in memory until
// the index changes; a search is then a pass over them
// (src/lib/ingredients/pantry.ts), a few milliseconds at 5000 recipes.

import { pantrySearch, type PantryNeed, type PantryQuery, type PantryRecipe, type PantryResult, type PantryWorld } from '../../ingredients/pantry';
import type { DB } from './db';

interface Model {
	recipes: PantryRecipe[];
	world: PantryWorld;
}

const cache = new WeakMap<DB, { key: string; model: Model }>();

/**
 * Changes made through this connection (`total_changes()`) and by any other
 * (`data_version`, e.g. `vault sync` from the CLI): the model is rebuilt when
 * either moved. Any write counts, which is more often than needed and still
 * rare next to searches.
 */
function version(db: DB): string {
	return `${db.prepare('SELECT total_changes()').pluck().get()}:${db.pragma('data_version', { simple: true })}`;
}

interface Line {
	slug: string;
	position: number;
	optional: number;
	group_optional: number;
	to_taste: number;
	recipe: string | null;
	buy_instead: number;
	item: string | null;
}

function build(db: DB): Model {
	const staples = new Set(db.prepare('SELECT slug FROM registry WHERE staple = 1').pluck().all() as string[]);
	const registry = new Set(db.prepare('SELECT slug FROM registry').pluck().all() as string[]);
	const substitutes = new Map<string, string[]>();
	for (const r of db.prepare('SELECT slug, substitute FROM substitutes').all() as { slug: string; substitute: string }[])
		(substitutes.get(r.slug) ?? substitutes.set(r.slug, []).get(r.slug)!).push(r.substitute);
	const allergenSlugs = new Map<string, Set<string>>();
	for (const r of db.prepare('SELECT slug, allergen FROM ingredient_allergens').all() as { slug: string; allergen: string }[])
		(allergenSlugs.get(r.allergen) ?? allergenSlugs.set(r.allergen, new Set()).get(r.allergen)!).add(r.slug);

	const lines = new Map<string, Line[]>();
	for (const l of db.prepare('SELECT slug, position, optional, group_optional, to_taste, recipe, buy_instead, item FROM ingredients ORDER BY slug, position').all() as Line[])
		(lines.get(l.slug) ?? lines.set(l.slug, []).get(l.slug)!).push(l);
	/** `or` choices by recipe and position: resolved slugs, and whether any choice is unresolved. */
	const ors = new Map<string, string[]>();
	for (const o of db.prepare('SELECT slug, position, item FROM ingredient_or WHERE item IS NOT NULL ORDER BY slug, position, alt_idx').all() as {
		slug: string;
		position: number;
		item: string;
	}[]) {
		const k = `${o.slug}\0${o.position}`;
		(ors.get(k) ?? ors.set(k, []).get(k)!).push(o.item);
	}

	/** A recipe's needs, unresolved count and used slugs; sub-recipes memoised, cycles cut. */
	const memo = new Map<string, { needs: PantryNeed[]; unresolved: number; uses: Set<string> }>();
	const flatten = (slug: string, chain: Set<string>): { needs: PantryNeed[]; unresolved: number; uses: Set<string> } | undefined => {
		const hit = memo.get(slug);
		if (hit) return hit;
		const ls = lines.get(slug);
		if (!ls || chain.has(slug)) return undefined;
		const next = new Set(chain).add(slug);
		const needs: PantryNeed[] = [];
		const uses = new Set<string>();
		let unresolved = 0;
		for (const l of ls) {
			const skip = l.optional === 1 || l.group_optional === 1 || l.to_taste === 1;
			const choices = [...(l.item ? [l.item] : []), ...(ors.get(`${slug}\0${l.position}`) ?? [])];
			for (const c of choices) uses.add(c);
			if (l.recipe) {
				const sub = flatten(l.recipe, next);
				const buy = l.buy_instead === 1 && registry.has(l.recipe) ? l.recipe : undefined;
				if (buy) uses.add(buy);
				if (sub) for (const u of sub.uses) uses.add(u);
				if (skip) continue;
				if (sub) needs.push({ kind: 'sub', buy, needs: sub.needs, unresolved: sub.unresolved });
				else if (buy) needs.push({ kind: 'item', accepted: [buy], staple: staples.has(buy) });
				else unresolved++;
				continue;
			}
			if (skip) continue;
			if (!choices.length) unresolved++;
			else needs.push({ kind: 'item', accepted: [...new Set(choices)], staple: choices.some((c) => staples.has(c)) });
		}
		const r = { needs, unresolved, uses };
		memo.set(slug, r);
		return r;
	};

	const recipes: PantryRecipe[] = [];
	for (const r of db.prepare('SELECT slug, title, rating, total_s FROM recipes').all() as { slug: string; title: string; rating: number | null; total_s: number | null }[]) {
		const f = flatten(r.slug, new Set()) ?? { needs: [], unresolved: 0, uses: new Set<string>() };
		recipes.push({ slug: r.slug, title: r.title, rating: r.rating, totalS: r.total_s, needs: f.needs, unresolved: f.unresolved, uses: f.uses });
	}
	return { recipes, world: { staples, substitutes, allergenSlugs } };
}

function model(db: DB): Model {
	const key = version(db);
	const hit = cache.get(db);
	if (hit && hit.key === key) return hit.model;
	const m = build(db);
	// Reading does not change the counters: the key taken before the build still holds.
	cache.set(db, { key, model: m });
	return m;
}

/** Pantry search over the index: every result, in tier order. */
export function pantryQuery(db: DB, q: PantryQuery): PantryResult[] {
	const m = model(db);
	return pantrySearch(m.recipes, q, m.world);
}
