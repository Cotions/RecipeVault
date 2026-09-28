// Word lists for the name checks W302 (preparation participles), W304 (size
// descriptors) and W607 (brands). The words are regional data, not code
// (plan 03, decision 1 and Q22): seeded from docs/VOCAB.md, kept in the vault's
// vocab/participles.yaml, descriptors.yaml and brands.yaml, and handed to the
// checker as options. The paste page receives the same lists as the server, so
// the live check in the browser and /api/check agree. Browser-safe.

import { maskMarkers } from './markers';
import { fold } from './normalize';

/** A list as the checker uses it: every phrase as folded words. */
export interface WordList {
	/** The listed words or phrases (`haché`, `en cubes`, `Club House`). */
	words: string[][];
	/**
	 * Names in which a listed word is part of the product's name, not a
	 * preparation, size or brand to split out (`porc haché`, `gros sel`).
	 */
	keep: string[][];
}

/** The lists the name checks use; a list left out turns its check off. */
export interface CheckWords {
	participles?: WordList;
	descriptors?: WordList;
	brands?: WordList;
}

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One phrase as folded words: `Lea & Perrins` → `[lea, perrins]`. */
export function phraseWords(s: string): string[] {
	return fold(s)
		.replace(/[’‘`´]/g, "'")
		.split(/[^\p{L}\p{N}'-]+/u)
		.filter(Boolean);
}

function phrases(v: unknown): string[][] {
	const out: string[][] = [];
	const add = (x: unknown) => {
		if (typeof x !== 'string') return;
		const w = phraseWords(x);
		if (w.length) out.push(w);
	};
	if (Array.isArray(v)) v.forEach(add);
	// Per language (`fr: [...]`, `en: [...]`): all of them apply, as a card may mix languages.
	else if (isMap(v)) for (const l of Object.values(v)) if (Array.isArray(l)) l.forEach(add);
	return out;
}

/**
 * Read one of the word-list files: `words:` (a list, or lists per language)
 * and `keep:` (a list). Anything malformed is left out: a broken file means
 * no warnings, never a failed check.
 */
export function parseWordList(data: unknown): WordList | undefined {
	if (!isMap(data)) return undefined;
	const words = phrases(data.words);
	if (!words.length) return undefined;
	return { words, keep: phrases(data.keep) };
}

/** A name split into words, each with its folded form for matching. */
export interface NameWords {
	/** The name as written, markers included (they are not words). */
	text: string;
	/** Each word's offsets in `text`. */
	spans: [number, number][];
	folded: string[];
}

export function nameWords(name: string): NameWords {
	const text = name.normalize('NFC').trim();
	const spans: [number, number][] = [];
	const folded: string[] = [];
	for (const m of maskMarkers(text).matchAll(/[\p{L}\p{N}'’-]+/gu)) {
		const f = phraseWords(m[0]).join(' ');
		if (!f) continue;
		spans.push([m.index, m.index + m[0].length]);
		folded.push(f);
	}
	return { text, spans, folded };
}

/** A listed phrase found in a name: the word range it covers. */
export interface WordMatch {
	start: number;
	end: number;
	/** The words as written in the name. */
	text: string;
	/** The name's other words, as written. */
	rest: string;
}

const at = (words: string[], phrase: string[], i: number) => phrase.every((w, k) => words[i + k] === w);

/** Where a keep phrase covers the range [start, end), the listed word is part of the product's name. */
function kept(n: NameWords, list: WordList, start: number, end: number): boolean {
	return list.keep.some((p) => {
		for (let i = Math.max(0, end - p.length); i <= Math.min(start, n.folded.length - p.length); i++) if (at(n.folded, p, i)) return true;
		return false;
	});
}

function match(n: NameWords, start: number, end: number): WordMatch {
	const from = n.spans[start][0];
	const to = n.spans[end - 1][1];
	const rest = (n.text.slice(0, from) + ' ' + n.text.slice(to)).replace(/\(\s*\)/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,;:]+|[\s,;:]+$/g, '').trim();
	return { start, end, text: n.text.slice(from, to), rest };
}

/**
 * A listed phrase at the start or the end of the name, with other words left
 * (a name that is only the word is not flagged). French puts a participle or a
 * size after the noun (*oignon haché*, *oignon moyen*), English before it
 * (*chopped onion*, *large egg*); the lists are per language, the position is not.
 */
export function findAtEdge(n: NameWords, list: WordList | undefined): WordMatch | undefined {
	if (!list) return undefined;
	const len = n.folded.length;
	// Longest phrase first, so `en cubes` wins over `cubes`.
	const sorted = [...list.words].sort((a, b) => b.length - a.length);
	for (const p of sorted) {
		if (p.length >= len) continue;
		if (at(n.folded, p, len - p.length) && !kept(n, list, len - p.length, len)) return match(n, len - p.length, len);
		if (at(n.folded, p, 0) && !kept(n, list, 0, p.length)) return match(n, 0, p.length);
	}
	return undefined;
}

/** A listed phrase anywhere in the name, with other words left. */
export function findInside(n: NameWords, list: WordList | undefined): WordMatch | undefined {
	if (!list) return undefined;
	const len = n.folded.length;
	const sorted = [...list.words].sort((a, b) => b.length - a.length);
	for (const p of sorted) {
		if (p.length >= len) continue;
		for (let i = 0; i + p.length <= len; i++) if (at(n.folded, p, i) && !kept(n, list, i, i + p.length)) return match(n, i, i + p.length);
	}
	return undefined;
}
