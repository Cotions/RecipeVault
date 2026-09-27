// Quantities for display: fractions as fractions (⅔, 1 ½), never 0.667.

import type { Lang, Quantity } from '../vault/types';

const GLYPHS: [number, string][] = [
	[1 / 8, '⅛'],
	[1 / 4, '¼'],
	[1 / 3, '⅓'],
	[3 / 8, '⅜'],
	[1 / 2, '½'],
	[5 / 8, '⅝'],
	[2 / 3, '⅔'],
	[3 / 4, '¾'],
	[7 / 8, '⅞']
];

/**
 * A number as a cook would write it: whole part plus a common fraction when
 * one is within 2 %, else a short decimal (comma in French).
 */
export function formatNumber(n: number, lang: Lang = 'fr'): string {
	if (!Number.isFinite(n) || n <= 0) return '';
	const whole = Math.floor(n);
	const frac = n - whole;
	if (frac < 0.02) return String(whole);
	if (frac > 0.98) return String(whole + 1);
	// Fractions read well for small amounts only; 250.5 g stays a decimal.
	if (n < 20) {
		for (const [v, g] of GLYPHS) {
			if (Math.abs(frac - v) <= 0.02) return whole ? `${whole} ${g}` : g;
		}
	}
	const digits = n < 10 ? 2 : n < 100 ? 1 : 0;
	const s = String(Number(n.toFixed(digits)));
	return lang === 'fr' ? s.replace('.', ',') : s;
}

/** A quantity as written, scaled by `factor`. Unscaled fractions keep their written form. */
export function formatQuantity(q: Quantity, factor = 1, lang: Lang = 'fr'): string {
	return formatNumber(q.value * factor, lang);
}
