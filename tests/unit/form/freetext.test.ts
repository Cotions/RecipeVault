// « Texte libre » (usability pass, round 1): a recipe whose steps sit under no
// heading (W401) or under a heading the format does not know keeps that text
// through the form — the form always has a Préparation, the text is shown as
// free text and written back as it was; « Ranger ces N lignes dans
// Préparation » turns its step lines into steps. Invented recipes only.

import { describe, expect, it } from 'vitest';
import { ensureSection, formText, freeStepsToMethod, toForm, type FormRecipe, type MethodSection } from '../../../src/lib/form/model';
import { preambleSteps } from '../../../src/lib/form/steps';
import { checkFile } from '../../../src/lib/vault/check';

const head = `---
schema: 3
title: Galettes inventées de tante Odile
lang: fr
source: { type: invented }
servings: 12
ingredients:
  - items:
      - { qty: 2, unit: cup, name: farine }
      - { qty: 1, unit: cup, name: mélasse }
---
`;
const BARE = `${head}\nRecette de la boîte bleue.\n\n- Mélanger la farine et la mélasse.\n- Cuire 10 min à 375 °F.\n`;
const OTHER = `${head}\n## Préparation\n\n1. Mélanger.\n\n## Conseils de la tante\n\nDoubler la recette pour les Fêtes.\n`;

/** The form as RecipeForm prepares it: Préparation and the text sections always there. */
function opened(text: string): FormRecipe {
	const file = checkFile(text);
	expect(file.recipe && file.body).toBeTruthy();
	const form = toForm(file.recipe!, file.body!);
	ensureSection(form, 'method');
	for (const k of ['notes', 'variants', 'alternatives'] as const) ensureSection(form, k);
	return form;
}

describe('free text in the form', () => {
	it('bare steps under no heading: W401, kept as the preamble, the form still has a Préparation', () => {
		expect(checkFile(BARE).diagnostics.map((d) => d.code)).toContain('W401');
		const form = opened(BARE);
		expect(form.preamble).toContain('- Mélanger la farine et la mélasse.');
		expect(form.sections.filter((s) => s.kind === 'method')).toHaveLength(1);
	});

	it('saving such a recipe from the form, the title changed, keeps every line of that text', () => {
		const form = opened(BARE);
		form.title = 'Galettes inventées de tante Odile (boîte bleue)';
		const out = formText(form);
		expect(out).toContain('Recette de la boîte bleue.\n\n- Mélanger la farine et la mélasse.\n- Cuire 10 min à 375 °F.');
		// The empty Préparation the form added is not written.
		expect(out).not.toContain('## Préparation');
	});

	it('unchanged, it serializes as the file did', () => {
		const file = checkFile(BARE);
		expect(formText(opened(BARE))).toBe(formText(toForm(file.recipe!, file.body!)));
	});

	it('the free text edited by hand is written as she typed it', () => {
		const form = opened(BARE);
		form.preamble = form.preamble.replace('10 min', '12 min');
		expect(formText(form)).toContain('- Cuire 12 min à 375 °F.');
	});

	it('« Ranger ces 2 lignes dans Préparation »: the step lines become steps, the prose before them stays', () => {
		expect(preambleSteps('Recette de la boîte bleue.\n\n- Un.\n- Deux.')).toMatchObject({ keep: 'Recette de la boîte bleue.', steps: 2 });
		expect(preambleSteps('Juste une phrase.')).toBeNull();
		const form = opened(BARE);
		expect(freeStepsToMethod(form)).toBe(2);
		const method = form.sections.find((s) => s.kind === 'method') as MethodSection;
		expect(method.rows.map((r) => r.text)).toEqual(['Mélanger la farine et la mélasse.', 'Cuire 10 min à 375 °F.']);
		const out = formText(form);
		expect(out).toContain('Recette de la boîte bleue.\n\n## Préparation\n\n1. Mélanger la farine et la mélasse.\n2. Cuire 10 min à 375 °F.');
		expect(checkFile(out).diagnostics.map((d) => d.code)).not.toContain('W401');
		expect(checkFile(out).body!.steps).toHaveLength(2);
	});

	it('a section the format does not know keeps its heading and its text, edited or not', () => {
		const form = opened(OTHER);
		expect(formText(form)).toContain('## Conseils de la tante\n\nDoubler la recette pour les Fêtes.');
		const other = form.sections.find((s) => s.kind === 'other');
		if (other?.kind !== 'other') throw new Error('no other section');
		other.text = 'Tripler la recette pour les Fêtes.';
		expect(formText(form)).toContain('## Conseils de la tante\n\nTripler la recette pour les Fêtes.');
	});
});
