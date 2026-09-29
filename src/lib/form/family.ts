// The family picker's logic (plan 04, Phase 5.1; docs/VOCAB.md §Families):
// existing families first, and "Nouvelle famille « … »" only once the search
// found nothing within the W502 distance — a spelling drift must not split a
// family in two. And the variant's pre-fill: the title's words the family
// label does not have. Browser-safe.

import { editDistance, fold } from '../vault/normalize';
import { slugify } from '../vault/slug';

export interface FamilyOption {
	slug: string;
	/** The French label (vocab/families.yaml), when it has one. */
	label: string | null;
	/** Recipes in the family. */
	count: number;
}

export interface FamilyChoices {
	/** What to list, best first. */
	matches: FamilyOption[];
	/** The family the query names exactly (slug or label). */
	exact?: FamilyOption;
	/** A new family to offer: only when no family is within distance 2. */
	offerNew: { slug: string; label: string } | null;
}

/** W502's distance (docs/VALIDATION.md): two edits. */
export const FAMILY_DISTANCE = 2;

const shown = (f: FamilyOption) => f.label ?? f.slug.replace(/-/g, ' ');

/** How far a query is from a family, by slug and by label, the smaller. */
function distance(f: FamilyOption, slug: string, q: string): number {
	return Math.min(editDistance(slug, f.slug), editDistance(q, fold(shown(f))));
}

export function familyChoices(families: readonly FamilyOption[], query: string, limit = 8): FamilyChoices {
	const q = fold(query);
	const byName = (a: FamilyOption, b: FamilyOption) => shown(a).localeCompare(shown(b), 'fr');
	if (!q) return { matches: [...families].sort((a, b) => b.count - a.count || byName(a, b)).slice(0, limit), offerNew: null };
	const slug = slugify(query);
	const exact = families.find((f) => f.slug === slug || fold(shown(f)) === q);
	const near = families
		.map((f) => ({ f, d: distance(f, slug, q) }))
		.filter((x) => x.d <= FAMILY_DISTANCE)
		.sort((a, b) => a.d - b.d || byName(a.f, b.f))
		.map((x) => x.f);
	const inside = families.filter((f) => f.slug.includes(slug) || fold(shown(f)).includes(q)).sort((a, b) => b.count - a.count || byName(a, b));
	const matches = [...new Set([...(exact ? [exact] : []), ...near, ...inside])].slice(0, limit);
	return { matches, exact, offerNew: !exact && !near.length && slug ? { slug, label: query.trim() } : null };
}

/**
 * The variant a title suggests within a family: its words the family label
 * does not hold ("Lasagne aux épinards" in « Lasagne » → "aux épinards").
 * Empty when the title is only the label.
 */
export function variantFrom(title: string, label: string): string {
	const own = new Set(fold(label).split(/[\s-]+/).filter(Boolean));
	return title
		.trim()
		.split(/\s+/)
		.filter((w) => !own.has(fold(w).replace(/[^\p{L}\p{N}-]/gu, '')))
		.join(' ');
}
