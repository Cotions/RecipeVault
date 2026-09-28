import { describe, expect, it } from 'vitest';
import { codeText, explain, placeOf } from '../../src/lib/i18n/diagnostics';
import { CODE_FIXERS } from '../../src/lib/vault/codes';
import { parseRecipe } from '../../src/lib/vault/parse';

describe('French explanation per code', () => {
	it('has an entry for every registered code, and none for unknown codes', () => {
		expect(Object.keys(CODE_FIXERS).filter((c) => !codeText[c])).toEqual([]);
		expect(Object.keys(codeText).filter((c) => !(c in CODE_FIXERS))).toEqual([]);
	});

	it('entries are short plain French, not the English message', () => {
		for (const [code, text] of Object.entries(codeText)) {
			expect(text.length, code).toBeGreaterThan(15);
			expect(text.length, code).toBeLessThan(200);
			expect(text, code).not.toMatch(/\b(the|is|must|missing)\b/);
			expect(text.normalize('NFC'), code).toBe(text);
		}
	});

	it('falls back for an unknown code', () => {
		expect(explain('X999')).toMatch(/détail technique/);
		expect(explain('E201')).toMatch(/tasse → cup/);
	});
});

const FILE = `---
schema: 3
title: Tarte inventée
tags: [dessert, desertt]
ingredients:
  - group: Pâte
    items:
      - { qty: 1, unit: cup, name: farine }
      - { qty: 2, unit: tasse, name: beurre, or: [{ qty: 1, unit: cup, name: margarine }] }
  - items:
      - { name: sel }
      - "500 g de lait"
---

Intro.

## Préparation

1. Mélanger.

## Notes

Rien.
`;

describe('placeOf', () => {
	const parsed = parseRecipe(FILE);

	it('says nothing for a whole-file diagnostic', () => {
		expect(placeOf(null)).toBeNull();
		expect(placeOf('')).toBeNull();
	});

	it('uses positions when the file gives no names', () => {
		expect(placeOf('ingredients[0].items[3].unit')).toBe('Ingrédients, groupe 1, ligne 4 : unité');
		expect(placeOf('ingredients[1].items[2].or[0].unit')).toBe('Ingrédients, groupe 2, ligne 3, choix 1 : unité');
		expect(placeOf('ingredients[0].items[1].alt')).toBe('Ingrédients, groupe 1, ligne 2 : autre mesure');
		expect(placeOf('ingredients[0].items[1].alt.qty')).toBe('Ingrédients, groupe 1, ligne 2, autre mesure : quantité');
		expect(placeOf('ingredients[1].items')).toBe('Ingrédients, groupe 2 : liste');
		expect(placeOf('ingredients[1]')).toBe('Ingrédients, groupe 2');
		expect(placeOf('ingredients')).toBe('Ingrédients');
		expect(placeOf('body.sections[2]')).toBe('Méthode, section 3');
		expect(placeOf('body.steps[4]')).toBe('Méthode, étape 5');
		expect(placeOf('body.preamble')).toBe('Texte avant le premier titre');
	});

	it('uses group, ingredient and section names from the parsed file', () => {
		expect(placeOf('ingredients[0].items[1].unit', parsed)).toBe('Ingrédients, groupe « Pâte », ligne 2 « beurre » : unité');
		expect(placeOf('ingredients[0].items[1].or[0].unit', parsed)).toBe(
			'Ingrédients, groupe « Pâte », ligne 2 « beurre », choix 1 « margarine » : unité'
		);
		expect(placeOf('ingredients[1].items[0].to_taste', parsed)).toBe('Ingrédients, groupe 2, ligne 1 « sel » : au goût');
		// A plain-string entry (E207): the string itself names it.
		expect(placeOf('ingredients[1].items[1]', parsed)).toBe('Ingrédients, groupe 2, ligne 2 « 500 g de lait »');
		expect(placeOf('body.sections[1]', parsed)).toBe('Section « Notes »');
		// Out of range: back to positions.
		expect(placeOf('ingredients[5].items[9].name', parsed)).toBe('Ingrédients, groupe 6, ligne 10 : nom');
	});

	it('names frontmatter fields', () => {
		expect(placeOf('title')).toBe('Titre');
		expect(placeOf('times.cook')).toBe('Temps : cuisson');
		expect(placeOf('oven.temp_max')).toBe('Four : température maximale');
		expect(placeOf('source.url')).toBe('Provenance : adresse web');
		expect(placeOf('source.title')).toBe('Provenance : titre');
		expect(placeOf('servings_max')).toBe('Portions (maximum)');
		expect(placeOf('media.final')).toBe('Photos : photo du plat');
		expect(placeOf('tags[1]', parsed)).toBe('Étiquettes « desertt »');
		expect(placeOf('season[1]')).toBe('Saison, n° 2');
	});

	it('shows unknown keys as written (W610)', () => {
		expect(placeOf('allergens')).toBe('Champ « allergens »');
		expect(placeOf('source.editeur')).toBe('Provenance : champ « editeur »');
		expect(placeOf('ingredients[0].items[0].quantite', parsed)).toBe('Ingrédients, groupe « Pâte », ligne 1 « farine » : champ « quantite »');
	});

	it('shortens long names', () => {
		const long = 'x'.repeat(60);
		expect(placeOf('ingredients[0].items[0].name', { frontmatter: { ingredients: [{ items: [{ name: long }] }] } })).toBe(
			`Ingrédients, groupe 1, ligne 1 « ${'x'.repeat(39)}… » : nom`
		);
	});
});
