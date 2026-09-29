// Markers in the form (docs/plans/04-write-path.md, Q15 A). The form never
// shows marker syntax: a field holds its text with the markers taken out, and
// the value as written in the file is kept beside it (`written`). This module
// turns one into the other and back:
//
// - `markedText(raw)`: the text she sees, and where each marker applied (for
//   the highlight and the "added" style);
// - `confirmValue(raw)`: "C'est bien ça" — the uncertain markers removed,
//   `[+]` kept;
// - `reapplyAdded(text, raw)`: after an edit, uncertain markers are gone and a
//   `[+]` is kept only where the text it marked is still there, untouched.

import { MARKER_RE } from '../vault/markers';
import type { MarkerKind } from '../vault/types';

export interface Mark {
	kind: MarkerKind;
	/** Span in the shown text the marker applies to. */
	start: number;
	end: number;
	/** The other reading of a `[?: …]`. */
	alternative?: string;
	/** Whether the marker was separated from its text by a space. */
	spaced: boolean;
}

export interface MarkedText {
	/** The text without the markers. */
	text: string;
	marks: Mark[];
}

const UNCERTAIN: MarkerKind[] = ['uncertain', 'uncertain-alt', 'illegible'];
export const isUncertain = (k: MarkerKind) => UNCERTAIN.includes(k);

function kindOf(m: RegExpMatchArray): MarkerKind {
	if (m[1]) return 'uncertain';
	if (m[2] !== undefined) return 'uncertain-alt';
	if (m[3]) return 'illegible';
	return 'added';
}

// A sentence end followed by more text: `[+]` after "… écrasées." marks that sentence.
const SENTENCE_END = /[.!?…]["»”)]?[ \t]+(?=\S)/g;

/** Where the text a `[+]` marks starts: after the last marker, line break or sentence end. */
function addedStart(acc: string, after: number): number {
	const base = Math.max(after, acc.lastIndexOf('\n') + 1);
	let start = base;
	for (const m of acc.slice(base).matchAll(SENTENCE_END)) start = base + m.index! + m[0].length;
	while (start < acc.length && /[ \t]/.test(acc[start])) start++;
	return start;
}

/**
 * Remove the markers `drop` selects, tidying the space they leave: one space
 * where the text after the marker was spaced from it ("30 minutes [+] en" →
 * "30 minutes en"), none otherwise ("tiède [illisible]." → "tiède.") or at a
 * line's end. Kept markers stay as written.
 */
function rebuild(raw: string, drop: (k: MarkerKind) => boolean): MarkedText {
	let acc = '';
	const marks: Mark[] = [];
	let last = 0;
	let gap = false;
	let afterMarker = false;
	let markEnd = 0;
	const append = (piece: string) => {
		if (!afterMarker) {
			acc += piece;
			return;
		}
		const lead = piece.match(/^[ \t]*/)![0];
		if (lead) gap = true;
		const rest = piece.slice(lead.length);
		if (!rest) return;
		if (gap && acc !== '' && !acc.endsWith('\n') && !rest.startsWith('\n')) acc += ' ';
		acc += rest;
		gap = false;
		afterMarker = false;
	};
	for (const m of raw.matchAll(new RegExp(MARKER_RE.source, 'g'))) {
		append(raw.slice(last, m.index));
		last = m.index! + m[0].length;
		const kind = kindOf(m);
		if (!drop(kind)) {
			if (afterMarker && gap && acc !== '' && !acc.endsWith('\n')) acc += ' ';
			acc += m[0];
			afterMarker = false;
			gap = false;
			markEnd = acc.length;
			continue;
		}
		const spaced = /[ \t]$/.test(acc) || (afterMarker && gap);
		// Only a space after the marker is kept: "tiède [illisible]." → "tiède.".
		gap = false;
		acc = acc.replace(/[ \t]+$/, '');
		afterMarker = true;
		const end = acc.length;
		let start: number;
		if (kind === 'added') start = addedStart(acc, markEnd);
		else {
			const word = acc.slice(markEnd).match(/\S+$/);
			start = word ? end - word[0].length : end;
		}
		const mark: Mark = { kind, start, end, spaced };
		if (m[2] !== undefined) mark.alternative = m[2];
		marks.push(mark);
		markEnd = end;
	}
	append(raw.slice(last));
	return { text: acc, marks };
}

/** The text she sees, and the markers it held with the spans they apply to. */
export function markedText(raw: string): MarkedText {
	return rebuild(raw, () => true);
}

/** The text without any marker. */
export const hideMarkers = (raw: string): string => markedText(raw).text;

export const hasMarkers = (raw: string): boolean => new RegExp(MARKER_RE.source).test(raw);

/** "C'est bien ça": the value as written, its uncertain markers removed and `[+]` kept. */
export function confirmValue(raw: string): string {
	return rebuild(raw, isUncertain).text;
}

/**
 * The value to write for a text she edited: no uncertain marker (editing
 * settles them, Q15), and each `[+]` of the old value kept after its text
 * when that text is still there unchanged, in order; dropped otherwise.
 */
export function reapplyAdded(text: string, raw: string): string {
	const { text: old, marks } = markedText(raw);
	let out = '';
	let cursor = 0;
	for (const m of marks) {
		if (m.kind !== 'added') continue;
		const anchor = old.slice(m.start, m.end);
		if (!anchor.trim()) continue;
		const at = text.indexOf(anchor, cursor);
		if (at === -1) continue;
		const end = at + anchor.length;
		out += text.slice(cursor, end) + (m.spaced ? ' ' : '') + '[+]';
		cursor = end;
	}
	return out + text.slice(cursor);
}
