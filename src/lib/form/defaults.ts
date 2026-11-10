// Defaults for a new recipe, read from the vault's own data (plan 04,
// decision 1: nothing regional in code). The oven unit the form starts on and
// the order of the unit picker are the vault's most used; `lang` is the
// vault's most used language, else `fr` (docs/RECIPE-SCHEMA.md, `lang` default).

import { UNITS, type Lang, type Recipe, type Unit } from '../vault/types';

export interface VaultStats {
	/** Ingredient lines per unit (items, `or` entries and `alt` amounts). */
	units: Partial<Record<Unit, number>>;
	/** Recipes per oven unit. */
	ovenUnits: Partial<Record<'F' | 'C', number>>;
	/** Recipes per language. */
	langs: Partial<Record<Lang, number>>;
}

export interface FormDefaults {
	lang: Lang;
	/** `null` on an empty vault: she picks one. */
	ovenUnit: 'F' | 'C' | null;
	/** Every canonical unit, most used first; unused ones in the vocabulary's order. */
	unitOrder: Unit[];
}

const bump = <K extends string>(m: Partial<Record<K, number>>, k: K) => {
	m[k] = (m[k] ?? 0) + 1;
};

/** Counts over parsed recipes. The server computes the same from its index (Phase 3). */
export function statsFromRecipes(recipes: Recipe[]): VaultStats {
	const stats: VaultStats = { units: {}, ovenUnits: {}, langs: {} };
	const walk = (it: Recipe['ingredients'][number]['items'][number]) => {
		if (it.unit) bump(stats.units, it.unit);
		if (it.alt?.unit) bump(stats.units, it.alt.unit);
		it.or?.forEach(walk);
	};
	for (const r of recipes) {
		bump(stats.langs, r.lang);
		if (r.oven) bump(stats.ovenUnits, r.oven.unit);
		r.ingredients.forEach((g) => g.items.forEach(walk));
	}
	return stats;
}

/** The most counted key; ties go to the earlier key of `order`. */
function top<K extends string>(counts: Partial<Record<K, number>>, order: readonly K[]): K | null {
	let best: K | null = null;
	for (const k of order) if ((counts[k] ?? 0) > 0 && (best === null || counts[k]! > counts[best]!)) best = k;
	return best;
}

export function defaultsFor(stats?: VaultStats): FormDefaults {
	const units = stats?.units ?? {};
	return {
		lang: (stats && top(stats.langs, ['fr', 'en'] as const)) ?? 'fr',
		ovenUnit: stats ? top(stats.ovenUnits, ['F', 'C'] as const) : null,
		unitOrder: [...UNITS].sort((a, b) => (units[b] ?? 0) - (units[a] ?? 0))
	};
}

/** How many of the vault's most used units the picker shows first. */
export const COMMON_UNITS = 8;
/** The order the common units read in: cups and spoons, then weights, then metric volumes and weights, then counts (one family after another, not regional). */
const FAMILY_ORDER: readonly Unit[] = ['cup', 'tbsp', 'tsp', 'lb', 'oz', 'ml', 'cl', 'l', 'g', 'kg', 'piece'];

/**
 * The unit picker in two parts (plan 04, usability round 4): the vault's
 * most used units (`order`, most used first), read family by family (« tasse,
 * c. à table, c. à thé, lb, oz, ml, g, à l'unité »), then every other unit in
 * the vocabulary's order. Which units come first is the vault's; only their
 * order within the first part is fixed.
 */
export function unitMenu(order: readonly Unit[], size = COMMON_UNITS): { common: Unit[]; rest: Unit[] } {
	const top = order.slice(0, size);
	const rank = (u: Unit) => {
		const i = FAMILY_ORDER.indexOf(u);
		return i === -1 ? FAMILY_ORDER.length + top.indexOf(u) : i;
	};
	const common = [...top].sort((a, b) => rank(a) - rank(b));
	const rest = UNITS.filter((u) => !common.includes(u));
	return { common, rest };
}
