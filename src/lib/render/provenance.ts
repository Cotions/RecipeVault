// A recipe's provenance in a few words, for a list line under its title:
// what tells two recipes with the same title apart. Browser-safe.

import { t } from '../i18n';
import { stripMarkers } from '../vault/markers';

export interface ProvenanceFields {
	author?: string | null;
	source_type?: string | null;
	source_title?: string | null;
	source_url?: string | null;
	source_page?: string | null;
	variant?: string | null;
}

/** Sources with a title of their own, read « Tiré de <titre> » (as on the recipe page). */
const PUBLISHED = new Set(['book', 'magazine', 'tv', 'website']);

const host = (url: string) => {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return null;
	}
};

/**
 * « Tiré de <titre> », with French's contraction of a leading article:
 * « Tiré du Tablier bleu », « Tiré des Recettes de chez nous » (never « de Le »).
 * « La » and « L’ » do not contract. Other languages read their phrase as is.
 */
export function takenFrom(title: string): string {
	return takenFromParts(title).join(' ');
}

/** The same, as [lead, title]: the title alone, to set it apart (a `<cite>`). */
export function takenFromParts(title: string): [string, string] {
	const lead = t.recipe.takenFrom;
	const article = / de$/.test(lead) ? /^(Le|Les) (.+)$/s.exec(title) : null;
	if (!article) return [lead, title];
	return [`${lead.slice(0, -3)} ${article[1] === 'Le' ? 'du' : 'des'}`, article[2]];
}

/**
 * « de Tante Aline » / « d’Aline » — the author as written; else « Tiré de
 * <titre>, p. 109 » for a book, magazine, show or site; else the site's
 * address or the source type (« Recette personnelle »); else the variant name.
 * Empty when the recipe says nothing of where it is from.
 */
export function provenanceLine(s: ProvenanceFields): string {
	const { lead, name, rest } = provenanceParts(s);
	return lead + name + rest;
}

/**
 * The same line in three parts, `lead + name + rest`: `name` is what tells two
 * same titles apart — the person (« de **Tante Aline** »), else the book's or
 * the site's title (« Tiré du **Tablier bleu**, p. 12 ») — which the list sets
 * in a stronger weight. Empty `name` when the line names nobody (« Recette
 * personnelle », a bare address).
 */
export function provenanceParts(s: ProvenanceFields): { lead: string; name: string; rest: string } {
	const author = s.author ? stripMarkers(s.author).trim() : '';
	const title = s.source_title ? stripMarkers(s.source_title).trim() : '';
	const page = s.source_page ? `, ${t.recipe.page}\u00a0${s.source_page}` : '';
	const plain = (rest: string) => ({ lead: '', name: '', rest });
	if (title && PUBLISHED.has(s.source_type ?? '')) {
		const [lead, name] = takenFromParts(title);
		return { lead: `${lead} `, name, rest: `${page}${author ? ` · ${author}` : ''}` };
	}
	if (author) return { lead: t.recipe.from(author), name: author, rest: '' };
	if (title) return { lead: '', name: title, rest: page };
	const site = s.source_url ? host(s.source_url) : null;
	if (site) return plain(s.source_type ? `${t.source[s.source_type] ?? s.source_type} · ${site}` : site);
	if (s.source_type && t.source[s.source_type]) return plain(t.source[s.source_type]);
	if (s.variant) {
		const v = s.variant.replace(/-/g, ' ');
		return plain(v.charAt(0).toUpperCase() + v.slice(1));
	}
	return plain('');
}
