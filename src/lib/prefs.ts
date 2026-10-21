// What one account chose for itself (docs/DATA-FLOW.md, "Account
// preferences"): the language of the interface, the measuring system amounts
// are shown in, and its own word for a unit. Stored in users.json, never in
// the vault. Signed out, or nothing chosen: French, amounts as written, the
// vault's unit words. Browser-safe.
//
// The strings (`t`), the unit words and the amounts read the preferences from
// here. In the browser there is one person, so one set (`setPrefs`, from the
// root layout). On the server several requests run at once, so the hook gives
// a source that answers for the request being served (`setPrefsSource`).

import { UNITS, type Lang, type Unit } from './vault/types';

/** `written`: as the recipe has it. `metric`: ml and g. `imperial`: cups, spoons, lb and oz. */
export type UnitSystem = 'written' | 'metric' | 'imperial';
export const UNIT_SYSTEMS: readonly UnitSystem[] = ['written', 'metric', 'imperial'];
export const LANGS: readonly Lang[] = ['fr', 'en'];

/** Per unit, the account's own word: [singular, plural]. */
export type OwnWords = Partial<Record<Unit, [string, string]>>;

/** The preferences as stored in users.json: every key optional. */
export type StoredPrefs = { lang?: Lang; system?: UnitSystem; words?: OwnWords };

export interface Prefs {
	lang: Lang;
	system: UnitSystem;
	words: OwnWords;
	/**
	 * The account chose its language (it saved /compte). Then a unit shows its
	 * word in that language whatever the recipe's; signed out, or nothing
	 * chosen yet, in the recipe's, as before.
	 */
	account: boolean;
}

export const DEFAULT_PREFS: Prefs = Object.freeze({ lang: 'fr', system: 'written', words: Object.freeze({}), account: false });

/** The longest word an account may give a unit. */
export const WORD_MAX = 30;

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const clean = (v: unknown) => (typeof v === 'string' ? v.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, WORD_MAX) : '');

/**
 * Preferences from stored or posted data: anything unknown or malformed falls
 * back to the default, never an error. A word is `[singular, plural]`, or one
 * string for both; an empty singular drops the entry.
 */
export function parsePrefs(data: unknown): Prefs {
	if (!isMap(data)) return DEFAULT_PREFS;
	const words: OwnWords = {};
	if (isMap(data.words)) {
		for (const unit of UNITS) {
			const w = data.words[unit];
			const [one, many] = Array.isArray(w) ? [clean(w[0]), clean(w[1])] : [clean(w), ''];
			if (one) words[unit] = [one, many || one];
		}
	}
	return {
		lang: LANGS.includes(data.lang as Lang) ? (data.lang as Lang) : DEFAULT_PREFS.lang,
		system: UNIT_SYSTEMS.includes(data.system as UnitSystem) ? (data.system as UnitSystem) : DEFAULT_PREFS.system,
		words,
		account: LANGS.includes(data.lang as Lang)
	};
}

/** What users.json keeps: the language once chosen, and what differs from the defaults; undefined when there is nothing. */
export function storedPrefs(p: Prefs): StoredPrefs | undefined {
	if (isDefaultPrefs(p)) return undefined;
	return {
		...(p.account ? { lang: p.lang } : {}),
		...(p.system !== DEFAULT_PREFS.system ? { system: p.system } : {}),
		...(Object.keys(p.words).length ? { words: p.words } : {})
	};
}

/** True when nothing was chosen (nothing to store). */
export function isDefaultPrefs(p: Prefs): boolean {
	return !p.account && p.system === DEFAULT_PREFS.system && Object.keys(p.words).length === 0;
}

let installed: Prefs = DEFAULT_PREFS;
let source: (() => Prefs | undefined) | undefined;

/** Install the preferences in use (the root layout in the browser; tests). */
export function setPrefs(p: Prefs | null | undefined): void {
	installed = p ?? DEFAULT_PREFS;
}

/** Server: who answers for the request being served. Without an answer (outside a request), the defaults. */
export function setPrefsSource(fn: (() => Prefs | undefined) | undefined): void {
	source = fn;
}

/** The preferences in use. */
export function prefs(): Prefs {
	return source ? (source() ?? DEFAULT_PREFS) : installed;
}

/** The language of the interface. */
export const locale = (): Lang => prefs().lang;
