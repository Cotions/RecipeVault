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
