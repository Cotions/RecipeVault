// The form model (plan 04, Phase 2): fields, groups and rows, what is kept
// and what is dropped (Q4 A), markers (Q15 A), defaults from data. All content
// invented.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultsFor, statsFromRecipes } from '../../../src/lib/form/defaults';
import {
	confirmField,
	emptyForm,
	ensureSection,
	fieldMarkers,
	formText,
	fromForm,
	newItem,
	newRow,
	toForm,
	uncertainFields,
	type FormRecipe
} from '../../../src/lib/form/model';
import { checkFile } from '../../../src/lib/vault/check';
import { serialize } from '../../../src/lib/vault/serialize';

function open(text: string): { form: FormRecipe; canonical: string } {
	const f = checkFile(text);
	expect(f.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
	return { form: toForm(f.recipe!, f.body!), canonical: serialize(f.recipe!, f.body!) };
}

/** The saved text, checked: it must still read without errors. */
function save(form: FormRecipe): string {
	const { errors } = fromForm(form);
	expect(errors).toEqual([]);
	const text = formText(form);
	expect(checkFile(text).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
	return text;
}

const FULL = `---
schema: 3
title: "Tarte du dimanche [+]"
slug: tarte-du-dimanche
lang: fr
family: tarte
variant: dimanche
source:
  type: family
  author: "Tante Odile [?: Odette]"
  page: "12"
times:
  prep: 90m
  cook: "40m [?]"
oven: { temp: "375 [?]", unit: F }
servings: 8
servings_max: 10
tags: [dessert]
ingredients:
  - group: Pâte
    items:
      - { qty: 1, unit: piece, name: pâte brisée, recipe: pate-brisee, buy_instead: true }
  - group: Garniture
    items:
      - { qty: "1 1/2", unit: cup, name: "sucre [?]" }
      - { qty: 250, unit: ml, name: crème, alt: { qty: 1, unit: cup } }
      - { qty: 2, qty_max: 3, unit: piece, name: œufs, or: [{ qty: 3, unit: tbsp, name: substitut d'œuf }, jaunes] }
      - { qty: "2", unit: tbsp, name: farine, item: farine-tout-usage }
      - { name: muscade, to_taste: true }
  - group: Garniture facultative
    optional: true
    items:
      - { qty: 0.5, unit: cup, name: pacanes, prep: hachées, optional: true }
media:
  final: final.jpg
  card: carte.jpg
status: needs-review
added: 2026-01-02
updated: 2026-01-03
extracted_by: ai
---

Carte trouvée dans le livre de recettes.

## Préparation

1. Préchauffer le four.
2. Garniture :
   - sucre et crème
   - œufs [?]
3. Verser dans la pâte. [+]

## Notes

Meilleure tiède [illisible].

## Souvenirs

- Faite à chaque Noël.
`;

describe('toForm', () => {
	const { form } = open(FULL);

	it('shows values without marker syntax, as she would type them', () => {
		expect(form.title).toBe('Tarte du dimanche');
		expect(form.source.author).toBe('Tante Odile');
		expect(form.source.page).toBe('12');
		expect(form.oven).toEqual({ temp: '375', tempMax: '', unit: 'F' });
		expect(form.times.prep).toEqual({ hours: 1, minutes: 30, maxHours: null, maxMinutes: null });
		expect(form.times.cook).toEqual({ hours: null, minutes: 40, maxHours: null, maxMinutes: null });
		const [sucre, creme, oeufs, farine] = form.groups[1].items;
		expect([sucre.qty, sucre.unit, sucre.name]).toEqual(['1 ½', 'cup', 'sucre']);
		expect(creme.alt).toMatchObject({ qty: '1', unit: 'cup' });
		expect([oeufs.qty, oeufs.qtyMax]).toEqual(['2', '3']);
		expect(oeufs.or.map((o) => [o.qty, o.name])).toEqual([
			['3', "substitut d'œuf"],
			['', 'jaunes']
		]);
		expect(farine.item).toBe('farine-tout-usage');
		expect(form.groups[2].items[0].qty).toBe('0,5');
		expect(form.groups[0].items[0]).toMatchObject({ recipe: 'pate-brisee', buyInstead: true });
		const method = form.sections[0];
		expect(method.kind === 'method' && method.rows.map((r) => r.text)).toEqual([
			'Préchauffer le four.',
			'Garniture :\n- sucre et crème\n- œufs',
			'Verser dans la pâte.'
		]);
		const notes = form.sections[1];
		expect(notes.kind === 'notes' && notes.text).toBe('Meilleure tiède.');
	});

	it('keeps what it does not edit: preamble, other sections, media keys, app fields', () => {
		expect(form.preamble).toBe('Carte trouvée dans le livre de recettes.');
		expect(form.sections[2]).toMatchObject({ kind: 'other', heading: 'Souvenirs', text: '- Faite à chaque Noël.' });
		expect(form.media).toEqual({ final: 'final.jpg', card: 'carte.jpg' });
		expect(form.app).toEqual({ status: 'needs-review', added: '2026-01-02', updated: '2026-01-03', extractedBy: 'ai' });
	});

	it('is plain JSON', () => {
		expect(JSON.parse(JSON.stringify(form))).toEqual(form);
	});
});

describe('fromForm', () => {
	it('an unchanged form writes the canonical file', () => {
		const { form, canonical } = open(FULL);
		expect(save(form)).toBe(canonical);
	});

	it('drops YAML comments and unknown keys, as the canonical serializer does (Q4 A, the named loss)', () => {
		const text = FULL.replace('lang: fr', 'lang: fr # langue de la carte\ncouleur: bleue');
		const { form, canonical } = open(text);
		const out = save(form);
		expect(out).toBe(canonical);
		expect(out).not.toMatch(/couleur|langue de la carte/);
	});

	it('an edited field changes only its line', () => {
		const { form, canonical } = open(FULL);
		form.groups[1].items[1].qty = '300';
		const out = save(form);
		const diff = out.split('\n').filter((l, i) => l !== canonical.split('\n')[i]);
		expect(diff).toEqual(['      - { qty: 300, unit: ml, name: crème, alt: { qty: 1, unit: cup } }']);
	});

	it('writes every ingredient field back', () => {
		const { form } = open(FULL);
		const it2 = form.groups[1].items;
		it2[2].or[1].name = 'jaunes d’œufs';
		it2[3].qty = '2';
		const out = save(form);
		expect(out).toContain(`- { qty: 2, qty_max: 3, unit: piece, name: œufs, or: [{ qty: 3, unit: tbsp, name: substitut d'œuf }, jaunes d’œufs] }`);
		// Unchanged in what she sees: the quoted "2" stays as written.
		expect(out).toContain('- { qty: "2", unit: tbsp, name: farine, item: farine-tout-usage }');
		expect(out).toContain('- { qty: 1, unit: piece, name: pâte brisée, recipe: pate-brisee, buy_instead: true }');
		expect(out).toMatch(/- group: Garniture facultative\n {4}optional: true/);
	});

	it('an edited quantity takes the typed form', () => {
		const { form } = open(FULL);
		const item = form.groups[1].items[3];
		item.qty = '1½';
		expect(save(form)).toContain('- { qty: "1 1/2", unit: tbsp, name: farine');
		item.qty = '0,75';
		expect(save(form)).toContain('- { qty: 0.75, unit: tbsp, name: farine');
		item.qty = 'deux';
		expect(fromForm(form).errors).toEqual([{ id: item.id, field: 'qty', reason: 'format' }]);
	});

	it('times: an unchanged `90m` stays, an edited time is canonical, a bad range is an error', () => {
		const { form } = open(FULL);
		expect(save(form)).toContain('  prep: 90m\n');
		form.times.prep = { hours: 1, minutes: 45, maxHours: 2, maxMinutes: null };
		expect(save(form)).toContain('  prep: 1h45m-2h\n');
		form.times.rest = { hours: null, minutes: 20, maxHours: null, maxMinutes: 10 };
		expect(fromForm(form).errors).toEqual([{ id: 'recipe', field: 'times.rest', reason: 'range' }]);
	});

	it('a new recipe from an empty form', () => {
		const form = emptyForm({ lang: 'fr', ovenUnit: 'C' });
		form.title = 'Galettes de sarrasin';
		Object.assign(form.groups[0].items[0], { qty: '2', unit: 'cup', name: 'farine de sarrasin' });
		form.groups[0].items.push({ ...newItem(), name: 'sel', toTaste: true }, newItem());
		form.oven.temp = '200';
		form.servings = '4';
		const method = ensureSection(form, 'method');
		method.rows[0].text = 'Mélanger.';
		method.rows.push({ ...newRow(), text: 'Cuire.' });
		ensureSection(form, 'notes').text = 'Avec du sirop.';
		expect(save(form)).toBe(`---
schema: 3
title: Galettes de sarrasin
slug: galettes-de-sarrasin
lang: fr
oven: { temp: 200, unit: C }
servings: 4
ingredients:
  - items:
      - { qty: 2, unit: cup, name: farine de sarrasin }
      - { name: sel, to_taste: true }
---

## Préparation

1. Mélanger.
2. Cuire.

## Notes

Avec du sirop.
`);
	});

	it('refuses what the file format cannot hold', () => {
		const form = emptyForm();
		form.groups[0].items[0].qty = '2';
		form.oven.temp = '350';
		const codes = fromForm(form).errors.map((e) => `${e.field}:${e.reason}`);
		expect(codes).toEqual(['title:required', 'oven.unit:required', 'name:required', 'ingredients:required']);
	});

	it('a section she empties is not written; the notes section is added after the method', () => {
		const { form } = open(FULL);
		const notes = form.sections.find((s) => s.kind === 'notes')!;
		if (notes.kind === 'notes') notes.text = '';
		ensureSection(form, 'variants').text = 'Au sirop d’érable.';
		const out = save(form);
		expect(out).not.toContain('## Notes');
		expect(out).toMatch(/## Préparation[\s\S]*## Variantes\n\nAu sirop d’érable\.\n\n## Souvenirs/);
	});
});

describe('markers (Q15 A)', () => {
	it('fields holding an uncertain reading report it, with the alternative', () => {
		const { form } = open(FULL);
		expect(fieldMarkers(form, 'source.author', 'fr')).toMatchObject({ uncertain: true, alternatives: ['Odette'] });
		expect(fieldMarkers(form, 'title', 'fr')).toMatchObject({ uncertain: false, marks: [{ kind: 'added' }] });
		expect(uncertainFields(form).map(([, key]) => key)).toEqual([
			'source.author',
			'times.cook',
			'oven.temp',
			'name',
			'text',
			'text'
		]);
	});

	it('confirm removes the uncertain markers of a text field, keeps [+]', () => {
		const { form } = open(FULL);
		confirmField(form, 'source.author', 'fr');
		const row = form.sections[0].kind === 'method' ? form.sections[0].rows[1] : undefined!;
		confirmField(row, 'text', 'fr');
		const out = save(form);
		expect(out).toContain('  author: Tante Odile\n');
		expect(out).toContain('   - œufs\n3. Verser dans la pâte. [+]');
		expect(out).toContain('title: "Tarte du dimanche [+]"');
	});

	it('confirm on a number field writes the plain number', () => {
		const { form } = open(FULL);
		confirmField(form, 'oven.temp', 'fr');
		confirmField(form, 'times.cook', 'fr');
		confirmField(form.groups[1].items[0], 'name', 'fr');
		const out = save(form);
		expect(out).toContain('oven: { temp: 375, unit: F }');
		expect(out).toContain('  cook: 40m\n');
		expect(out).toContain('- { qty: "1 1/2", unit: cup, name: sucre }');
		expect(uncertainFields(form).length).toBe(3);
	});

	it('editing a field settles its uncertain markers', () => {
		const { form } = open(FULL);
		form.source.author = 'Tante Odette';
		form.oven.temp = '350';
		form.groups[1].items[0].name = 'cassonade';
		const out = save(form);
		expect(out).toContain('  author: Tante Odette\n');
		expect(out).toContain('oven: { temp: 350, unit: F }');
		expect(out).toContain('name: cassonade }');
		expect(fieldMarkers(form, 'oven.temp', 'fr').uncertain).toBe(false);
	});

	it('[+] stays after its text while that text is untouched, and goes with it', () => {
		const { form } = open(FULL);
		form.title = 'Tarte du dimanche soir';
		expect(save(form)).toContain('title: "Tarte du dimanche [+] soir"');
		form.title = 'Tarte de Noël';
		expect(save(form)).toContain('title: Tarte de Noël\n');
		const rows = form.sections[0].kind === 'method' ? form.sections[0].rows : [];
		rows[2].text = 'Verser dans la pâte. Cuire 40 minutes.';
		expect(save(form)).toContain('3. Verser dans la pâte. [+] Cuire 40 minutes.');
		rows[2].text = 'Verser dans le moule.';
		expect(save(form)).toContain('3. Verser dans le moule.\n');
	});

	it('she cannot add a marker: typed brackets are her text', () => {
		const form = emptyForm();
		form.title = 'Sauce';
		form.groups[0].items[0].name = 'sel';
		form.groups[0].items[0].toTaste = true;
		form.servingsNote = 'environ';
		expect(fieldMarkers(form, 'servingsNote', 'fr').uncertain).toBe(false);
	});
});

describe('defaults from the vault (decision 1)', () => {
	const recipes = readdirSync('tests/fixtures/vault/recipes')
		.filter((f) => f.endsWith('.md'))
		.map((f) => checkFile(readFileSync(join('tests/fixtures/vault/recipes', f), 'utf8')).recipe!);

	it('oven unit, unit order and language come from the recipes', () => {
		const stats = statsFromRecipes(recipes);
		const d = defaultsFor(stats);
		const f = stats.ovenUnits.F ?? 0;
		const c = stats.ovenUnits.C ?? 0;
		expect(d.ovenUnit).toBe(f >= c ? 'F' : 'C');
		const counts = d.unitOrder.map((u) => stats.units[u] ?? 0);
		expect(counts).toEqual([...counts].sort((a, b) => b - a));
		expect(d.unitOrder).toHaveLength(26);
		expect(d.lang).toBe('fr');
	});

	it('follows the data, not a built-in choice', () => {
		expect(defaultsFor({ units: { g: 1 }, ovenUnits: { C: 3, F: 1 }, langs: { en: 2, fr: 1 } })).toMatchObject({
			ovenUnit: 'C',
			lang: 'en'
		});
		expect(defaultsFor()).toMatchObject({ ovenUnit: null, lang: 'fr' });
		expect(defaultsFor({ units: { tsp: 5, cup: 9 }, ovenUnits: {}, langs: {} }).unitOrder.slice(0, 3)).toEqual(['cup', 'tsp', 'g']);
	});
});

describe('browser safety', () => {
	it('src/lib/form imports nothing from Node or the server', () => {
		for (const f of readdirSync('src/lib/form')) {
			const text = readFileSync(join('src/lib/form', f), 'utf8');
			expect(text, f).not.toMatch(/from ['"](?:node:|fs|path|\$lib\/server|\.\.\/server)/);
		}
	});
});
