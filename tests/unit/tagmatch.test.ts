// Which known tag /etiquettes preselects for a pending tag (docs/VOCAB.md,
// "Tags"): the same word but for its ending, or a typo of a non-food word.
// Invented tags only.

import { describe, expect, it } from 'vitest';
import { preselectTag, sameStem, typoOf, withAccents } from '../../src/lib/vault/tagmatch';

const TAGS = new Map([
	['tarte', 'tarte'],
	['tartes', 'tarte'],
	['plat principal', 'plat-principal'],
	['main', 'plat-principal'],
	['dessert', 'dessert'],
	['soupe', 'soupe'],
	['legume', 'legumes'],
	['legumes', 'legumes']
]);

describe('sameStem and typoOf', () => {
	it('reads plurals, feminines and accents as the same word, word by word', () => {
		expect(sameStem('soupes', 'soupe')).toBe(true);
		expect(sameStem('Légume', 'legumes')).toBe(true);
		expect(sameStem('plats principaux', 'plat principal')).toBe(false);
		expect(sameStem('carrés', 'tartes')).toBe(false);
	});

	it('a typo: five letters or more, the first letter kept, one edit (two from eight)', () => {
		expect(typoOf('desert', 'dessert')).toBe(true);
		expect(typoOf('pain', 'main')).toBe(false);
		expect(typoOf('carrés', 'tartes')).toBe(false);
		expect(typoOf('dejeuner', 'dejeunre')).toBe(true);
	});
});

describe('preselectTag', () => {
	it('preselects the same word, or a typo; nothing for a word merely near', () => {
		expect(preselectTag(TAGS, 'soupes')).toBe('soupe');
		expect(preselectTag(TAGS, 'tarte')).toBe('tarte');
		expect(preselectTag(TAGS, 'desert')).toBe('dessert');
		expect(preselectTag(TAGS, 'carrés')).toBeUndefined();
		expect(preselectTag(TAGS, 'pain')).toBeUndefined();
	});

	it('a food word takes the same word only, never a typo (another food, not a course)', () => {
		expect(preselectTag(TAGS, 'desert', { food: true })).toBeUndefined();
		expect(preselectTag(TAGS, 'légume', { food: true })).toBe('legumes');
	});
});

describe('withAccents', () => {
	it('gives a tag the accents the recipe writes the word with, in its case', () => {
		expect(withAccents('erable', 'Pouding inventé : 1 tasse de sirop d’érable')).toBe('érable');
		expect(withAccents('Erable', 'sirop d’érable')).toBe('Érable');
		expect(withAccents('soiree cinema', 'Soirée cinéma entre amis')).toBe('soirée cinéma');
	});

	it('takes the most used accented form', () => {
		expect(withAccents('pate', 'pâte, pâte, pâté')).toBe('pâte');
	});

	it('is undefined when nothing gains an accent', () => {
		expect(withAccents('érable', 'sirop d’érable')).toBeUndefined();
		expect(withAccents('biscuits', 'Biscuits à la citrouille')).toBeUndefined();
	});
});
