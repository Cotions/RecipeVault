// Quantities: a number, or a string exactly as written — "1 1/2", "2/3", "250 [?]".

import { findMarkers, stripMarkers } from './markers';

export type QuantityResult =
	| { ok: true; value: number }
	| { ok: false; reason: string; suggestion?: string };

const VULGAR: Record<string, string> = {
	'½': '1/2',
	'¼': '1/4',
	'¾': '3/4',
	'⅓': '1/3',
	'⅔': '2/3',
	'⅛': '1/8'
};

/** Parse a qty value. Markers are allowed in strings and ignored for the value. */
export function parseQuantity(v: unknown): QuantityResult {
	if (typeof v === 'number') {
		if (!Number.isFinite(v)) return { ok: false, reason: 'not a finite number' };
		if (v <= 0) return { ok: false, reason: 'must be greater than 0' };
		return { ok: true, value: v };
	}
	if (typeof v !== 'string') return { ok: false, reason: 'not a number or a fraction string' };
	const s = stripMarkers(v.normalize('NFC'));
	let m: RegExpMatchArray | null;
	if ((m = s.match(/^\d+(?:\.\d+)?$/))) return positive(Number(s));
	if ((m = s.match(/^(\d+)\/(\d+)$/))) return fraction(0, +m[1], +m[2]);
	if ((m = s.match(/^(\d+) (\d+)\/(\d+)$/))) {
		if (+m[2] >= +m[3]) return { ok: false, reason: 'the fraction part must be below 1' };
		return fraction(+m[1], +m[2], +m[3]);
	}
	return { ok: false, reason: 'not a number or a fraction string', suggestion: suggest(s) };
}

function positive(n: number): QuantityResult {
	return n > 0 ? { ok: true, value: n } : { ok: false, reason: 'must be greater than 0' };
}

function fraction(whole: number, num: number, den: number): QuantityResult {
	if (den === 0) return { ok: false, reason: 'division by zero' };
	return positive(whole + num / den);
}

/** A corrected qty for common mistakes, written as YAML: `0.5`, `"1 1/2"`, `1, qty_max: 2`. */
function suggest(s: string): string | undefined {
	const t = s.trim();
	let m: RegExpMatchArray | null;
	if ((m = t.match(/^(\d+),(\d+)$/))) return `${m[1]}.${m[2]}`;
	if ((m = t.match(/^(\d*)\s*([½¼¾⅓⅔⅛])$/))) {
		const frac = VULGAR[m[2]];
		return m[1] ? `"${m[1]} ${frac}"` : `"${frac}"`;
	}
	// '1-1/2' as recipe cards write one and a half.
	if ((m = t.match(/^(\d+)\s*-\s*(\d+)\/(\d+)$/)) && +m[2] < +m[3]) return `"${m[1]} ${m[2]}/${m[3]}"`;
	if ((m = t.match(/^(\S+)\s*(?:-|–|à|to|ou|or)\s*(\S+)$/))) {
		const a = parseQuantity(m[1]);
		const b = parseQuantity(m[2]);
		if (a.ok && b.ok && b.value > a.value) return `${fmt(m[1])}, qty_max: ${fmt(m[2])}`;
	}
	return undefined;
}

/** Format a qty string for YAML: plain for decimals, quoted for fractions. */
export function fmt(q: string): string {
	return /^\d+(?:\.\d+)?$/.test(q) ? q : `"${q}"`;
}

/**
 * A number field that may carry markers, like `qty`: `servings: "4 [?]"`,
 * `temp: "350 [?]"` → the number. A plain number passes through; a string
 * without a marker, or with nothing but a number left once the markers are
 * gone, does not.
 */
export function markedNumber(v: unknown): number | undefined {
	if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
	if (typeof v !== 'string' || !findMarkers(v, '').length) return undefined;
	const s = stripMarkers(v.normalize('NFC'));
	return /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : undefined;
}
