// Account preferences (lib/prefs.ts): the interface's language, the measuring
// system, an account's own unit words — and what each changes on a page.
// Invented ingredients only.

import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { t } from '../../src/lib/i18n';
import { en } from '../../src/lib/i18n/en';
import { fr } from '../../src/lib/i18n/fr';
import { localized } from '../../src/lib/i18n/localized';
import { parseConversions } from '../../src/lib/ingredients/units';
import { DEFAULT_PREFS, isDefaultPrefs, locale, parsePrefs, prefs, setPrefs, setPrefsSource, storedPrefs, type Prefs } from '../../src/lib/prefs';
import { formatAmount, ingredientText } from '../../src/lib/render/ingredient';
import { parseScaling } from '../../src/lib/render/scale';
import { inSystem, setConversions } from '../../src/lib/render/system';
import { unitWord } from '../../src/lib/render/unitwords';
import { seedVocab } from '../../src/lib/server/vault';
import type { Ingredient } from '../../src/lib/vault/types';

const SEED = seedVocab(readFileSync('docs/VOCAB.md', 'utf8'));
const CONV = parseConversions(parse(SEED['conversions.yaml'], { version: '1.2' }));
const RULES = parseScaling(parse(SEED['scaling.yaml'], { version: '1.2' }))!;

const account = (p: Partial<Prefs> = {}): Prefs => ({ ...DEFAULT_PREFS, account: true, ...p });
const item = (i: Partial<Ingredient> & { name: string }) => i as Ingredient;
const q = (value: number) => ({ value, raw: String(value) });

afterEach(() => {
	setPrefs(null);
	setPrefsSource(undefined);
	setConversions(null);
});

describe('prefs', () => {
	it('reads stored choices, and falls back on anything unknown', () => {
		expect(parsePrefs(undefined)).toBe(DEFAULT_PREFS);
		// A language chosen, French included, is the account's from then on.
		expect(parsePrefs({ lang: 'fr' })).toEqual(account());
		expect(parsePrefs({ system: 'metric' })).toEqual({ ...DEFAULT_PREFS, system: 'metric' });
		expect(parsePrefs({ lang: 'en', system: 'metric', words: { tbsp: ['c. à soupe', 'c. à soupe'], stalk: 'tige' } })).toEqual(
			account({ lang: 'en', system: 'metric', words: { tbsp: ['c. à soupe', 'c. à soupe'], stalk: ['tige', 'tige'] } })
		);
		expect(parsePrefs({ lang: 'de', system: 'stone', words: { furlong: 'x', cup: ['', 'tasses'], tsp: 3, clove: ['  caïeu  ', ''] } })).toEqual({ ...DEFAULT_PREFS, words: { clove: ['caïeu', 'caïeu'] } });
		expect(parsePrefs({ words: { cup: 'x'.repeat(80) } }).words.cup![0]).toHaveLength(30);
	});

	it('stores only what differs from the defaults', () => {
		expect(isDefaultPrefs(DEFAULT_PREFS)).toBe(true);
		expect(storedPrefs(DEFAULT_PREFS)).toBeUndefined();
		expect(storedPrefs(account())).toEqual({ lang: 'fr' });
		expect(storedPrefs(account({ lang: 'en' }))).toEqual({ lang: 'en' });
		expect(storedPrefs({ ...DEFAULT_PREFS, system: 'imperial', words: { stalk: ['tige', 'tiges'] } })).toEqual({ system: 'imperial', words: { stalk: ['tige', 'tiges'] } });
	});

	it('answers for the request being served; in the browser, for what is installed', () => {
		expect(prefs()).toBe(DEFAULT_PREFS);
		setPrefs(account({ lang: 'en' }));
		expect(locale()).toBe('en');
		let serving: Prefs | undefined = account({ lang: 'fr' });
		setPrefsSource(() => serving);
		expect(locale()).toBe('fr');
	});

	it('on the server, a request with no answer gets the defaults, never what another one installed', () => {
		setPrefs(account({ lang: 'en', system: 'metric' }));
		setPrefsSource(() => undefined);
		expect(prefs()).toBe(DEFAULT_PREFS);
		expect(locale()).toBe('fr');
	});
});

describe('the strings', () => {
	it('read in the current language at every access', () => {
		expect(t.app.nav.pantry).toBe(fr.app.nav.pantry);
		const held = t.app.nav;
		setPrefs(account({ lang: 'en' }));
		expect(t.app.nav.pantry).toBe(en.app.nav.pantry);
		expect(held.pantry).toBe(en.app.nav.pantry);
		expect(t.app.nav.queue(3)).toBe(en.app.nav.queue(3));
		expect(Object.keys(t.status)).toEqual(Object.keys(fr.status));
	});

	it('fall back to French for a string another language lacks', () => {
		const s = localized({ fr: { a: 'un', b: { c: 'deux' } }, en: { a: 'one', b: {} } as { a: string; b: { c: string } } });
		setPrefs(account({ lang: 'en' }));
		expect([s.a, s.b.c]).toEqual(['one', 'deux']);
	});

	it('have the same keys in both languages', () => {
		const keys = (o: object, at = ''): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${at}${k}.`) : [`${at}${k}:${typeof v}`]));
		expect(keys(en)).toEqual(keys(fr));
	});
});

describe('unit words', () => {
	it('are the recipe’s language until an account chooses its own', () => {
		expect(unitWord('cup', 2, 'en')).toBe('cups');
		setPrefs({ ...DEFAULT_PREFS, system: 'metric' });
		expect(unitWord('cup', 2, 'en')).toBe('cups');
		setPrefs(account({ lang: 'fr' }));
		expect(unitWord('cup', 2, 'en')).toBe('tasses');
		setPrefs(account({ lang: 'en' }));
		expect(unitWord('tbsp', 1, 'fr')).toBe('tbsp');
	});

	it('are the account’s own first, in either number', () => {
		setPrefs(account({ words: { tbsp: ['c. à soupe', 'c. à soupe'], stalk: ['tige', 'tiges'] } }));
		expect(unitWord('tbsp', 1, 'fr')).toBe('c. à soupe');
		expect([unitWord('stalk', 1, 'fr'), unitWord('stalk', 2, 'fr')]).toEqual(['tige', 'tiges']);
		expect(unitWord('cup', 2, 'fr')).toBe('tasses');
	});

	it('join the name the French way only when the word is French', () => {
		const farine = item({ name: 'farine', qty: q(2), unit: 'cup' });
		expect(ingredientText(farine, { lang: 'fr' })).toBe('2 tasses de farine');
		setPrefs(account({ lang: 'en' }));
		expect(ingredientText(farine, { lang: 'fr' })).toBe('2 cups farine');
		setPrefs(account({ lang: 'fr' }));
		expect(ingredientText(item({ name: 'flour', qty: q(2), unit: 'cup' }), { lang: 'en' })).toBe('2 tasses flour');
	});
});

describe('measuring systems', () => {
	it('convert nothing as written, natively measured, or without a factor', () => {
		expect(inSystem([1], 'cup', 'written', CONV)).toBeUndefined();
		expect(inSystem([250], 'ml', 'metric', CONV)).toBeUndefined();
		expect(inSystem([1], 'cup', 'imperial', CONV)).toBeUndefined();
		for (const unit of ['pinch', 'clove', 'stalk', 'can', 'piece'] as const) expect(inSystem([2], unit, 'metric', CONV)).toBeUndefined();
		expect(inSystem([1], 'cup', 'metric', { mass: {}, volume: {} })).toBeUndefined();
		expect(inSystem([1], undefined, 'metric', CONV)).toBeUndefined();
	});

	it('go to millilitres and grams, or to the cup, spoon, pound or ounce that fits', () => {
		expect(inSystem([1, 2], 'cup', 'metric', CONV)).toEqual({ values: [250, 500], unit: 'ml' });
		expect(inSystem([1], 'lb', 'metric', CONV)).toEqual({ values: [453.6], unit: 'g' });
		expect(inSystem([250], 'ml', 'imperial', CONV)).toEqual({ values: [1], unit: 'cup' });
		expect(inSystem([15], 'ml', 'imperial', CONV)).toEqual({ values: [1], unit: 'tbsp' });
		expect(inSystem([5], 'ml', 'imperial', CONV)).toEqual({ values: [1], unit: 'tsp' });
		expect(inSystem([1], 'l', 'imperial', CONV)).toEqual({ values: [4], unit: 'cup' });
		expect(inSystem([1], 'kg', 'imperial', CONV)!.unit).toBe('lb');
		expect(inSystem([100], 'g', 'imperial', CONV)!.unit).toBe('oz');
	});

	it('show on an ingredient line, rounded as a scaled amount is', () => {
		setConversions(CONV);
		const opts = { lang: 'fr' as const, rules: RULES };
		const lait = item({ name: 'lait', qty: q(1.5), unit: 'cup' });
		const beurre = item({ name: 'beurre', qty: q(1), unit: 'lb' });
		expect(ingredientText(lait, opts)).toBe('1 ½ tasse de lait');
		setPrefs(account({ system: 'metric' }));
		expect(ingredientText(lait, opts)).toBe('375 ml de lait');
		expect(ingredientText(beurre, opts)).toBe('455 g de beurre');
		expect(ingredientText(item({ name: 'sel', qty: q(1), unit: 'tsp' }), opts)).toBe('5 ml de sel');
		expect(ingredientText(item({ name: 'bouillon', qty: q(1), unit: 'qt' }), opts)).toMatch(/^(≈ )?1[ ,\d]*(ml|L) de bouillon$/);
		// Scaled and converted at once.
		expect(ingredientText(lait, { ...opts, factor: 2 })).toBe('750 ml de lait');
		// Never the form, nor the amount a tap scales against.
		expect(formatAmount(lait, { ...opts, asWritten: true })).toBe('1 ½ tasse');

		setPrefs(account({ system: 'imperial' }));
		expect(ingredientText(lait, opts)).toBe('1 ½ tasse de lait');
		expect(ingredientText(item({ name: 'lait', qty: q(125), unit: 'ml' }), opts)).toBe('½ tasse de lait');
		expect(ingredientText(item({ name: 'vanille', qty: q(5), unit: 'ml' }), opts)).toBe('1 c. à thé de vanille');
		expect(ingredientText(item({ name: 'beurre', qty: q(454), unit: 'g' }), opts)).toBe('1 lb de beurre');
	});

	it('show without rules as a short decimal', () => {
		setConversions(CONV);
		setPrefs(account({ system: 'metric' }));
		expect(ingredientText(item({ name: 'beurre', qty: q(1), unit: 'lb' }), { lang: 'fr' })).toBe('454 g de beurre');
	});

	it('leave counted amounts, adding the weight when the ingredient’s entry gives it', () => {
		setConversions(CONV);
		const celeri = item({ name: 'céleri', qty: q(2), unit: 'stalk' });
		const opts = { lang: 'fr' as const, rules: RULES };
		setPrefs(account({ system: 'metric' }));
		expect(ingredientText(celeri, opts)).toBe('2 branches de céleri');
		expect(ingredientText(celeri, { ...opts, gramsPerUnit: 40 })).toBe('2 branches (≈ 80 g) de céleri');
		expect(ingredientText(celeri, { ...opts, gramsPerUnit: 40, factor: 2 })).toBe('4 branches (≈ 160 g) de céleri');
		setPrefs(account({ system: 'imperial' }));
		expect(ingredientText(celeri, { ...opts, gramsPerUnit: 40 })).toMatch(/^2 branches \(≈ [\d ½¼¾⅓⅔⅛,]+ oz\) de céleri$/);
		// As written: the card, nothing added.
		setPrefs(account());
		expect(ingredientText(celeri, { ...opts, gramsPerUnit: 40 })).toBe('2 branches de céleri');
	});

	it('put first the card’s own measure in the account’s system', () => {
		setConversions(CONV);
		const lait = item({ name: 'lait', qty: q(1), unit: 'cup', alt: { qty: q(250), unit: 'ml' } });
		const opts = { lang: 'fr' as const, rules: RULES };
		expect(ingredientText(lait, opts)).toBe('1 tasse (250 ml) de lait');
		setPrefs(account({ system: 'metric' }));
		expect(ingredientText(lait, opts)).toBe('250 ml (1 tasse) de lait');
		setPrefs(account({ system: 'imperial' }));
		expect(ingredientText(lait, opts)).toBe('1 tasse (250 ml) de lait');
	});
});
