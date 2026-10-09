// What she types in a quantity field ↔ `qty` as the schema writes it
// (plan 04, Q7 A; docs/RECIPE-SCHEMA.md "Fractions stay as written").
//
// Accepted: `2`, `1.5`, `0,5` (a decimal comma), `1/2`, `1 1/2`, `½`, `1½`,
// `1 ½`. Decimals become numbers; fractions stay strings as written, with a
// Unicode fraction spelled out (`1½` → "1 1/2"). Anything else is refused.

import { parseQuantity } from '../vault/quantity';
import type { Lang } from '../vault/types';
import { hideMarkers } from './markers';

export type QuantityInput =
	| { ok: true; raw: number | string; value: number }
	| { ok: false; reason: 'empty' | 'format' | 'zero' | 'fraction' };

/** Unicode vulgar fractions and their written form. */
export const FRACTION_GLYPHS: Record<string, string> = {
	'¼': '1/4',
	'½': '1/2',
	'¾': '3/4',
	'⅓': '1/3',
	'⅔': '2/3',
	'⅕': '1/5',
	'⅖': '2/5',
	'⅗': '3/5',
	'⅘': '4/5',
	'⅙': '1/6',
	'⅚': '5/6',
	'⅛': '1/8',
	'⅜': '3/8',
	'⅝': '5/8',
	'⅞': '7/8'
};
const GLYPH_OF = Object.fromEntries(Object.entries(FRACTION_GLYPHS).map(([g, f]) => [f, g]));
const GLYPH_CLASS = `[${Object.keys(FRACTION_GLYPHS).join('')}]`;

/** Parse a typed quantity. */
export function parseQuantityInput(input: string): QuantityInput {
	// « 1-1/2 » is how cards write one and a half (a range has its own field).
	const s = input.normalize('NFC').replace(/⁄/g, '/').trim().replace(/\s+/g, ' ').replace(/^(\d+)-(?=\d+\/)/, '$1 ');
	if (!s) return { ok: false, reason: 'empty' };
	let m: RegExpMatchArray | null;
	if ((m = s.match(new RegExp(`^(\\d+)? ?(${GLYPH_CLASS})$`)))) {
		const frac = FRACTION_GLYPHS[m[2]];
		return fraction(m[1] ? `${Number(m[1])} ${frac}` : frac);
	}
	if (/^(?:\d+|\d*[.,]\d+)$/.test(s)) {
		const n = Number(s.replace(',', '.'));
		return n > 0 ? { ok: true, raw: n, value: n } : { ok: false, reason: 'zero' };
	}
	if ((m = s.match(/^(\d+) (\d+)\/(\d+)$/))) {
		if (+m[3] === 0) return { ok: false, reason: 'format' };
		if (+m[2] >= +m[3]) return { ok: false, reason: 'fraction' };
		return fraction(s);
	}
	if ((m = s.match(/^(\d+)\/(\d+)$/))) {
		if (+m[2] === 0) return { ok: false, reason: 'format' };
		return fraction(s);
	}
	return { ok: false, reason: 'format' };
}

function fraction(s: string): QuantityInput {
	const q = parseQuantity(s);
	return q.ok ? { ok: true, raw: s, value: q.value } : { ok: false, reason: 'zero' };
}

/** A decimal as she would type it: `0,5` in French, `0.5` in English. */
export function showDecimal(n: number, lang: Lang): string {
	const s = String(n);
	return lang === 'fr' ? s.replace('.', ',') : s;
}

/**
 * A `qty` as the field shows it: a number as a decimal, a fraction string as
 * written with its fraction as a glyph when there is one (`"1 1/2"` → `1 ½`),
 * markers never shown.
 */
export function showQuantity(raw: number | string, lang: Lang): string {
	if (typeof raw === 'number') return showDecimal(raw, lang);
	const s = hideMarkers(raw);
	const m = s.match(/^(?:(\d+) )?(\d+\/\d+)$/);
	if (m && GLYPH_OF[m[2]]) return m[1] ? `${m[1]} ${GLYPH_OF[m[2]]}` : GLYPH_OF[m[2]];
	return s;
}

/** A plain positive number typed in a field (servings, oven temperature): `4`, `2,5`. */
export function parseNumberInput(input: string): { ok: true; value: number } | { ok: false; reason: 'empty' | 'format' | 'zero' } {
	const s = input.trim();
	if (!s) return { ok: false, reason: 'empty' };
	if (!/^(?:\d+|\d*[.,]\d+)$/.test(s)) return { ok: false, reason: 'format' };
	const n = Number(s.replace(',', '.'));
	return n > 0 ? { ok: true, value: n } : { ok: false, reason: 'zero' };
}
