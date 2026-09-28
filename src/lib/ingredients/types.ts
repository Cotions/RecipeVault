// The ingredient registry (docs/INGREDIENTS.md, "The registry"): one file per
// ingredient, `ingredients/<slug>.md`. Browser-safe.

import { UNITS, type Lang, type Unit } from '../vault/types';

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

/**
 * Unit classes a disambiguation rule may name instead of listing units
 * (docs/INGREDIENTS.md, "Disambiguation rules"). A grouping of the canonical
 * unit list, which is code (the prompt's contract), not regional data.
 */
export const UNIT_CLASSES = {
	mass: ['g', 'kg', 'lb', 'oz'],
	volume: ['ml', 'cl', 'l', 'cup', 'tbsp', 'tsp', 'qt', 'pint', 'pinch', 'drop'],
	count: ['piece', 'clove', 'leaf', 'sprig', 'stalk', 'bunch', 'slice'],
	container: ['can', 'packet', 'bottle', 'jar', 'bag']
} as const satisfies Record<string, readonly Unit[]>;
export type UnitClass = keyof typeof UNIT_CLASSES;

/** Every canonical unit is in exactly one class. */
export const UNIT_CLASS_OF: Record<Unit, UnitClass> = Object.fromEntries(
	Object.entries(UNIT_CLASSES).flatMap(([c, us]) => us.map((u) => [u, c]))
) as Record<Unit, UnitClass>;
if (Object.keys(UNIT_CLASS_OF).length !== UNITS.length) throw new Error('UNIT_CLASSES must cover every canonical unit once');

/**
 * A conditional name (`when:` in an ingredient file): `names` mean this entry
 * only when every condition given holds for the recipe line. At least one
 * condition. Not an alias: a rule name alone resolves nothing.
 */
export interface NameRule {
	names: string[];
	/** The recipe's language. */
	lang?: Lang;
	/** Canonical units and unit classes (`container`, `count`, `mass`, `volume`), as written; any one matches the line's unit. */
	unit?: string[];
	/** Words or phrases, any one of which appears in the line's `prep` or `note`. */
	words?: string[];
}

export interface RegistryEntry {
	slug: string;
	category: Category;
	/** Every way it is written in a recipe, per language. The first French name is the display name. */
	names: Record<Lang, string[]>;
	/** Conditional names (disambiguation rules); omitted when none. */
	when?: NameRule[];
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
