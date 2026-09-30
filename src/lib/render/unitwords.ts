// The word each canonical unit shows (docs/VOCAB.md, "Unit labels"): data from
// the vault's vocab/unit-labels.yaml, regional (*c. à table* here, *c. à soupe*
// elsewhere), not code (plan 05, "Also decided"). Browser-safe.
//
// The words reach every page through the root layout, which installs them
// here (`setUnitWords`) before any page renders; the formatting functions
// (`unitLabel`, and through it ingredient lines, money, the form) read them
// from here. One vault per server, so one set of words per process.

import { UNITS, type Lang, type Unit } from '../vault/types';

/** Per unit, per language: [singular, plural]. */
export type UnitWords = Partial<Record<Unit, Partial<Record<Lang, [string, string]>>>>;

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function forms(v: unknown): [string, string] | undefined {
	if (typeof v === 'string' && v.trim()) return [v.trim(), v.trim()];
	if (Array.isArray(v) && v.length >= 1 && v.length <= 2 && v.every((x) => typeof x === 'string' && x.trim())) {
		const [one, many = one] = v.map((x: string) => x.trim());
		return [one, many];
	}
	return undefined;
}

/**
 * Read vocab/unit-labels.yaml: `unit: { fr: word | [singular, plural], en: … }`.
 * Only canonical units and the two languages are kept; a malformed entry is
 * dropped (its unit shows its code), never an error.
 */
export function parseUnitWords(data: unknown): UnitWords {
	const out: UnitWords = {};
	if (!isMap(data)) return out;
	for (const [unit, langs] of Object.entries(data)) {
		if (!(UNITS as readonly string[]).includes(unit) || !isMap(langs)) continue;
		const entry: Partial<Record<Lang, [string, string]>> = {};
		for (const lang of ['fr', 'en'] as const) {
			const f = forms(langs[lang]);
			if (f) entry[lang] = f;
		}
		if (Object.keys(entry).length) out[unit as Unit] = entry;
	}
	return out;
}

let current: UnitWords = {};

/** Install the vault's unit words (the root layout, on every page; tests). */
export function setUnitWords(words: UnitWords | null | undefined): void {
	current = words ?? {};
}

/** The words in use. */
export function unitWords(): UnitWords {
	return current;
}

/**
 * The unit word for an amount on an ingredient line: French plural from 2,
 * English above 1. `piece` shows no word there (a bare count, `3 oignons`); a
 * unit without a word in the vault shows its code.
 */
export function unitLabel(unit: Unit, amount: number, lang: Lang): string {
	return unit === 'piece' ? '' : unitWord(unit, amount, lang);
}

/**
 * The unit word wherever a count needs one, `piece` included (a price's pack
 * size: `6 pièces`). A unit without a word in the vault shows its code.
 */
export function unitWord(unit: Unit, amount: number, lang: Lang): string {
	const f = current[unit]?.[lang];
	if (!f) return unit;
	const plural = lang === 'fr' ? amount >= 2 : amount > 1;
	return plural ? f[1] : f[0];
}
