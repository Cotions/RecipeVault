// The four inline markers of docs/RECIPE-SCHEMA.md: [?], [?: other], [illisible], [+].
// No bracket pattern here crosses a `[` or a line, and an alternative is at most
// 200 characters: a paste of thousands of `[` stays linear, never minutes.

import type { Marker, MarkerKind } from './types';

export const MARKER_RE = /\[(?:(\?)|\?:\s*([^[\]\s][^[\]\n]{0,200}?)\s*|(illisible)|(\+))\]/g;

/** Every valid marker in a string, tagged with the given path. */
export function findMarkers(s: string, path: string): Marker[] {
	const out: Marker[] = [];
	for (const m of s.matchAll(MARKER_RE)) {
		let kind: MarkerKind;
		if (m[1]) kind = 'uncertain';
		else if (m[2] !== undefined) kind = 'uncertain-alt';
		else if (m[3]) kind = 'illegible';
		else kind = 'added';
		const marker: Marker = { kind, path, text: m[0] };
		if (m[2] !== undefined) marker.alternative = m[2];
		out.push(marker);
	}
	return out;
}

/** Blank out valid markers, keeping every other character at its offset. */
export function maskMarkers(s: string): string {
	return s.replace(MARKER_RE, (m) => ' '.repeat(m.length));
}

/** One marker or several in a row (`[illisible] [?: cuire]`): one gap. */
const RUN_RE = new RegExp(`(?:${MARKER_RE.source})(?:[ \\t]*(?:${MARKER_RE.source}))*`, 'g');
const blank = (c: string | undefined) => c === ' ' || c === '\t';

/**
 * Remove valid markers and tidy the whitespace they leave: 'boeuf [?]' →
 * 'boeuf', 'sel [?] , poivre' → 'sel, poivre'. Only the marker's gap is
 * tidied: the space a French « Sauce : rapide » puts before its colon stays.
 * One pass, no backtracking over runs of spaces.
 */
export function stripMarkers(s: string): string {
	let out = '';
	let at = 0;
	for (const m of s.matchAll(RUN_RE)) {
		let end = m.index;
		while (end > at && blank(s[end - 1])) end--;
		out += s.slice(at, end);
		at = m.index + m[0].length;
		let next = at;
		while (blank(s[next])) next++;
		// Before `)`, `,` or `.` (not a decimal) no space at all; before a touching `;` or `:` none either.
		if (s[next] === ')' || ((s[next] === ',' || s[next] === '.') && !/\d/.test(s[next + 1] ?? ''))) at = next;
		else if (s[at] !== ';' && s[at] !== ':') out += ' ';
	}
	out += s.slice(at);
	return out.replace(/[ \t]+/g, ' ').trim();
}

export interface BadMarker {
	/** 'bracket': an unknown [..] marker. 'prose': uncertainty written as words. */
	kind: 'bracket' | 'prose';
	text: string;
}

// Square brackets with a meaning of their own, not markers: Obsidian wikilinks,
// Markdown links, task-list checkboxes.
const NOT_MARKER_RE = /\[\[[^[\]\n]*\]\]|\[[^[\]\n]*\]\(|^[ \t]*[-*][ \t]+\[[ xX]\]/gm;
const BRACKET_RE = /\[[^[\]\n]*\]/g;
const PROSE_RE = /lecture\s+incertaine|(?<!\p{L})incertaine?s?(?!\p{L})|(?<!\p{L})illisibles?(?!\p{L})|\?\s*\)/giu;

/** Unknown bracket markers and prose uncertainty (E217). */
export function findBadMarkers(s: string): BadMarker[] {
	const out: BadMarker[] = [];
	const rest = s.replace(NOT_MARKER_RE, ' ').replace(MARKER_RE, ' ');
	for (const m of rest.matchAll(BRACKET_RE)) out.push({ kind: 'bracket', text: m[0] });
	const noBrackets = rest.replace(BRACKET_RE, ' ');
	for (const m of noBrackets.matchAll(PROSE_RE)) out.push({ kind: 'prose', text: m[0] });
	return out;
}

/**
 * A value that starts with a marker and was not quoted is read by YAML as a
 * list: `name: [illisible]` → ['illisible'], `[?]` → [{ '': null }],
 * `[?: porc]` → [{ '?': 'porc' }], `[+]` → ['+']. Returns the marker as it was
 * written, or undefined for any other value.
 */
export function misreadMarker(v: unknown): string | undefined {
	if (!Array.isArray(v) || v.length !== 1) return undefined;
	const x: unknown = v[0];
	if (x === 'illisible') return '[illisible]';
	if (x === '+') return '[+]';
	if (x === '?') return '[?]';
	if (typeof x === 'string' && x.startsWith('?:')) return `[${x}]`;
	if (typeof x === 'object' && x !== null && !Array.isArray(x)) {
		const entries = Object.entries(x);
		if (entries.length !== 1) return undefined;
		const [k, val] = entries[0];
		if (k === '' && val === null) return '[?]';
		if (k === '?' && (typeof val === 'string' || typeof val === 'number')) return `[?: ${val}]`;
	}
	return undefined;
}
