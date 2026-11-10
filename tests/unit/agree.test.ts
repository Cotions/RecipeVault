// French agreement of a scaled bare count (docs/DATA-FLOW.md, "Names";
// render/agree.ts, `countWords` in render/ingredient.ts). Invented lines only.

import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { parseScaling } from '../../src/lib/render/scale';
import { seedVocab } from '../../src/lib/server/vault';
import { agreePrepFr, pluralNameFr, pluralWordFr } from '../../src/lib/render/agree';
import { countWords, ingredientText } from '../../src/lib/render/ingredient';
import { parseQuantity } from '../../src/lib/vault/quantity';
import type { Ingredient } from '../../src/lib/vault/types';

const q = (raw: number | string) => {
	const p = parseQuantity(raw);
	if (!p.ok) throw new Error(`bad qty ${raw}`);
	return { raw, value: p.value };
};
const RULES = parseScaling(parse(seedVocab(readFileSync('docs/VOCAB.md', 'utf8'))['scaling.yaml'], { version: '1.2' }))!;
const line = (qty: string, name: string, prep?: string, unit?: Ingredient['unit']): Ingredient => ({ qty: q(qty), unit, name, ...(prep ? { prep } : {}) }) as Ingredient;

describe('pluralWordFr', () => {
	it('adds -s, and leaves -s, -x, -z as they are', () => {
		expect(['navet', 'radis', 'noix', 'riz', 'courgette'].map(pluralWordFr)).toEqual(['navets', 'radis', 'noix', 'riz', 'courgettes']);
	});
	it('-al → -aux, -eau/-eu → +x, the -ou that take x, and their exceptions', () => {
		expect(['bocal', 'régal', 'gâteau', 'cheveu', 'bleu', 'chou', 'clou'].map(pluralWordFr)).toEqual(['bocaux', 'régals', 'gâteaux', 'cheveux', 'bleus', 'choux', 'clous']);
	});
	it('invariable words and compounds', () => {
		expect(['orange', 'maison', 'chou-rave', 'mi-cuit'].map(pluralWordFr)).toEqual(['orange', 'maison', 'choux-raves', 'mi-cuits']);
	});
});

describe('pluralNameFr', () => {
	it('the head noun and its adjectives, up to a preposition', () => {
		expect(pluralNameFr('navet blanc')).toBe('navets blancs');
		expect(pluralNameFr('croûte à quiche')).toBe('croûtes à quiche');
		expect(pluralNameFr('pomme de terre')).toBe('pommes de terre');
		expect(pluralNameFr('jaune d’œuf')).toBe('jaunes d’œuf');
		expect(pluralNameFr('poivron orange')).toBe('poivrons orange');
	});
	it('a capitalised head agrees; a variety after it stays; a marker stops', () => {
		expect(pluralNameFr('Croûte à quiche')).toBe('Croûtes à quiche');
		expect(pluralNameFr('poire Bosc')).toBe('poires Bosc');
		expect(pluralNameFr('navett [?] blanc')).toBe('navetts [?] blanc');
	});
});

describe('agreePrepFr', () => {
	it('a leading participle or adjective agrees', () => {
		expect(agreePrepFr('râpé', true)).toBe('râpés');
		expect(agreePrepFr('écrasée', true)).toBe('écrasées');
		expect(agreePrepFr('finement émincé', true)).toBe('finement émincés');
		expect(agreePrepFr('pelé et tranché', true)).toBe('pelés et tranchés');
		expect(agreePrepFr('cuit', true)).toBe('cuits');
		expect(agreePrepFr('frais', true)).toBe('frais');
	});
	it('never inside what follows a preposition, nor past a word it cannot read', () => {
		expect(agreePrepFr('en cubes', true)).toBe('en cubes');
		expect(agreePrepFr('au goût', true)).toBe('au goût');
		expect(agreePrepFr('coupé en rondelles', true)).toBe('coupés en rondelles');
		expect(agreePrepFr('râpé, égoutté', true)).toBe('râpés, égoutté');
		expect(agreePrepFr('lavé pour la soupe', true)).toBe('lavés pour la soupe');
	});
	it('back to the singular', () => {
		expect(agreePrepFr('râpés', false)).toBe('râpé');
		expect(agreePrepFr('écrasées', false)).toBe('écrasée');
		expect(agreePrepFr('frais', false)).toBe('frais');
	});
});

describe('countWords', () => {
	it('French plural from 2: 1 ½ stays singular', () => {
		const it_ = { name: 'navet', prep: 'râpé' };
		expect(countWords(it_, 1.5, { lang: 'fr', factor: 1.5 })).toEqual({ name: 'navet', prep: 'râpé' });
		expect(countWords(it_, 2, { lang: 'fr', factor: 2 })).toEqual({ name: 'navets', prep: 'râpés' });
	});
	it('at × 1 without a registry form, as written', () => {
		expect(countWords({ name: 'navet', prep: 'râpé' }, 2, { lang: 'fr' })).toEqual({ name: 'navet', prep: 'râpé' });
	});
	it('the registry form first, the prep agreeing with it', () => {
		const forms = { one: 'navet', other: 'navets' };
		expect(countWords({ name: 'navets', prep: 'râpés' }, 1, { lang: 'fr', factor: 0.5, forms })).toEqual({ name: 'navet', prep: 'râpé' });
		expect(countWords({ name: 'navet', prep: 'râpé' }, 3, { lang: 'fr', factor: 3, forms })).toEqual({ name: 'navets', prep: 'râpés' });
	});
	it('a name already plural, its prep not: scaled, the prep agrees', () => {
		expect(countWords({ name: 'navets', prep: 'écrasée' }, 4, { lang: 'fr', factor: 2 })).toEqual({ name: 'navets', prep: 'écrasées' });
	});
	it('English: only the registry form', () => {
		expect(countWords({ name: 'turnip', prep: 'grated' }, 4, { lang: 'en', factor: 2 })).toEqual({ name: 'turnip', prep: 'grated' });
	});
});

describe('a scaled line reads in agreement', () => {
	it('bare counts', () => {
		expect(ingredientText(line('1', 'navet', 'râpé'), { lang: 'fr', factor: 2.5 })).toBe('2 ½ navets râpés (prévoir 3)');
		expect(ingredientText(line('1', 'poivron jaune', 'en lanières', 'piece'), { lang: 'fr', factor: 2.5 })).toBe('2 ½ poivrons jaunes en lanières (prévoir 3)');
		expect(ingredientText(line('1', 'croûte à quiche'), { lang: 'fr', factor: 4 })).toBe('4 croûtes à quiche');
		expect(ingredientText(line('1', 'navet', 'râpé'), { lang: 'fr', factor: 1.5 })).toBe('1 ½ navet râpé (prévoir 2)');
	});
	// Usability round 3 (plan 05, "Halves of whole things"): a half of a whole thing says how to have it.
	it('a half of a whole thing: an egg says how to measure it, anything else how many to have', () => {
		expect(ingredientText(line('1', 'oeuf'), { lang: 'fr', factor: 1.5 })).toBe('1 ½ oeuf (1 œuf + 1 jaune)');
		expect(ingredientText(line('2', 'œufs'), { lang: 'fr', factor: 1.25 })).toBe('2 ½ œufs (2 œufs + 1 jaune)');
		expect(ingredientText(line('1', 'oeuf'), { lang: 'fr', factor: 0.5 })).toBe('½ oeuf (1 jaune)');
		expect(ingredientText(line('1', 'egg'), { lang: 'en', factor: 1.5 })).toBe('1 ½ egg (1 egg + 1 yolk)');
		expect(ingredientText(line('2', 'abaisse'), { lang: 'fr', factor: 1.25 })).toBe('2 ½ abaisses (prévoir 3)');
		// The card's own half, a whole number, a measured amount: no help.
		expect(ingredientText(line('1 1/2', 'oeuf'), { lang: 'fr', factor: 1 })).toBe('1 ½ oeuf');
		expect(ingredientText(line('2', 'abaisse'), { lang: 'fr', factor: 1.5 })).toBe('3 abaisses');
		expect(ingredientText(line('1', 'beurre', undefined, 'cup'), { lang: 'fr', factor: 1.5 })).toBe('1 ½ tasse de beurre');
	});
	it('a whole thing halfway between two values takes the larger: the same at every amount', () => {
		// 2 crusts at 9 portions for 8 (2 ¼) and at 10 (2 ½): both 2 ½, the first marked.
		expect(ingredientText(line('2', 'abaisse'), { lang: 'fr', factor: 9 / 8, rules: RULES })).toBe('≈ 2 ½ abaisses (prévoir 3)');
		expect(ingredientText(line('2', 'abaisse'), { lang: 'fr', factor: 10 / 8, rules: RULES })).toBe('2 ½ abaisses (prévoir 3)');
		// 2 ¾ goes up too: a whole number, no help.
		expect(ingredientText(line('2', 'abaisse'), { lang: 'fr', factor: 11 / 8, rules: RULES })).toBe('≈ 3 abaisses');
	});
	it('a measured line keeps its words', () => {
		expect(ingredientText(line('1', 'navet', 'râpé', 'cup'), { lang: 'fr', factor: 2 })).toBe('2 tasses de navet râpé');
	});
});

describe('a note that counts what the line makes (usability round 4)', () => {
	const crust = (qty: string, note: string): Ingredient => ({ ...line(qty, 'abaisse'), note }) as Ingredient;
	it('scales with the line, and shares one parenthetical with the help', () => {
		expect(ingredientText(crust('2', 'pour 1 tarte'), { lang: 'fr', factor: 2 })).toBe('4 abaisses (pour 2 tartes)');
		expect(ingredientText(crust('4', 'pour 2 tartes'), { lang: 'fr', factor: 1.375 })).toBe('5 ½ abaisses (prévoir 6 · pour ≈ 3 tartes)');
		expect(ingredientText({ ...line('4', 'abaisses'), note: 'pour 2 tartes' } as Ingredient, { lang: 'fr', factor: 1 })).toBe('4 abaisses (pour 2 tartes)');
	});
	it('any other note stays as written', () => {
		expect(ingredientText(crust('2', 'boîte de 796 ml'), { lang: 'fr', factor: 2 })).toBe('4 abaisses (boîte de 796 ml)');
	});
});
