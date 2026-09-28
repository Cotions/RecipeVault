// The ingredient index (plan 03, Phase 4; docs/INGREDIENTS.md, "Two views"):
// every registry entry with its category, current price and the number of
// recipes using it — the working screen for entering prices.

import { isStale, today } from '../ingredients/prices';
import type { Unit } from '../vault/types';
import { fold } from '../vault/normalize';
import type { DB } from './index/db';

export const INDEX_SORTS = ['a-saisir', 'nom', 'categorie', 'recettes', 'date'] as const;
export type IndexSort = (typeof INDEX_SORTS)[number];

export interface IndexFilter {
	sort?: IndexSort;
	/** Reverse the sort's natural order. */
	reverse?: boolean;
	category?: string;
	/** true: priced only; false: unpriced only. */
	priced?: boolean;
	staple?: boolean;
	/** Folded substring of a name or the slug. */
	q?: string;
}

export interface IndexRow {
	slug: string;
	name: string;
	category: string;
	staple: boolean;
	defaultUnit: Unit | null;
	/** Recipes where it is a main ingredient line (an `or` option is not costed). */
	recipes: number;
	price: {
		amount: number;
		currency: string;
		packQty: number;
		packUnit: Unit;
		shop: string;
		date: string;
		stale: boolean;
	} | null;
}

interface Row {
	slug: string;
	name: string;
	category: string;
	staple: number;
	default_unit: string | null;
	recipes: number;
	amount: number | null;
	currency: string | null;
	pack_qty: number | null;
	pack_unit: string | null;
	shop: string | null;
	date: string | null;
	names: string;
}

const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

/**
 * The rows of the ingredient index, filtered and sorted. The default sort is
 * the order to enter prices in (docs/INGREDIENTS.md): unpriced first, then the
 * most recipes, then the name.
 */
export function ingredientIndex(db: DB, f: IndexFilter = {}, on = today()): IndexRow[] {
	const where: string[] = [];
	const params: unknown[] = [];
	if (f.category) {
		where.push('r.category = ?');
		params.push(f.category);
	}
	if (f.staple !== undefined) where.push(`r.staple = ${f.staple ? 1 : 0}`);
	if (f.priced !== undefined) where.push(`c.amount IS ${f.priced ? 'NOT ' : ''}NULL`);
	const rows = db
		.prepare(
			`WITH uses AS (SELECT item, count(DISTINCT slug) AS n FROM ingredients WHERE item IS NOT NULL GROUP BY item)
			 SELECT r.slug, r.name, r.category, r.staple, r.default_unit, COALESCE(u.n, 0) AS recipes,
			        c.amount, c.currency, c.pack_qty, c.pack_unit, c.shop, c.date,
			        (SELECT group_concat(key, ' ') FROM ingredient_names n WHERE n.slug = r.slug) AS names
			 FROM registry r
			 LEFT JOIN uses u ON u.item = r.slug
			 LEFT JOIN current_price c ON c.ingredient = r.slug
			 ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`
		)
		.all(...params) as Row[];
	const q = f.q ? fold(f.q) : '';
	const out: IndexRow[] = [];
	for (const r of rows) {
		if (q && !`${r.slug} ${fold(r.name)} ${r.names ?? ''}`.includes(q)) continue;
		out.push({
			slug: r.slug,
			name: r.name,
			category: r.category,
			staple: r.staple === 1,
			defaultUnit: (r.default_unit as Unit) ?? null,
			recipes: r.recipes,
			price:
				r.amount === null
					? null
					: { amount: r.amount, currency: r.currency!, packQty: r.pack_qty!, packUnit: r.pack_unit as Unit, shop: r.shop ?? '', date: r.date!, stale: isStale(r.date!, on) }
		});
	}
	const byName = (a: IndexRow, b: IndexRow) => collator.compare(a.name, b.name) || a.slug.localeCompare(b.slug);
	const cmp: Record<IndexSort, (a: IndexRow, b: IndexRow) => number> = {
		'a-saisir': (a, b) => Number(!!a.price) - Number(!!b.price) || b.recipes - a.recipes || byName(a, b),
		nom: byName,
		categorie: (a, b) => a.category.localeCompare(b.category) || byName(a, b),
		recettes: (a, b) => b.recipes - a.recipes || byName(a, b),
		// Oldest price first, so stale ones come up; unpriced last.
		date: (a, b) => (a.price?.date ?? '9999').localeCompare(b.price?.date ?? '9999') || byName(a, b)
	};
	const c = cmp[f.sort ?? 'a-saisir'];
	return out.sort(f.reverse ? (a, b) => c(b, a) : c);
}
