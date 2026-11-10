// Search hits in display text: which words of a string a search matched, so a
// result can show why it came up. Browser-safe; the index matches the same way
// (index/query.ts ftsQuery: folded words, each a prefix, all required).
// Everything here returns plain strings and ranges — the page renders them as
// text with <mark>, never as HTML.

import { stripMarkers } from '../vault/markers';
import { fold, stripAccents } from '../vault/normalize';

/** The search's words, folded like the indexed text (no accents, œ → oe, lowercase). At most 12. */
export function queryTerms(q: string | undefined | null): string[] {
	if (!q) return [];
	return fold(stripMarkers(q))
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean)
		.slice(0, 12);
}

/** Folded text with, per folded character, the range in `text` of the character it came from. */
function foldMap(text: string): { folded: string; from: number[]; to: number[] } {
	let folded = '';
	const from: number[] = [];
	const to: number[] = [];
	let i = 0;
	for (const ch of text) {
		const f = /\s/u.test(ch) ? ' ' : stripAccents(ch).toLowerCase();
		for (let k = 0; k < f.length; k++) {
			folded += f[k];
			from.push(i);
			to.push(i + ch.length);
		}
		i += ch.length;
	}
	return { folded, from, to };
}

/**
 * The ranges [start, end) of `text` holding a word that starts with one of
 * the terms — the whole word, as the person reads it ("lasag" marks
 * « Lasagnes »). Sorted, not overlapping.
 */
export function hitRanges(text: string, terms: string[]): [number, number][] {
	if (!terms.length || !text) return [];
	const { folded, from, to } = foldMap(text);
	const out: [number, number][] = [];
	for (const m of folded.matchAll(/[\p{L}\p{N}]+/gu)) {
		if (!terms.some((t) => m[0].startsWith(t))) continue;
		let end = to[m.index + m[0].length - 1];
		// A decomposed accent after the last letter belongs to the word.
		while (end < text.length && /\p{M}/u.test(text[end])) end++;
		out.push([from[m.index], end]);
	}
	return out;
}

export interface Segment {
	text: string;
	hit: boolean;
}

/** `text` cut into plain and hit segments, for rendering with <mark>. */
export function hitSegments(text: string, terms: string[]): Segment[] {
	const ranges = hitRanges(text, terms);
	if (!ranges.length) return [{ text, hit: false }];
	const out: Segment[] = [];
	let at = 0;
	for (const [s, e] of ranges) {
		if (s > at) out.push({ text: text.slice(at, s), hit: false });
		out.push({ text: text.slice(s, e), hit: true });
		at = e;
	}
	if (at < text.length) out.push({ text: text.slice(at), hit: false });
	return out;
}

/** Which of the terms the text holds (as a word prefix). */
export function termsIn(text: string, terms: string[]): Set<string> {
	const found = new Set<string>();
	if (!text) return found;
	const words = fold(text).split(/[^\p{L}\p{N}]+/u);
	for (const t of terms) if (words.some((w) => w.startsWith(t))) found.add(t);
	return found;
}

/**
 * A short window of `text` around its first hit: about `before` characters
 * ahead and `after` behind, cut at word boundaries, with … where it was cut.
 * Undefined when the text has no hit.
 */
export function excerpt(text: string, terms: string[], before = 40, after = 90): string | undefined {
	const first = hitRanges(text, terms)[0];
	if (!first) return undefined;
	let s = Math.max(0, first[0] - before);
	let e = Math.min(text.length, first[1] + after);
	if (s > 0) {
		const sp = text.indexOf(' ', s);
		s = sp >= 0 && sp < first[0] ? sp + 1 : s;
	}
	if (e < text.length) {
		const sp = text.lastIndexOf(' ', e);
		e = sp > first[1] ? sp : e;
	}
	return `${s > 0 ? '… ' : ''}${text.slice(s, e).trim()}${e < text.length ? ' …' : ''}`;
}
