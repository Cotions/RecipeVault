// Split text around the four markers so the page can style them:
// [?] and [?: …] highlighted, [illisible] highlighted, [+] in the "added" style.

import type { MarkerKind } from '../vault/types';

export type Segment = { text: string; marker?: undefined } | { text: string; marker: MarkerKind; alternative?: string };

const MARKER_RE = /\[(?:(\?)|\?:\s*([^\]\s][^\]]*?)\s*|(illisible)|(\+))\]/g;

export function segments(s: string): Segment[] {
	const out: Segment[] = [];
	let last = 0;
	for (const m of s.matchAll(MARKER_RE)) {
		const at = m.index ?? 0;
		if (at > last) out.push({ text: s.slice(last, at) });
		if (m[1]) out.push({ text: m[0], marker: 'uncertain' });
		else if (m[2] !== undefined) out.push({ text: m[0], marker: 'uncertain-alt', alternative: m[2] });
		else if (m[3]) out.push({ text: m[0], marker: 'illegible' });
		else out.push({ text: m[0], marker: 'added' });
		last = at + m[0].length;
	}
	if (last < s.length) out.push({ text: s.slice(last) });
	return out;
}

export const hasMarker = (s: string) => new RegExp(MARKER_RE.source).test(s);
