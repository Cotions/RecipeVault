// Text normalization per docs/STORAGE.md: UTF-8, LF line endings, NFC.

/** Strip a BOM, convert CRLF/CR to LF, normalize to NFC. */
export function normalizeText(text: string): string {
	return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').normalize('NFC');
}

/** Drop diacritics: 'crème' → 'creme', 'bœuf' → 'boeuf'. */
export function stripAccents(s: string): string {
	return s
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.replace(/œ/g, 'oe')
		.replace(/Œ/g, 'OE')
		.replace(/æ/g, 'ae')
		.replace(/Æ/g, 'AE')
		.replace(/ß/g, 'ss')
		.normalize('NFC');
}

/** Case-, accent- and whitespace-insensitive form used for comparisons. */
export function fold(s: string): string {
	return stripAccents(s.normalize('NFC')).toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Whether `editDistance(a, b) <= max`, without computing the whole distance:
 * strings whose lengths differ by more than `max` are out at once, and the
 * walk stops as soon as a whole row is past `max` (a row's minimum never goes
 * down). Same answer as the full distance; what near-title checks over a
 * whole vault use.
 */
export function withinDistance(a: string, b: string, max: number): boolean {
	if (a === b) return true;
	if (Math.abs(a.length - b.length) > max) return false;
	const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		let diag = prev[0];
		prev[0] = i;
		let low = prev[0];
		for (let j = 1; j <= b.length; j++) {
			const tmp = prev[j];
			prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
			diag = tmp;
			if (prev[j] < low) low = prev[j];
		}
		if (low > max) return false;
	}
	return prev[b.length] <= max;
}

/** Levenshtein distance, for did-you-mean suggestions and near-duplicate titles. */
export function editDistance(a: string, b: string): number {
	if (a === b) return 0;
	const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		let diag = prev[0];
		prev[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const tmp = prev[j];
			prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
			diag = tmp;
		}
	}
	return prev[b.length];
}
