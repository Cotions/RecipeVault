import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FORM_HINT_CODES } from '../../src/lib/form/hints';
import { afterColon, codeText, explain, FIX_FR, fixerText, formHintText, pasteText, placeHuman, placeOf } from '../../src/lib/i18n/diagnostics';
import { DEFAULT_PREFS, setPrefs } from '../../src/lib/prefs';
import { CODE_FIXERS } from '../../src/lib/vault/codes';
import { parseRecipe } from '../../src/lib/vault/parse';

describe('French explanation per code', () => {
	it('has an entry for every registered code, and none for unknown codes', () => {
		expect(Object.keys(CODE_FIXERS).filter((c) => !codeText[c])).toEqual([]);
		expect(Object.keys(codeText).filter((c) => !(c in CODE_FIXERS))).toEqual([]);
	});

	it('has a French correction hint for every code, without the word frontmatter', () => {
		expect(Object.keys(CODE_FIXERS).filter((c) => !FIX_FR[c])).toEqual([]);
		expect(Object.keys(FIX_FR).filter((c) => !(c in CODE_FIXERS))).toEqual([]);
		for (const [code, text] of Object.entries(FIX_FR)) {
			expect(text, code).not.toMatch(/front ?matter|\b(the|is|must|missing)\b/i);
			expect(text.normalize('NFC'), code).toBe(text);
		}
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
		expect(explain('X999')).toMatch(/détails pour le dépannage/);
		// The unit mapping (tasse → cup) is the checker's, behind « Détails pour le dépannage », not the cook's copy.
		expect(explain('E201')).toMatch(/^Cette unité n’est pas dans la liste/);
		expect(explain('E201')).not.toMatch(/→/);
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

describe('placeHuman: where, as a cook says it', () => {
	const parsed = parseRecipe(FILE);

	it('names the group, the rank and the ingredient, not the field', () => {
		expect(placeHuman('ingredients[0].items[1].unit', parsed)).toBe('Pâte, 2e ingrédient (beurre)');
		expect(placeHuman('ingredients[0].items[0].qty', parsed)).toBe('Pâte, 1er ingrédient (farine)');
		expect(placeHuman('ingredients[0].items[1].or[0].unit', parsed)).toBe('Pâte, 2e ingrédient (beurre), choix 1 (margarine)');
		expect(placeHuman('ingredients[0].items[1].alt.qty', parsed)).toBe('Pâte, 2e ingrédient (beurre), autre mesure');
		// An unnamed group among several: its number; a plain-string entry is its own name.
		expect(placeHuman('ingredients[1].items[1]', parsed)).toBe('Groupe 2, 2e ingrédient (500 g de lait)');
	});

	it('leaves the group out when there is one, unnamed', () => {
		expect(placeHuman('ingredients[0].items[2].unit', { frontmatter: { ingredients: [{ items: [{}, {}, { name: 'eau' }] }] } })).toBe('3e ingrédient (eau)');
	});

	it('falls back to placeOf elsewhere', () => {
		expect(placeHuman('times.cook')).toBe('Temps : cuisson');
		expect(placeHuman(null)).toBeNull();
	});

	it('builds a sentence after it', () => {
		expect(afterColon('Cette unité n’est pas dans la liste.')).toBe('cette unité n’est pas dans la liste.');
		expect(afterColon('L’IA doit le corriger.')).toBe('l’IA doit le corriger.');
		expect(afterColon('IA en tête')).toBe('IA en tête');
		expect(afterColon('« tasse » s’écrit cup')).toBe('« tasse » s’écrit cup');
	});

	it('says an alias unit is written as its code, not unknown', () => {
		// The plain thing first (the unit as she wrote it), then what the file writes; never "inconnue".
		expect(pasteText.unitAlias('tasse', 'cup', 'tasse')).toBe('Unité «\u00a0tasse\u00a0» : écrivez cup ; l’app affichera «\u00a0tasse\u00a0».');
		expect(pasteText.unitAlias('c. à soupe', 'tbsp', 'c. à table')).toBe('Unité «\u00a0c. à soupe\u00a0» : écrivez tbsp ; l’app affichera «\u00a0c. à table\u00a0».');
		expect(pasteText.unitAlias('tasse', 'cup', 'tasse')).not.toMatch(/inconnue/);
		expect(pasteText.newTag('Erable')).toBe('Nouvelle étiquette «\u00a0Erable\u00a0» : gardée telle quelle, elle attendra dans Étiquettes.');
		expect(pasteText.tagAccent('Erable', 'Érable')).toBe('Étiquette «\u00a0Erable\u00a0» inconnue : vouliez-vous «\u00a0Érable\u00a0» ? Sinon, gardez-la : elle attendra dans Étiquettes.');
		expect(pasteText.tagKept('Erable')).toBe('✓ «\u00a0Erable\u00a0» gardée : elle attendra dans Étiquettes.');
	});
});

describe('in English', () => {
	const french = { ...codeText };
	const frenchHints = Object.fromEntries(FORM_HINT_CODES.map((c) => [c, formHintText[c]({ word: 'x', value: 'y', suggestion: 'z' })]));

	beforeEach(() => setPrefs({ ...DEFAULT_PREFS, lang: 'en' }));
	afterEach(() => setPrefs(null));

	it('has an English text for every registered code', () => {
		expect(Object.keys(CODE_FIXERS).filter((c) => !codeText[c] || codeText[c] === french[c])).toEqual([]);
		for (const [code, text] of Object.entries(codeText)) {
			expect(text.length, code).toBeGreaterThan(15);
			expect(text.length, code).toBeLessThan(200);
			expect(text, code).not.toMatch(/[«»]| [:;?!]/);
			expect(text.normalize('NFC'), code).toBe(text);
		}
	});

	it('falls back for an unknown code, and says who settles one', () => {
		expect(explain('X999')).toMatch(/troubleshooting details/);
		expect(explain('E201')).toMatch(/^This unit is not in the list/);
		expect(fixerText.ai).toMatch(/fix request/);
	});

	it('has an English hint for every code the form maps', () => {
		for (const code of FORM_HINT_CODES) {
			const text = formHintText[code]({ word: 'x', value: 'y', suggestion: 'z' });
			expect(text, code).toBeTruthy();
			expect(text, code).not.toBe(frenchHints[code]);
			expect(text, code).not.toMatch(/[«»]/);
		}
	});

	it('says a place in English, with no space before the colon', () => {
		const parsed = parseRecipe(FILE);
		expect(placeOf('ingredients[0].items[3].unit')).toBe('Ingredients, group 1, line 4: unit');
		expect(placeOf('ingredients[0].items[1].or[0].unit', parsed)).toBe('Ingredients, group “Pâte”, line 2 “beurre”, choice 1 “margarine”: unit');
		expect(placeOf('ingredients[0].items[1].alt.qty')).toBe('Ingredients, group 1, line 2, other measure: quantity');
		expect(placeOf('body.steps[4]')).toBe('Method, step 5');
		expect(placeOf('body.sections[1]', parsed)).toBe('Section “Notes”');
		expect(placeOf('source.title')).toBe('Source: title');
		expect(placeOf('season[1]')).toBe('Season, no. 2');
		expect(placeOf('source.editeur')).toBe('Source: field “editeur”');
		expect(placeOf('allergens')).toBe('Field “allergens”');
		expect(placeHuman('ingredients[0].items[1].unit', parsed)).toBe('Pâte, 2nd ingredient (beurre)');
		expect(placeHuman('ingredients[0].items[10].unit', parsed)).toBe('Pâte, 11th ingredient');
		expect(pasteText.unitAlias('tasse', 'cup', 'tasse')).toBe('Unit “tasse”: write cup; the app will show “tasse”.');
	});
});
