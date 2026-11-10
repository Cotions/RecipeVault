// A bare count's name in the form its number needs, when the registry entry
// names it (docs/DATA-FLOW.md, "Names"), and what « Autre quantité » asks for
// (render/target.ts). Invented names only.

import { describe, expect, it } from 'vitest';
import { ingredientText, nameFor, nameForms } from '../../src/lib/render/ingredient';
import { textYieldCount } from '../../src/lib/render/scale';
import { scaleTarget } from '../../src/lib/render/target';
import { parseQuantity } from '../../src/lib/vault/quantity';
import type { Ingredient } from '../../src/lib/vault/types';

const FR = { suffixes: ['x', 's'], minLength: 4 };
const q = (raw: number | string) => {
	const p = parseQuantity(raw);
	if (!p.ok) throw new Error(`bad qty ${raw}`);
	return { raw, value: p.value };
};

describe('nameForms', () => {
	it('takes the plural from an entry name, in the line’s own spelling', () => {
		expect(nameForms('oeuf', ['œuf', 'œufs', 'jaune d’œuf'], FR)).toEqual({ one: 'oeuf', other: 'oeufs' });
		expect(nameForms('Oeuf', ['œufs'], FR)).toEqual({ one: 'Oeuf', other: 'Oeufs' });
		expect(nameForms('chou-fleur', ['chou-fleur', 'choux-fleurs'], FR)).toBeUndefined();
	});
	it('reads a written plural back to its singular', () => {
		expect(nameForms('bananes', ['banane', 'bananes mûres'], FR)).toEqual({ one: 'banane', other: 'bananes' });
		expect(nameForms('jaunes d’oeufs', ['jaune d’œuf'], FR)).toEqual({ one: 'jaune d’oeuf', other: 'jaunes d’oeufs' });
	});
	it('word for word: every word the same or one suffix apart', () => {
		expect(nameForms('poivron vert', ['poivrons verts'], FR)).toEqual({ one: 'poivron vert', other: 'poivrons verts' });
		expect(nameForms('poivron vert', ['poivrons rouges'], FR)).toBeUndefined();
	});
	it('nothing without a rule, another form or with a marker', () => {
		expect(nameForms('oeuf', ['œufs'], undefined)).toBeUndefined();
		expect(nameForms('oeuf', ['oeuf', 'egg'], FR)).toBeUndefined();
		expect(nameForms('oeuf [?]', ['œufs'], FR)).toBeUndefined();
		// Below the rule's length a suffix is not a plural.
		expect(nameForms('riz', ['rizs'], { suffixes: ['s'], minLength: 5 })).toBeUndefined();
	});
	it('French from 2, English above 1', () => {
		const f = { one: 'oeuf', other: 'oeufs' };
		expect([1, 1.5, 2].map((n) => nameFor(f, n, 'fr'))).toEqual(['oeuf', 'oeuf', 'oeufs']);
		expect([1, 1.5].map((n) => nameFor({ one: 'egg', other: 'eggs' }, n, 'en'))).toEqual(['egg', 'eggs']);
	});
});

describe('a line with its name forms', () => {
	const line = (qty: string, unit: Ingredient['unit'], name: string): Ingredient => ({ qty: q(qty), unit, name }) as Ingredient;
	const forms = { one: 'oeuf', other: 'oeufs' };
	it('a bare count takes the form its scaled number needs', () => {
		expect(ingredientText(line('1', 'piece', 'oeuf'), { lang: 'fr', forms })).toBe('1 oeuf');
		expect(ingredientText(line('1', 'piece', 'oeuf'), { lang: 'fr', forms, factor: 2 })).toBe('2 oeufs');
		expect(ingredientText(line('2', 'piece', 'oeuf'), { lang: 'fr', forms: { one: 'oeuf', other: 'oeufs' } })).toBe('2 oeufs');
		expect(ingredientText(line('2', 'piece', 'oeufs'), { lang: 'fr', forms, factor: 0.5 })).toBe('1 oeuf');
	});
	it('a measured line keeps its name as written', () => {
		expect(ingredientText(line('2', 'cup', 'oeuf'), { lang: 'fr', forms })).toBe('2 tasses d’oeuf');
	});
	it('without forms, as written', () => {
		expect(ingredientText(line('2', 'piece', 'oeuf'), { lang: 'fr' })).toBe('2 oeuf');
	});
});

describe('scaleTarget', () => {
	it('servings first', () => {
		expect(scaleTarget({ servings: 8, yield: '2 tourtières' }, 'fr', 'portions')).toEqual({ base: 8, word: 'portions' });
	});
	it('a text yield with one leading count', () => {
		expect(scaleTarget({ yield: '2 tourtières' }, 'fr', 'portions')).toEqual({ base: 2, word: 'tourtières' });
		expect(scaleTarget({ yield: '2 à 3 douzaines' }, 'fr', 'portions')).toBeNull();
		expect(scaleTarget({ yield: 'une grosse casserole' }, 'fr', 'portions')).toBeNull();
		expect(textYieldCount('1 1/2 douzaine')).toEqual({ value: 1.5, rest: 'douzaine' });
	});
	it('a yield object: its count and its words', () => {
		expect(scaleTarget({ yield: { qty: q(2), unit: 'piece', note: 'abaisses' } }, 'fr', 'portions')).toEqual({ base: 2, word: 'abaisses' });
		expect(scaleTarget({ yield: { qty: q(2), qtyMax: q(3), unit: 'piece', note: 'abaisses' } }, 'fr', 'portions')).toBeNull();
		expect(scaleTarget({}, 'fr', 'portions')).toBeNull();
	});
});
