// Plan 05, Phase 4: amounts written in steps (Q6 B) and sub-recipes read at the
// amount a line needs (Q5 A). Invented text only.

import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { parseScaling, subRecipeHref, subRecipeScale, type SubScaleRecipe } from '../../src/lib/render/scale';
import { stepAmounts } from '../../src/lib/render/stepamounts';
import { renderInline, renderMarkdown } from '../../src/lib/render/markdown';
import { parseConversions } from '../../src/lib/ingredients/units';
import { seedVocab } from '../../src/lib/server/vault';
import type { Ingredient, Lang } from '../../src/lib/vault/types';

const SEED = seedVocab(readFileSync('docs/VOCAB.md', 'utf8'));
const RULES = parseScaling(parse(SEED['scaling.yaml'], { version: '1.2' }))!;
const CONV = parseConversions(parse(SEED['conversions.yaml'], { version: '1.2' }));

const found = (text: string, factor: number, lang: Lang = 'fr') => stepAmounts(text, { factor, lang, rules: RULES }).map((a) => `${a.text} → ${a.scaled}`);

describe('step amounts (Q6 B)', () => {
	it('finds measures in French steps and scales them with the vault’s words', () => {
		expect(found('Ajouter 1 tasse de lait chaud.', 2)).toEqual(['1 tasse → 2 tasses']);
		expect(found('Ajouter 1 t. de lait.', 2)).toEqual(['1 t. → 2 tasses']);
		expect(found('Incorporer 1 ½ tasse de farine et 2 c. à table de beurre.', 0.5)).toEqual(['1 ½ tasse → ¾ tasse', '2 c. à table → 1 c. à table']);
		expect(found('Ajouter 1-1/2 lb de bœuf.', 2)).toEqual(['1-1/2 lb → 3 lb']);
		expect(found('Verser 250 ml de bouillon.', 4 / 3)).toEqual(['250 ml → 335 ml']);
	});

	it('reads t / T by the recipe’s language', () => {
		expect(found('Add 1 T sugar and 1 t salt.', 2, 'en')).toEqual(['1 T → 2 tbsp', '1 t → 2 tsp']);
		// French T is no unit the doc settles: nothing is guessed.
		expect(found('Ajouter 1 T de sucre.', 2, 'fr')).toEqual([]);
		expect(found('Add 1 t. milk.', 2, 'en')).toEqual([]);
	});

	it('scales a range as one amount', () => {
		expect(found('Ajouter 2 à 3 tasses de bouillon.', 2)).toEqual(['2 à 3 tasses → 4 à 6 tasses']);
		expect(found('Add 2-3 cups broth.', 2, 'en')).toEqual(['2-3 cups → 4–6 cups']);
	});

	it('never reads a step or item number as the low end of a range (#13)', () => {
		expect(found('Étape 1 - 2 tasses de farine.', 2)).toEqual(['2 tasses → 4 tasses']);
		expect(found('étape 2 – 3 tasses de lait.', 2)).toEqual(['3 tasses → 6 tasses']);
		expect(found('ÉTAPE 1 - 2 tasses de farine.', 2)).toEqual(['2 tasses → 4 tasses']);
		expect(found('Etape 1 - 2 tasses de farine.', 2)).toEqual(['2 tasses → 4 tasses']);
		expect(found('Step 1 - 2 cups flour.', 2, 'en')).toEqual(['2 cups → 4 cups']);
		expect(found('Steps 1-2 cups flour.', 2, 'en')).toEqual(['2 cups → 4 cups']);
		expect(found('Mélange n° 1 - 2 tasses de farine.', 2)).toEqual(['2 tasses → 4 tasses']);
		expect(found('Mix no. 1 - 2 cups flour.', 2, 'en')).toEqual(['2 cups → 4 cups']);
		expect(found('Numéro 1 à 2 tasses.', 2)).toEqual(['2 tasses → 4 tasses']);
		expect(found('#1 - 2 cups flour.', 2, 'en')).toEqual(['2 cups → 4 cups']);
		// A real range, spaced dash or not, still reads as one; a word merely ending like a label does not count.
		expect(found('Ajouter 2 - 3 tasses de farine.', 2)).toEqual(['2 - 3 tasses → 4 à 6 tasses']);
		expect(found('1 - 2 tasses de farine.', 2)).toEqual(['1 - 2 tasses → 2 à 4 tasses']);
		expect(found('Ajouter 1 - 2 tasses, étape suivante.', 2)).toEqual(['1 - 2 tasses → 2 à 4 tasses']);
		expect(found('Add a cupcakestep 1 - 2 cups.', 2, 'en')).toEqual(['1 - 2 cups → 2–4 cups']);
		expect(found('Casino 1 - 2 tasses.', 2)).toEqual(['1 - 2 tasses → 2 à 4 tasses']);
	});

	it('never touches temperatures, durations, pan sizes or counts', () => {
		expect(found('Cuire à 350 °F pendant 25 min dans un moule de 9 x 13 po.', 2)).toEqual([]);
		expect(found('Bake at 180 °C for 1 h 30 in a 9 x 13 inch pan.', 2, 'en')).toEqual([]);
		expect(found('Couper en 8 tranches, ajouter 2 gousses d’ail et 1 boîte de tomates.', 2)).toEqual([]);
	});

	it('flags a bowl’s size as an amount — shown beside the original, never replacing it', () => {
		expect(found('Mélanger dans un bol de 2 L.', 2)).toEqual(['2 L → 4 L']);
		const html = renderInline('Mélanger dans un bol de 2 L.', { scale: { factor: 2, lang: 'fr', rules: RULES, title: 'x' } });
		expect(html).toBe('Mélanger dans un bol de 2 L<span class="step-scaled" title="x"> → 4 L</span>.');
	});

	it('never reads a spoon abbreviation, « à la fois » or an elision as cups or litres (review)', () => {
		// Card spellings of the spoons are aliases (owner, 2026-09-30): read as spoons, never cups.
		expect(found('Ajouter 1 c. à t. de sel.', 2)).toEqual(['1 c. à t. → 2 c. à thé']);
		expect(found('Ajouter 1 c. thé de sel.', 2)).toEqual(['1 c. thé → 2 c. à thé']);
		expect(found('Ajouter 1 c. table de beurre.', 2)).toEqual(['1 c. table → 2 c. à table']);
		expect(found('Ajouter 1 c. soupe de beurre.', 2)).toEqual(['1 c. soupe → 2 c. à table']);
		expect(found('Ajouter 1 c. à s. de beurre.', 2)).toEqual(['1 c. à s. → 2 c. à table']);
		expect(found('Ajouter 1 c.à t. de sel.', 2)).toEqual(['1 c.à t. → 2 c. à thé']);
		expect(found('Ajouter 1 t. à thé de sel.', 2)).toEqual([]);
		expect(found('Cuire 2 c. à la fois.', 2)).toEqual([]);
		expect(found("Diviser en 2 l'une sur l'autre.", 2)).toEqual([]);
		expect(found('Diviser en 2 l’une sur l’autre.', 2)).toEqual([]);
		// The cup and the listed spoons still read.
		expect(found('Ajouter 2 c. de farine et 1 c. à thé de sel.', 2)).toEqual(['2 c. → 4 tasses', '1 c. à thé → 2 c. à thé']);
		expect(found('Verser 1 l de lait.', 2)).toEqual(['1 l → 2 L']);
		expect(found('Add 1 t salt.', 2, 'en')).toEqual(['1 t → 2 tsp']);
	});

	it('never reads a temperature in C. as cups (review)', () => {
		expect(found('Cuire au four à 180 C.', 2)).toEqual([]);
		expect(found('Bake at 200 C. for 20 min.', 2, 'en')).toEqual([]);
		expect(found('Cuire au four à 350 F.', 2)).toEqual([]);
	});

	it('reads a trailing fraction with its whole number (review)', () => {
		expect(found('Ajouter 1 tasse 1/2 de lait.', 2)).toEqual(['1 tasse 1/2 → 3 tasses']);
		expect(found('Ajouter 1 c. à thé 1/2 de sel.', 2)).toEqual(['1 c. à thé 1/2 → 1 c. à table']);
		expect(found('Ajouter 1 tasse ½ de lait.', 2)).toEqual(['1 tasse ½ → 3 tasses']);
		// A fraction that starts its own amount stays its own.
		expect(found('Ajouter 1 tasse 1/2 c. à thé de sel.', 2)).toEqual(['1 tasse → 2 tasses', '1/2 c. à thé → 1 c. à thé']);
		const html = renderInline('Ajouter 1 tasse 1/2 de lait.', { scale: { factor: 2, lang: 'fr', rules: RULES, title: 'x' } });
		expect(html).toBe('Ajouter 1 tasse 1/2<span class="step-scaled" title="x"> → 3 tasses</span> de lait.');
	});

	it('reads 1-1/2 as a mixed number, not the low end of a range (review)', () => {
		expect(found('Ajouter 1-1/2 à 2 tasses de lait.', 2)).toEqual(['1-1/2 à 2 tasses → 3 à 4 tasses']);
		expect(found('Ajouter 1-1/2 tasse de lait.', 2)).toEqual(['1-1/2 tasse → 3 tasses']);
	});

	it('shows nothing at factor 1', () => {
		expect(found('Ajouter 1 tasse de lait.', 1)).toEqual([]);
		const md = '## Préparation\n\n1. Ajouter 1 tasse de lait **chaud** [?].\n';
		expect(renderMarkdown(md, { scale: { factor: 1, lang: 'fr', rules: RULES, title: 'x' } })).toBe(renderMarkdown(md));
	});

	it('marks only the steps of the method, the markers and emphasis kept', () => {
		const md = '## Préparation\n\n1. Ajouter 1 tasse de lait **chaud** [?].\n\n## Notes\n\n1 tasse suffit.\n';
		const html = renderMarkdown(md, { scale: { factor: 2, lang: 'fr', rules: RULES, title: 'Recette × 2' } });
		expect(html).toContain('Ajouter 1 tasse<span class="step-scaled" title="Recette × 2"> → 2 tasses</span> de lait <strong>chaud</strong> <mark class="mk mk-uncertain"');
		expect(html).toContain('<p>1 tasse suffit.</p>');
	});

	it('escapes what it adds', () => {
		expect(renderInline('Ajouter 1 tasse.', { scale: { factor: 2, lang: 'fr', rules: RULES, title: '<b>"' } })).toContain('title="&lt;b&gt;&quot;"');
	});

	it('scans a 30-step recipe in under 1 ms a step', () => {
		const steps = Array.from({ length: 30 }, (_, i) => `Ajouter ${i + 1} tasses de lait, 2 c. à table de beurre et cuire ${i + 5} min à 350 °F.`);
		const t0 = performance.now();
		for (let k = 0; k < 10; k++) for (const s of steps) stepAmounts(s, { factor: 1.5, lang: 'fr', rules: RULES });
		const ms = (performance.now() - t0) / 10;
		console.log(`step amounts: 30 steps in ${ms.toFixed(2)} ms`);
		expect(ms).toBeLessThan(30);
	});
});

describe('sub-recipes (Q5 A)', () => {
	const pastry: SubScaleRecipe = { slug: 'pate-brisee', yield: { qty: { raw: 2, value: 2 }, unit: 'piece', note: 'abaisses' } };
	const crust = (n: number): Ingredient => ({ qty: { raw: n, value: n }, unit: 'piece', name: 'pâte brisée', recipe: 'pate-brisee' });

	it('scales by line amount × factor / yield — one crust of two is the half pastry, at ×1 already', () => {
		expect(subRecipeScale(crust(1), pastry, CONV, 1, RULES)).toBe(0.5);
		expect(subRecipeScale(crust(1), pastry, CONV, 2, RULES)).toBe(1);
		expect(subRecipeScale(crust(2), pastry, CONV, 3, RULES)).toBe(3);
		expect(subRecipeHref(crust(1), pastry, CONV, 1, RULES)).toBe('/r/pate-brisee?fois=0.5');
		expect(subRecipeHref(crust(1), pastry, CONV, 2, RULES)).toBe('/r/pate-brisee');
	});

	it('converts within a class: 1 cup of a sauce that makes 1 L', () => {
		const sauce: SubScaleRecipe = { slug: 'sauce', yield: { qty: { raw: 1, value: 1 }, unit: 'l' }, servings: 4 };
		const line: Ingredient = { qty: { raw: 1, value: 1 }, unit: 'cup', name: 'sauce', recipe: 'sauce' };
		expect(subRecipeScale(line, sauce, CONV, 2, RULES)).toBeCloseTo(0.5);
		// The link says portions when they come out whole.
		expect(subRecipeHref(line, sauce, CONV, 2, RULES)).toBe('/r/sauce?portions=2');
	});

	it('does not scale a text yield, a unit of another class, or no amount', () => {
		const text: SubScaleRecipe = { slug: 'bouillon', yield: '2 litres' };
		const line: Ingredient = { qty: { raw: 250, value: 250 }, unit: 'ml', name: 'bouillon', recipe: 'bouillon' };
		expect(subRecipeScale(line, text, CONV, 2, RULES)).toBeUndefined();
		expect(subRecipeHref(line, text, CONV, 2, RULES)).toBe('/r/bouillon');
		const mass: SubScaleRecipe = { slug: 'x', yield: { qty: { raw: 500, value: 500 }, unit: 'g' } };
		expect(subRecipeScale({ ...line, recipe: 'x' }, mass, CONV, 1, RULES)).toBeUndefined();
		expect(subRecipeScale({ name: 'pâte', recipe: 'pate-brisee' }, pastry, CONV, 2, RULES)).toBeUndefined();
		expect(subRecipeHref(crust(1), undefined, CONV, 2, RULES)).toBe('/r/pate-brisee');
	});

	it('keeps a derived factor inside the file’s cap', () => {
		const big: SubScaleRecipe = { slug: 'big', yield: { qty: { raw: 100, value: 100 }, unit: 'piece' } };
		expect(subRecipeScale(crust(1), big, CONV, 0.5, RULES)).toBeUndefined();
		expect(subRecipeHref(crust(1), big, CONV, 0.5, RULES)).toBe('/r/pate-brisee');
	});
});
