// An ingredient entry as a sentence in the recipe's language, the vault's unit words:
// "2 tasses de farine tamisée", "1 c. à thé de sel", "2 gousses d'ail".
// Returned as parts so the page can link sub-recipes and style markers.

import type { Alt, Ingredient, Lang, Unit } from '../vault/types';
import { formatNumber } from './fraction';
import { UNIT_CLASS_OF } from '../ingredients/types';
import { prefs } from '../prefs';
import { formatScaledNumber, scaleValues, type ScalingRules } from './scale';
import { inSystem, isNative } from './system';
import { unitLabel, wordLang } from './unitwords';
import { lookupKey, type PluralRule } from '../ingredients/normalize';
import { fold } from '../vault/normalize';
import { agreePrepFr, pluralFr, pluralNameFr } from './agree';
import { scaleNote } from './pans';

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
	/** Never converted to the account's measuring system: the form, the amount a tap scales against. */
	asWritten?: boolean;
	/** Grams for one of the line's unit, from the ingredient's entry: a counted amount then shows its weight too. */
	gramsPerUnit?: number;
	/** The line's name in the singular and the plural (`nameForms`): a bare count then takes the form its number needs. */
	forms?: NameForms;
}

type Amounted = { qty?: { value: number }; qtyMax?: { value: number }; unit?: Unit };

/** An amount as shown: its text and whether it is rounded (`≈`, shown apart). */
export function amountView(q: Amounted, { factor = 1, lang: recipeLang, rules, asWritten }: AmountOptions): { text: string; approx: boolean; last?: number } {
	if (!q.qty) return { text: '', approx: false };
	const lang = wordLang(recipeLang);
	const written = q.qtyMax ? [q.qty.value, q.qtyMax.value] : [q.qty.value];
	// The account's measuring system (./system.ts): converted, then rounded as a scaled amount is.
	const own = asWritten ? undefined : inSystem(written, q.unit, prefs().system);
	const s = own ? scaleValues(own.values, own.unit, factor, rules, true) : scaleValues(written, q.unit, factor, rules);
	const fmt = (v: number) => (s.plain ? formatNumber(v, lang) : formatScaledNumber(v, s.decimal, lang));
	const nums = s.values.map(fmt).join(lang === 'fr' ? ' à ' : '–');
	const unit = s.unit ? unitLabel(s.unit, s.values.at(-1)!, lang) : '';
	return { text: unit ? `${nums} ${unit}` : nums, approx: s.approx, last: s.values.at(-1) };
}

/** A name in the singular and the plural, as written (docs/DATA-FLOW.md, "Names"). */
export interface NameForms {
	one: string;
	other: string;
}

/**
 * The singular and plural of a written name, read from its registry entry's
 * names: an entry name that differs from it, word for word, only by the
 * language's plural suffixes (vocab/normalize.yaml) gives the other form, in
 * the line's own spelling (`oeuf` with `œufs` in the entry → `oeufs`).
 * Undefined when the entry gives no such form: the name then stays as written.
 */
export function nameForms(name: string, entryNames: readonly string[], rule: PluralRule | undefined): NameForms | undefined {
	if (!rule || /[[\]]/.test(name)) return undefined;
	const written = name.trim().split(/\s+/);
	const keys = lookupKey(name).split(' ');
	if (keys.length !== written.length) return undefined;
	// Per word: '' when the same, else the suffix `to` adds to `from`; undefined when they differ otherwise or not at all.
	const added = (from: string[], to: string[]) => {
		const out: string[] = [];
		for (let i = 0; i < from.length; i++) {
			if (from[i] === to[i]) out.push('');
			else {
				const s = rule.suffixes.find((x) => to[i] === from[i] + x && to[i].length >= rule.minLength);
				if (s === undefined) return undefined;
				out.push(s);
			}
		}
		return out.some(Boolean) ? out : undefined;
	};
	for (const other of entryNames) {
		const ok = lookupKey(other).split(' ');
		if (ok.length !== keys.length) continue;
		const up = added(keys, ok);
		if (up) return { one: name, other: written.map((w, i) => w + up[i]).join(' ') };
		const down = added(ok, keys);
		if (down && written.every((w, i) => !down[i] || fold(w.slice(-down[i].length)) === down[i])) {
			return { one: written.map((w, i) => (down[i] ? w.slice(0, -down[i].length) : w)).join(' '), other: name };
		}
	}
	return undefined;
}

/** The form a bare count takes, in the recipe's language: French from 2 (`1 ½ œuf`, `2 œufs`), English above 1, as unit words do (docs/VOCAB.md). */
export function nameFor(forms: NameForms, count: number, lang: Lang): string {
	return (lang === 'fr' ? count >= 2 : count > 1) ? forms.other : forms.one;
}

/**
 * The name and prep of a bare count (`piece` or no unit) at the number it
 * shows (docs/DATA-FLOW.md, "Names"): the registry's form of the name first
 * (`forms`); else, in French and at a factor other than 1, the name in the
 * plural by rule from 2 (./agree.ts: « 2 ½ poivrons verts », « 4 pâtes à
 * tarte »); a leading participle or adjective of the prep then agrees with it
 * (« hachés », « pilées »; never « en dés », « au goût »). At ×1 without a
 * registry form, the card's words as written. One function for the recipe
 * page and kitchen mode.
 */
export function countWords(it: Pick<Ingredient, 'name' | 'prep'>, shown: number, { lang, factor = 1, forms }: { lang: Lang; factor?: number; forms?: NameForms }): { name: string; prep?: string } {
	let name = it.name;
	let plural: boolean | undefined;
	if (forms) {
		name = nameFor(forms, shown, lang);
		plural = lang === 'fr' ? pluralFr(shown) : shown > 1;
	} else if (lang === 'fr' && factor !== 1 && pluralFr(shown)) {
		name = pluralNameFr(it.name);
		plural = true;
	}
	const agree = lang === 'fr' && it.prep && plural !== undefined && (factor !== 1 || name !== it.name);
	return { name, prep: agree ? agreePrepFr(it.prep!, plural!) : it.prep };
}

/**
 * The weight of a counted amount (`2 branches` → `≈ 80 g`), for an account
 * that reads in a measuring system and an ingredient whose entry gives the
 * weight of one. Empty otherwise: a weight is never guessed.
 */
function weightText(it: Amounted, opts: AmountOptions): string {
	const system = prefs().system;
	if (!it.qty || !opts.gramsPerUnit || opts.asWritten || system === 'written') return '';
	const cls = UNIT_CLASS_OF[it.unit ?? 'piece'];
	if (cls === 'mass' || cls === 'volume') return '';
	const ends = (it.qtyMax ? [it.qty.value, it.qtyMax.value] : [it.qty.value]).map((v) => v * opts.gramsPerUnit!);
	const own = inSystem(ends, 'g', system) ?? { values: ends, unit: 'g' as const };
	const s = scaleValues(own.values, own.unit, opts.factor ?? 1, opts.rules, true);
	if (s.plain) return '';
	const lang = wordLang(opts.lang);
	const nums = s.values.map((v) => formatScaledNumber(v, s.decimal, lang)).join(lang === 'fr' ? ' à ' : '–');
	// One clove's weight is an average: always marked.
	return `${APPROX} ${nums} ${unitLabel(s.unit!, s.values.at(-1)!, lang)}`;
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
	fr: {
		or: 'ou',
		toTaste: 'au goût',
		optional: 'facultatif',
		buy: 'ou acheter :',
		ready: 'du commerce',
		egg: (n: number) => (n ? `${n} ${n >= 2 ? 'œufs' : 'œuf'} + 1 jaune` : '1 jaune'),
		plan: (n: number) => `prévoir ${n}`
	},
	en: {
		or: 'or',
		toTaste: 'to taste',
		optional: 'optional',
		buy: 'or buy:',
		ready: 'store-bought',
		egg: (n: number) => (n ? `${n} ${n > 1 ? 'eggs' : 'egg'} + 1 yolk` : '1 yolk'),
		plan: (n: number) => `get ${n}`
	}
};

/** An egg, by its name as written or its registry forms: `oeuf`, `œufs`, `gros œuf`, `egg`. */
const EGG = /^(?:gros |petits? |large |small )?(?:oeufs?|œufs?|eggs?)$/;

/**
 * Help beside a scaled whole thing that shows a half (usability round 3; plan
 * 05, "Halves of whole things"): an egg says how to measure the half
 * (« 1 ½ œuf » → « 1 œuf + 1 jaune »), anything else how many to have on hand
 * (« 2 ½ abaisses » → « prévoir 3 »). Never at factor 1: the card's own half
 * is the card's. Nothing for a range or a whole number.
 */
export function halfHelp(it: Pick<Ingredient, 'name' | 'unit' | 'qtyMax'>, shown: number | undefined, factor: number, lang: Lang): string {
	if (factor === 1 || shown === undefined || it.qtyMax || (it.unit && it.unit !== 'piece')) return '';
	const whole = Math.floor(shown + 1e-9);
	if (Math.abs(shown - whole - 0.5) > 1e-9) return '';
	const w = WORDS[lang];
	return EGG.test(fold(it.name.replace(/\[[^\]]*\]/g, '').trim().toLowerCase())) ? w.egg(whole) : w.plan(whole + 1);
}

// The card's second measure shows as the card has it, whatever the measuring system.
function altText(alt: Alt, opts: AmountOptions): string {
	return formatAmount(alt, { ...opts, asWritten: true });
}

/**
 * The parts of one ingredient line. `factor` rescales every quantity,
 * alternatives and `or` entries included, each rounded in its own unit by
 * `rules`; `note` (a can's size), `prep`, markers and `to_taste` never change,
 * except a note that counts what the line makes (« pour 2 tartes », `scaleNote`).
 */
export function ingredientParts(it: Ingredient, opts: AmountOptions): Part[] {
	const { lang } = opts;
	const w = WORDS[lang];
	const parts: Part[] = [];
	// The other measure a card gives (`1 tasse (250 ml)`) comes first when it is
	// the one in the account's measuring system.
	const system = opts.asWritten ? 'written' : prefs().system;
	if (it.alt && it.unit && it.alt.unit && !isNative(it.unit, system) && isNative(it.alt.unit, system)) {
		const { alt, ...rest } = it;
		it = { ...rest, qty: alt.qty, qtyMax: alt.qtyMax, unit: alt.unit, alt: { qty: it.qty!, qtyMax: it.qtyMax, unit: it.unit } } as Ingredient;
	}
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
		const weight = weightText(it, opts);
		if (weight) parts.push({ kind: 'muted', text: ` (${weight})` });
		// French measures take "de": 500 g de farine, 2 gousses d’ail; pieces do not: 3 oignons.
		// Only when the unit's word is French too: `2 cups farine`, not `2 cups de farine`.
		const joiner = lang === 'fr' && wordLang(lang) === 'fr' && it.unit && it.unit !== 'piece' ? ` ${de(it.name)}` : ' ';
		parts.push({ kind: 'text', text: joiner });
	}
	// A bare count reads with its name and prep in the number it shows (`countWords`).
	const { name, prep } = amount.last !== undefined && (!it.unit || it.unit === 'piece') ? countWords(it, amount.last, { lang, factor: opts.factor, forms: opts.forms }) : it;
	parts.push(it.recipe ? { kind: 'name', text: name, recipe: it.recipe, line: it } : { kind: 'name', text: name });
	if (it.brand) parts.push({ kind: 'text', text: ` ${it.brand}` });
	if (prep) parts.push({ kind: 'text', text: lang === 'fr' ? ` ${prep}` : `, ${prep}` });
	// The help and the note in one parenthesis, the help first: « (prévoir 6 · pour 4 tartes) ».
	// A note that says what the line makes (« pour 2 tartes ») counts with the recipe (./pans.ts); any other stays as written.
	const help = halfHelp(it, amount.last, opts.factor ?? 1, lang);
	const note = it.note ? scaleNote(it.note, opts.factor ?? 1, lang) : '';
	const aside = [help, note].filter(Boolean).join(' · ');
	if (aside) parts.push({ kind: 'muted', text: ` (${aside})` });
	if (it.toTaste) parts.push({ kind: 'muted', text: `, ${w.toTaste}` });
	for (const o of it.or ?? []) {
		parts.push({ kind: 'text', text: `, ${w.or} ` });
		const sub = ingredientParts(o, { ...opts, forms: undefined });
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
