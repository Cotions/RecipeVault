// An ingredient entry as a sentence in the recipe's language, the vault's unit words:
// "2 tasses de farine tamisée", "1 c. à thé de sel", "2 gousses d'ail".
// Returned as parts so the page can link sub-recipes and style markers.

import type { Alt, Ingredient, Lang, Unit } from '../vault/types';
import { formatNumber } from './fraction';
import { formatScaledNumber, scaleValues, type ScalingRules } from './scale';
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
	/** vocab/scaling.yaml (plan 05): how amounts show at a factor other than 1. Without it, the exact value, as before. */
	rules?: ScalingRules | null;
}

type Amounted = { qty?: { value: number }; qtyMax?: { value: number }; unit?: Unit };

/** An amount as shown: its text and whether it is rounded (`≈`, shown apart). */
export function amountView(q: Amounted, { factor = 1, lang, rules }: AmountOptions): { text: string; approx: boolean } {
	if (!q.qty) return { text: '', approx: false };
	const s = scaleValues(q.qtyMax ? [q.qty.value, q.qtyMax.value] : [q.qty.value], q.unit, factor, rules);
	const fmt = (v: number) => (s.plain ? formatNumber(v, lang) : formatScaledNumber(v, s.decimal, lang));
	const nums = s.values.map(fmt).join(lang === 'fr' ? ' à ' : '–');
	const unit = s.unit ? unitLabel(s.unit, s.values.at(-1)!, lang) : '';
	return { text: unit ? `${nums} ${unit}` : nums, approx: s.approx };
}

/** "2 à 3 c. à table", "1 ½ tasse", "3" (pieces), "≈ 1 ½" — empty when there is no qty. */
export function formatAmount(q: Amounted, opts: AmountOptions): string {
	const v = amountView(q, opts);
	return v.approx ? `${APPROX} ${v.text}` : v.text;
}

/** The mark of a rounded amount (plan 05, Q2 A). */
export const APPROX = '≈';

/** The written amount a tap scales against (Q8 B): factor = what she has ÷ `value`, the lower bound of a range, in `unit`. */
export interface ScaleBase {
	value: number;
	unit?: Unit;
}

export type Part =
	| { kind: 'amount'; text: string; base?: ScaleBase }
	/** A scaled amount rounded more than 2 % (plan 05, Q2 A): `≈ `, before the amount. */
	| { kind: 'approx'; text: string }
	| { kind: 'text'; text: string }
	/** `line`: the ingredient a sub-recipe name belongs to, so its link can carry the derived amount (Q5 A). */
	| { kind: 'name'; text: string; recipe?: string; line?: Ingredient }
	| { kind: 'muted'; text: string; base?: ScaleBase };

const WORDS = {
	fr: { or: 'ou', toTaste: 'au goût', optional: 'facultatif', buy: 'ou acheter :', ready: 'du commerce' },
	en: { or: 'or', toTaste: 'to taste', optional: 'optional', buy: 'or buy:', ready: 'store-bought' }
};

function altText(alt: Alt, opts: AmountOptions): string {
	return formatAmount(alt, opts);
}

/**
 * The parts of one ingredient line. `factor` rescales every quantity,
 * alternatives and `or` entries included, each rounded in its own unit by
 * `rules`; `note` (a can's size), `prep`, markers and `to_taste` never change.
 */
export function ingredientParts(it: Ingredient, opts: AmountOptions): Part[] {
	const { lang } = opts;
	const w = WORDS[lang];
	const parts: Part[] = [];
	const amount = amountView(it, opts);
	if (amount.text) {
		if (amount.approx) parts.push({ kind: 'approx', text: `${APPROX} ` });
		const tappable = !it.toTaste && it.qty!.value > 0;
		parts.push(tappable ? { kind: 'amount', text: amount.text, base: { value: it.qty!.value, unit: it.unit } } : { kind: 'amount', text: amount.text });
		// A marker on the quantity itself ("250 [?]") must stay visible.
		const qtyMarkers = [it.qty?.raw, it.qtyMax?.raw]
			.filter((r): r is string => typeof r === 'string')
			.flatMap((r) => r.match(/\[[^\]]*\]/g) ?? []);
		if (qtyMarkers.length) parts.push({ kind: 'text', text: ` ${qtyMarkers.join(' ')}` });
		if (it.alt) {
			const text = ` (${altText(it.alt, opts)})`;
			parts.push(tappable && it.alt.qty.value > 0 ? { kind: 'muted', text, base: { value: it.alt.qty.value, unit: it.alt.unit } } : { kind: 'muted', text });
		}
		// French measures take "de": 500 g de farine, 2 gousses d’ail; pieces do not: 3 oignons.
		const joiner = lang === 'fr' && it.unit && it.unit !== 'piece' ? ` ${de(it.name)}` : ' ';
		parts.push({ kind: 'text', text: joiner });
	}
	parts.push(it.recipe ? { kind: 'name', text: it.name, recipe: it.recipe, line: it } : { kind: 'name', text: it.name });
	if (it.brand) parts.push({ kind: 'text', text: ` ${it.brand}` });
	if (it.prep) parts.push({ kind: 'text', text: lang === 'fr' ? ` ${it.prep}` : `, ${it.prep}` });
	if (it.note) parts.push({ kind: 'muted', text: ` (${it.note})` });
	if (it.toTaste) parts.push({ kind: 'muted', text: `, ${w.toTaste}` });
	for (const o of it.or ?? []) {
		parts.push({ kind: 'text', text: `, ${w.or} ` });
		const sub = ingredientParts(o, opts);
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
