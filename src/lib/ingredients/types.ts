// The ingredient registry (docs/INGREDIENTS.md, "The registry"): one file per
// ingredient, `ingredients/<slug>.md`. Browser-safe.

import type { Lang, Unit } from '../vault/types';

/** Where you shop for it. A fixed list (docs/INGREDIENTS.md). */
export const CATEGORIES = [
	'frais',
	'viande',
	'poisson',
	'legume',
	'fruit',
	'cremerie',
	'epicerie',
	'conserve',
	'surgele',
	'epice',
	'boisson',
	'autre'
] as const;
export type Category = (typeof CATEGORIES)[number];

export const NAME_LANGS: readonly Lang[] = ['fr', 'en'];

export interface RegistryEntry {
	slug: string;
	category: Category;
	/** Every way it is written in a recipe, per language. The first French name is the display name. */
	names: Record<Lang, string[]>;
	/** The unit for vault-wide totals and the default pack unit of a price (plan 03, Q26). */
	defaultUnit?: Unit;
	/** Assumed always in the cupboard. */
	staple: boolean;
	/** May be written "to taste" (salt, pepper, oils, butter…): W606 stays quiet (plan 03, Q21). */
	auGout: boolean;
	/** Grams per millilitre, only when the conversion is safe. */
	density?: number;
	/** Grams for one of a count or spoon unit: `{ piece: 55, clove: 5 }` (plan 03, Q12). */
	weights: Partial<Record<Unit, number>>;
	substitutes: string[];
	/** Values from vocab/allergens.yaml. */
	allergens: string[];
	/** The prose notes after the frontmatter. */
	body: string;
}

/** The name shown for an entry: its first French name, else its first English name, else the slug. */
export function displayName(e: Pick<RegistryEntry, 'names' | 'slug'>): string {
	return e.names.fr[0] ?? e.names.en[0] ?? e.slug;
}
