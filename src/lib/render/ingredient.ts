// An ingredient entry as a sentence in the recipe's language, Québec words:
// "2 tasses de farine tamisée", "1 c. à thé de sel", "2 gousses d'ail".
// Returned as parts so the page can link sub-recipes and style markers.

import type { Alt, Ingredient, Lang, Unit } from '../vault/types';
import { formatNumber } from './fraction';

type Forms = [singular: string, plural: string];

const FR: Record<Unit, Forms> = {
	g: ['g', 'g'],
	kg: ['kg', 'kg'],
	ml: ['ml', 'ml'],
	cl: ['cl', 'cl'],
	l: ['L', 'L'],
	cup: ['tasse', 'tasses'],
	tbsp: ['c. à table', 'c. à table'],
	tsp: ['c. à thé', 'c. à thé'],
	pinch: ['pincée', 'pincées'],
	drop: ['goutte', 'gouttes'],
	lb: ['lb', 'lb'],
	oz: ['oz', 'oz'],
	qt: ['pinte', 'pintes'],
	pint: ['chopine', 'chopines'],
	piece: ['', ''],
	clove: ['gousse', 'gousses'],
	leaf: ['feuille', 'feuilles'],
	sprig: ['brin', 'brins'],
	stalk: ['branche', 'branches'],
	bunch: ['botte', 'bottes'],
	slice: ['tranche', 'tranches'],
	can: ['boîte', 'boîtes'],
	packet: ['sachet', 'sachets'],
	bottle: ['bouteille', 'bouteilles'],
	jar: ['pot', 'pots'],
	bag: ['sac', 'sacs']
};

const EN: Record<Unit, Forms> = {
	g: ['g', 'g'],
	kg: ['kg', 'kg'],
	ml: ['ml', 'ml'],
	cl: ['cl', 'cl'],
	l: ['L', 'L'],
	cup: ['cup', 'cups'],
	tbsp: ['tbsp', 'tbsp'],
	tsp: ['tsp', 'tsp'],
	pinch: ['pinch', 'pinches'],
	drop: ['drop', 'drops'],
	lb: ['lb', 'lb'],
	oz: ['oz', 'oz'],
	qt: ['quart', 'quarts'],
	pint: ['pint', 'pints'],
	piece: ['', ''],
	clove: ['clove', 'cloves'],
	leaf: ['leaf', 'leaves'],
	sprig: ['sprig', 'sprigs'],
	stalk: ['stalk', 'stalks'],
	bunch: ['bunch', 'bunches'],
	slice: ['slice', 'slices'],
	can: ['can', 'cans'],
	packet: ['packet', 'packets'],
	bottle: ['bottle', 'bottles'],
	jar: ['jar', 'jars'],
	bag: ['bag', 'bags']
};

/** The unit word for an amount: French plural from 2, English above 1. */
export function unitLabel(unit: Unit, amount: number, lang: Lang): string {
	const [one, many] = (lang === 'fr' ? FR : EN)[unit];
	const plural = lang === 'fr' ? amount >= 2 : amount > 1;
	return plural ? many : one;
}

/** `de ` or `d'` before a name, French elision before a vowel or a mute-ish h. */
export function de(name: string): string {
	return /^[aeiouyàâäéèêëîïôöùûüœæh]/i.test(name.normalize('NFC')) ? 'd’' : 'de ';
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
