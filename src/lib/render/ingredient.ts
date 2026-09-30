// An ingredient entry as a sentence in the recipe's language, the vault's unit words:
// "2 tasses de farine tamisée", "1 c. à thé de sel", "2 gousses d'ail".
// Returned as parts so the page can link sub-recipes and style markers.

import type { Alt, Ingredient, Lang, Unit } from '../vault/types';
import { formatNumber } from './fraction';
import { unitLabel } from './unitwords';

// The unit words are the vault's (vocab/unit-labels.yaml, ./unitwords.ts).
export { unitLabel } from './unitwords';

// Words whose h is mute (elided: « d’huile »). Every other h is taken as
// aspirated (« de haricots », « de homard », « de hachis »), and y is never
// elided (« de yogourt »).
const H_MUET = /^(?:huile|herbe|huître|huitre|hysope|hydromel|hôte|hôtel)/i;

/** `de ` or `d’` before a name: elision before a vowel or a mute h. */
export function de(name: string): string {
	const n = name.normalize('NFC').trimStart();
	if (/^[aeiouàâäéèêëîïôöùûüœæ]/i.test(n)) return 'd’';
	return H_MUET.test(n) ? 'd’' : 'de ';
}

export interface AmountOptions {
	factor?: number;
	lang: Lang;
}

/** "2 à 3 c. à table", "1 ½ tasse", "3" (pieces) — empty when there is no qty. */
export function formatAmount(
	q: { qty?: { value: number }; qtyMax?: { value: number }; unit?: Unit },
	{ factor = 1, lang }: AmountOptions
): string {
	if (!q.qty) return '';
	const a = q.qty.value * factor;
	const b = q.qtyMax ? q.qtyMax.value * factor : undefined;
	const nums = b ? `${formatNumber(a, lang)}${lang === 'fr' ? ' à ' : '–'}${formatNumber(b, lang)}` : formatNumber(a, lang);
	const unit = q.unit ? unitLabel(q.unit, b ?? a, lang) : '';
	return unit ? `${nums} ${unit}` : nums;
}

export type Part =
	| { kind: 'amount'; text: string }
	| { kind: 'text'; text: string }
	| { kind: 'name'; text: string; recipe?: string }
	| { kind: 'muted'; text: string };

const WORDS = {
	fr: { or: 'ou', toTaste: 'au goût', optional: 'facultatif', buy: 'ou acheter :', ready: 'du commerce' },
	en: { or: 'or', toTaste: 'to taste', optional: 'optional', buy: 'or buy:', ready: 'store-bought' }
};

function altText(alt: Alt, factor: number, lang: Lang): string {
	return formatAmount(alt, { factor, lang });
}

/**
 * The parts of one ingredient line. `factor` rescales every quantity,
 * alternatives and `or` entries included.
 */
export function ingredientParts(it: Ingredient, { factor = 1, lang }: AmountOptions): Part[] {
	const w = WORDS[lang];
	const parts: Part[] = [];
	const amount = formatAmount(it, { factor, lang });
	if (amount) {
		parts.push({ kind: 'amount', text: amount });
		// A marker on the quantity itself ("250 [?]") must stay visible.
		const qtyMarkers = [it.qty?.raw, it.qtyMax?.raw]
			.filter((r): r is string => typeof r === 'string')
			.flatMap((r) => r.match(/\[[^\]]*\]/g) ?? []);
		if (qtyMarkers.length) parts.push({ kind: 'text', text: ` ${qtyMarkers.join(' ')}` });
		if (it.alt) parts.push({ kind: 'muted', text: ` (${altText(it.alt, factor, lang)})` });
		// French measures take "de": 500 g de farine, 2 gousses d’ail; pieces do not: 3 oignons.
		const joiner = lang === 'fr' && it.unit && it.unit !== 'piece' ? ` ${de(it.name)}` : ' ';
		parts.push({ kind: 'text', text: joiner });
	}
	parts.push({ kind: 'name', text: it.name, recipe: it.recipe });
	if (it.brand) parts.push({ kind: 'text', text: ` ${it.brand}` });
	if (it.prep) parts.push({ kind: 'text', text: lang === 'fr' ? ` ${it.prep}` : `, ${it.prep}` });
	if (it.note) parts.push({ kind: 'muted', text: ` (${it.note})` });
	if (it.toTaste) parts.push({ kind: 'muted', text: `, ${w.toTaste}` });
	for (const o of it.or ?? []) {
		parts.push({ kind: 'text', text: `, ${w.or} ` });
		const sub = ingredientParts(o, { factor, lang });
		parts.push(...sub);
	}
	if (it.recipe && it.buyInstead) parts.push({ kind: 'muted', text: ` — ${w.buy} ${it.name} ${w.ready}` });
	if (it.optional) parts.push({ kind: 'muted', text: ` (${w.optional})` });
	return parts;
}

/** The line as plain text (print, kitchen step lines, tests). */
export function ingredientText(it: Ingredient, opts: AmountOptions): string {
	return ingredientParts(it, opts)
		.map((p) => p.text)
		.join('')
		.replace(/\s+/g, ' ')
		.trim();
}
