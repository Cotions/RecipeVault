// The family picker's logic (plan 04, Phase 5.1; docs/VOCAB.md §Families):
// existing families first, and "Nouvelle famille « … »" only once the search
// found nothing within the W502 distance — a spelling drift must not split a
// family in two. And the variant's pre-fill: the title's words the family
// label does not have. Browser-safe.

import { editDistance, fold } from '../vault/normalize';
import { slugify } from '../vault/slug';
import { stripMarkers } from '../vault/markers';
import { t } from '../i18n';

export interface FamilyOption {
	slug: string;
	/** The French label (vocab/families.yaml), when it has one. */
	label: string | null;
	/** Recipes in the family. */
	count: number;
	/**
	 * The family's name as its recipes write it, accents and all (« Tourtière »
	 * for `tourtiere`), when it has no label: shown in place of the slug.
	 */
	name?: string | null;
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

const shown = (f: FamilyOption) => f.label ?? f.name ?? f.slug.replace(/-/g, ' ');

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

/**
 * A family's name read from its recipes' titles, for a family with no label:
 * the run of words of a title whose slug is the family's slug, capital first
 * (`tourtiere` in « Tourtière au porc » → « Tourtière »). Null when no title
 * holds it.
 */
export function familyNameFromTitles(slug: string, titles: readonly string[]): string | null {
	for (const title of titles) {
		const run = runOf(slug, title);
		if (run) return run.charAt(0).toUpperCase() + run.slice(1);
	}
	return null;
}

const SLUGLIKE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Where a recipe is from, as a variant's label may say it. A bare string is the author. */
export interface VariantSource {
	author?: string | null;
	source_type?: string | null;
	source_title?: string | null;
	/** The recipe's title: a variant written as the slug of its words (`sirop-d-erable`) reads as them. */
	title?: string | null;
}

const sourceOf = (s: VariantSource | string | null | undefined): VariantSource => (typeof s === 'string' || s == null ? { author: s ?? null } : s);

/** « de » or « d’ » before a name, then the name (« de Tante Aline », « d’Yvette »); kept as is when it already starts so. */
function ofName(name: string): string {
	if (/^(de |du |des |d[’'])/.test(name)) return name;
	return t.recipe.from(name) + name;
}

/** « du Tablier bleu », « des Recettes de chez nous », « d’Autrefois », « de Cuisine inventée » (French contraction of a leading article). */
function ofTitle(title: string): string {
	const article = /^(Le|Les) (.+)$/s.exec(title);
	if (article) return `${article[1] === 'Le' ? 'du' : 'des'} ${article[2]}`;
	return t.recipe.from(title) + title;
}

/**
 * Where a recipe is from, as the start of its variant's label: « de Tante
 * Aline » (the author as written, capitals kept), else « du Tablier bleu »
 * for a book, magazine, show or site with a title, else the kind of source
 * (« de la revue », « du livre »). Empty for a personal recipe with no author,
 * or one that says nothing of where it is from.
 */
export function fromLabel(src: VariantSource | string | null | undefined): string {
	const s = sourceOf(src);
	const author = stripMarkers(s.author ?? '').trim();
	if (author) return ofName(author);
	const title = stripMarkers(s.source_title ?? '').trim();
	if (title && ['book', 'magazine', 'tv', 'website'].includes(s.source_type ?? '')) return ofTitle(title);
	return t.families.fromType[s.source_type ?? ''] ?? '';
}

/** The run of `text`'s words whose slug is `slug` (« sirop d'érable » for `sirop-d-erable`), as written; null when none. */
function runOf(slug: string, text: string): string | null {
	const words = text.trim().split(/\s+/);
	for (let i = 0; i < words.length; i++) {
		if (!slugify(words[i])) continue;
		for (let j = i + 1; j <= words.length; j++) {
			const run = words
				.slice(i, j)
				.join(' ')
				.replace(/^[«“"(]+|[,.;:!?»”")]+$/g, '')
				.trim();
			const s = slugify(run);
			// The slug may leave out the little joining words (`epinards-ricotta` for « épinards et ricotta »).
			const bare = slugify(run.split(' ').filter((w, k) => k === 0 || !JOINING.test(w)).join(' '));
			if (s === slug || (bare === slug && !JOINING.test(words[j - 1]))) return run;
			if (!slug.startsWith(s) && !slug.startsWith(bare)) break;
		}
	}
	return null;
}

/** Words a slug often leaves out between two others. */
const JOINING = /^(et|ou|de|du|des|la|le|les|à|au|aux|en)$/i;

/**
 * A variant as she reads it. One written as she typed it (« avec aneth »)
 * stays as written. One written as a slug (the AI and older files write
 * `aline`, `revue`, `sirop-d-erable`) reads, in order: as who the recipe is
 * from when the slug is that name or part of it (`aline` under « Tante
 * Aline » → « de Tante Aline »); as the kind of source it names (`revue` on a
 * magazine → « de la revue »); as the title's words it is the slug of
 * (« sirop d'érable »); else its words (`micro-ondes` → « micro ondes »).
 */
export function variantShown(variant: string, src?: VariantSource | string | null): string {
	const v = variant.trim();
	if (!SLUGLIKE.test(v)) return v;
	const s = sourceOf(src);
	const author = stripMarkers(s.author ?? '').trim();
	const a = slugify(author);
	if (a && (a === v || `-${a}-`.includes(`-${v}-`))) return ofName(author);
	const kind = t.families.fromType[s.source_type ?? ''];
	if (kind && slugify(kind).split('-').includes(v)) return kind;
	const run = s.title ? runOf(v, s.title) : null;
	return run ?? v.replace(/-/g, ' ');
}

/**
 * What « Ce qui distingue » starts with when a recipe joins a group: where it
 * is from (fromLabel: « de Tante Aline », « de la revue »), when that tells
 * it apart — no other recipe of the group says the same. Else empty: the
 * field's placeholder gives examples (« zeste de citron », « sans sucre »).
 * Never a fragment of the title (usability round 2: « aux », « trois »).
 */
export function variantPrefill(src: VariantSource | string | null | undefined, others: readonly (VariantSource | string | null | undefined)[] = []): string {
	const mine = fromLabel(src);
	if (!mine) return '';
	return others.some((o) => {
		const theirs = fromLabel(o);
		return !!theirs && fold(theirs) === fold(mine);
	})
		? ''
		: mine;
}
