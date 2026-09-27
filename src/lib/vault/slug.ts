// Slugs: lowercase ASCII, hyphenated, derived from the title without markers.

import { stripMarkers } from './markers';
import { stripAccents } from './normalize';

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 'Pâté chinois [+]' → 'pate-chinois'; "pâte d'amande" → 'pate-d-amande'. */
export function slugify(title: string): string {
	return stripAccents(stripMarkers(title.normalize('NFC')))
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

export function isSlug(s: unknown): s is string {
	return typeof s === 'string' && SLUG_RE.test(s);
}
