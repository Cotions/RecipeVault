import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkRecipe, sortDiagnostics } from '../../src/lib/vault/check';
import type { Diagnostic } from '../../src/lib/vault/types';

const BASE = readFileSync('tests/fixtures/check/invalid/E201-tasse.md', 'utf8').replace('unit: tasse', 'unit: cup');

/** Replace one line of the clean base card. */
const edit = (from: string, to: string) => {
	expect(BASE).toContain(from);
	return BASE.replace(from, to);
};
const codes = (text: string) => checkRecipe(text).diagnostics.map((d) => d.code);
const find = (text: string, code: string) => checkRecipe(text).diagnostics.filter((d) => d.code === code);

describe('checkRecipe on the clean base', () => {
	it('has no diagnostics and returns a typed recipe', () => {
		const r = checkRecipe(BASE);
		expect(r.diagnostics).toEqual([]);
		expect(r.recipe?.slug).toBe('pouding-chomeur');
		expect(r.recipe?.times?.cook).toEqual({ raw: '40m', seconds: 2400 });
		expect(r.recipe?.ingredients[0].items[1]).toEqual({ name: 'sucre', qty: { raw: '1/2', value: 0.5 }, unit: 'cup' });
		expect(r.recipe?.oven).toEqual({ temp: 350, unit: 'F' });
	});
});

describe('typed recipe', () => {
	it('derives the slug, defaults lang, strips wikilink brackets, records markers', () => {
		const text = edit('slug: pouding-chomeur\n', '').replace('title: Pouding chômeur', 'title: Pouding chômeur [+]').replace(
			'      - { qty: 2, unit: tbsp, name: beurre }',
			'      - { qty: 2, unit: tbsp, name: beurre, or: [margarine] }\n      - { qty: 1, unit: piece, name: pâte, recipe: "[[pate-brisee]]", buy_instead: true }'
		);
		const r = checkRecipe(text.replace('lang: fr\n', ''));
		expect(r.recipe?.slug).toBe('pouding-chomeur');
		expect(r.recipe?.slugDerived).toBe(true);
		expect(r.recipe?.lang).toBe('fr');
		expect(r.recipe?.ingredients[1].items[2].or).toEqual([{ name: 'margarine' }]);
		expect(r.recipe?.ingredients[1].items[3]).toMatchObject({ recipe: 'pate-brisee', buyInstead: true });
		expect(r.recipe?.markers).toEqual([{ kind: 'added', path: 'title', text: '[+]' }]);
	});

	it('is absent when there is an error', () => {
		expect(checkRecipe(edit('schema: 3\n', '')).recipe).toBeUndefined();
	});
});

describe('E201 messages', () => {
	it('maps a known Quebec alias', () => {
		const [d] = find(edit('unit: cup, name: farine', 'unit: livre, name: farine'), 'E201');
		expect(d.path).toBe('ingredients[0].items[0].unit');
		expect(d.message).toContain('`livre` is written `lb`');
		expect(d.fix).toBe('Write `unit: lb`.');
	});

	it('lists the allowed units and the Quebec mapping for an unknown unit', () => {
		const [d] = find(edit('unit: cup, name: farine', 'unit: cuillere, name: farine'), 'E201');
		expect(d.fix).toContain('Allowed units: g, kg, ml');
		expect(d.fix).toContain('tasse/t. → cup, livre → lb, c. à thé → tsp');
	});

	it('reads t. as a cup in French and t as a teaspoon in English', () => {
		expect(find(edit('unit: cup, name: farine', 'unit: t., name: farine'), 'E201')[0].fix).toBe('Write `unit: cup`.');
		const en = edit('lang: fr', 'lang: en').replace('unit: cup, name: farine', 'unit: t, name: farine');
		expect(find(en, 'E201')[0].fix).toBe('Write `unit: tsp`.');
		const enT = edit('lang: fr', 'lang: en').replace('unit: cup, name: farine', 'unit: T, name: farine');
		expect(find(enT, 'E201')[0].fix).toBe('Write `unit: tbsp`.');
	});

	it('checks units inside or objects and alt, with their paths', () => {
		const text = edit(
			'      - { qty: 2, unit: tbsp, name: beurre }',
			'      - { qty: 2, unit: tbsp, name: beurre, or: [{ qty: 1, unit: tasse, name: huile }], alt: { qty: 30, unit: mls } }'
		);
		expect(find(text, 'E201').map((d) => d.path)).toEqual([
			'ingredients[1].items[2].alt.unit',
			'ingredients[1].items[2].or[0].unit'
		]);
	});
});

describe('E210 / E216 fixes', () => {
	it('rewrites a name holding a quantity', () => {
		const [d] = find(edit('{ qty: 1, unit: cup, name: farine }', '{ name: 2 tasses de farine, prep: tamisée }'), 'E210');
		expect(d.fix).toBe('Move it: `{ qty: 2, unit: cup, name: farine, prep: tamisée }`');
	});

	it('moves a note amount into qty/unit', () => {
		const [d] = find(edit('{ qty: 2, unit: tbsp, name: beurre }', '{ name: beurre, note: 1/4 lbs }'), 'E216');
		expect(d.fix).toContain('`{ qty: "1/4", unit: lb, name: beurre }`');
	});

	it('points an alternative amount at or', () => {
		const [d] = find(edit('{ qty: 2, unit: tbsp, name: beurre }', '{ qty: 2, unit: tbsp, name: beurre, note: ou 1 c. à soupe de margarine }'), 'E216');
		expect(d.fix).toContain('`or: [{ qty: 1, unit: tbsp, name: … }]`');
	});

	const item = (s: string) => edit('{ qty: 2, unit: tbsp, name: beurre }', s);

	it.each([
		'{ qty: 1, unit: piece, name: fromage, note: environ 450 g }',
		'{ qty: 1, unit: piece, name: fromage, note: "format familial, environ 450 g" }',
		'{ qty: 1, unit: packet, name: levure, note: 8 g }',
		'{ qty: 2, unit: slice, name: bacon, note: 1/4 lb en tout }'
	])('allows one size on a counted or contained item: %s', (entry) => {
		expect(codes(item(entry))).toEqual([]);
	});

	it.each([
		['measure unit', '{ qty: 250, unit: g, name: fromage, note: environ 450 g }'],
		['no unit', '{ name: fromage, note: environ 450 g }'],
		['two amounts', '{ qty: 1, unit: can, name: épices, note: "4 ml (3/4 c. à thé)" }'],
		['alternative, French', '{ qty: 1, unit: packet, name: bouillon, note: ou 1 sachet de bouillon }'],
		['alternative mid-note', '{ qty: 1, unit: piece, name: citron, note: "gros, or 2 tbsp juice" }']
	])('still fires E216: %s', (_, entry) => {
		expect(codes(item(entry))).toEqual(['E216']);
	});

	it('allows a can size in note', () => {
		expect(codes(edit('{ qty: 2, unit: tbsp, name: beurre }', '{ qty: 1, unit: can, name: lait évaporé, note: "385 ml" }'))).toEqual([]);
	});
});

describe('W610 unknown keys', () => {
	it('suggests the real key, at top level and nested', () => {
		const text = edit('servings: 8\n', 'serving: 8\n').replace('  prep: 15m\n', '  prep: 15m\n  marinade: 2h\n');
		const ds = find(text, 'W610');
		expect(ds.map((d) => [d.path, d.fix?.slice(0, 30)])).toEqual([
			['serving', 'Did you mean `servings`?'],
			['times.marinade', 'Allowed keys in `times`: prep, '.slice(0, 30)]
		]);
	});

	it('points a misplaced author at source.author', () => {
		expect(find(edit('servings: 8\n', 'servings: 8\nauteur: Lucienne\n'), 'W610')[0].fix).toBe('Did you mean `source.author`?');
	});
});

describe('markers', () => {
	it('W605 lists each location, I701 flags [+]', () => {
		const text = edit('  author: Grand-maman Lucienne', '  author: Grand-maman Lucienne [?]')
			.replace('{ qty: 1, unit: cup, name: farine }', '{ qty: "1 [?]", unit: cup, name: farine }')
			.replace('4. Cuire 40 min.', '4. Cuire 40 min. [+]');
		const r = checkRecipe(text);
		expect(r.diagnostics.filter((d) => d.code === 'W605').map((d) => d.path)).toEqual([
			'ingredients[0].items[0].qty',
			'source.author'
		]);
		expect(r.diagnostics.filter((d) => d.code === 'I701').map((d) => d.path)).toEqual(['body.steps[3]']);
		expect(r.recipe?.ingredients[0].items[0].qty).toEqual({ raw: '1 [?]', value: 1 });
	});
});

describe('a value starting with an unquoted marker', () => {
	it('fires the field\'s own code with the quote fix', () => {
		const text = edit('title: Pouding chômeur', 'title: [?: Pouding]').replace('{ qty: 1, unit: cup, name: farine }', '{ qty: [?], unit: cup, name: farine }');
		const ds = checkRecipe(text).diagnostics;
		expect(ds.map((d) => [d.code, d.path, d.fix])).toEqual([
			['E204', 'ingredients[0].items[0].qty', 'Wrap the value in double quotes: `qty: "[?]"`.'],
			['E101', 'title', 'Wrap the value in double quotes: `title: "[?: Pouding]"`.']
		]);
	});

	it('followed by text it breaks the YAML: E002 names the value to quote', () => {
		const [d] = checkRecipe(edit('{ qty: 1, unit: cup, name: farine }', '{ qty: 1, unit: cup, name: [+] farine }')).diagnostics;
		expect(d.code).toBe('E002');
		expect(d.fix).toContain('`name: "[+] farine"`');
	});
});

describe('E218 text fields', () => {
	it('fires on a list, mapping or boolean in a text field, with its path', () => {
		const text = edit('tags: [dessert, quebecois]', 'tags: [dessert, true]').replace('name: eau, note: bouillante', 'name: eau, prep: { a: 1 }');
		expect(checkRecipe(text).diagnostics.map((d) => [d.code, d.path])).toEqual([
			['E218', 'ingredients[1].items[1].prep'],
			['E218', 'tags[1]']
		]);
	});

	it('checks or objects too', () => {
		const text = edit('{ qty: 2, unit: tbsp, name: beurre }', '{ qty: 2, unit: tbsp, name: beurre, or: [{ name: margarine, note: [?] }] }');
		expect(checkRecipe(text).diagnostics.map((d) => [d.code, d.path, d.fix])).toEqual([
			['E218', 'ingredients[1].items[2].or[0].note', 'Wrap the value in double quotes: `note: "[?]"`.']
		]);
	});

	it('keeps a number in a text field as text', () => {
		const r = checkRecipe(edit('name: eau, note: bouillante', 'name: eau, note: 796'));
		expect(r.diagnostics).toEqual([]);
		expect(r.recipe?.ingredients[1].items[1].note).toBe('796');
	});
});

describe('body rules', () => {
	it('W401 when there is no method and no other heading', () => {
		expect(codes(BASE.slice(0, BASE.indexOf('## Préparation')))).toEqual(['W401']);
	});

	it('W402 on a very long step', () => {
		expect(codes(edit('4. Cuire 40 min.', `4. ${'Cuire longtemps. '.repeat(30)}`))).toEqual(['W402']);
	});

	it('W609 on a temperature in a step without oven', () => {
		const [d] = find(edit('oven: { temp: 350, unit: F }\n', '').replace('4. Cuire 40 min.', '4. Cuire à 375°F, 40 min.'), 'W609');
		expect(d.fix).toBe('Add `oven: { temp: 375, unit: F }`.');
	});
});

describe('completeness', () => {
	it('W601 / W602 / W604', () => {
		const text = edit('servings: 8\n', '').replace('times:\n  prep: 15m\n  cook: 40m\n', '').replace('source:\n  type: family\n  author: Grand-maman Lucienne\n', '');
		expect(codes(text).sort()).toEqual(['W601', 'W602', 'W604']);
	});

	it('yield instead of servings is not W601', () => {
		expect(codes(edit('servings: 8\n', 'yield: "1 moule 9x13"\n'))).toEqual([]);
	});
});

describe('sortDiagnostics', () => {
	it('orders by severity, then path with numeric indices, frontmatter before body', () => {
		const d = (code: string, severity: Diagnostic['severity'], path: string | null): Diagnostic => ({ code, severity, path, message: '' });
		const sorted = sortDiagnostics([
			d('I701', 'info', 'title'),
			d('W605', 'warning', 'body.steps[0]'),
			d('W605', 'warning', 'title'),
			d('E201', 'error', 'ingredients[0].items[10].unit'),
			d('E201', 'error', 'ingredients[0].items[2].unit'),
			d('E101', 'error', null)
		]);
		expect(sorted.map((x) => `${x.code} ${x.path}`)).toEqual([
			'E101 null',
			'E201 ingredients[0].items[2].unit',
			'E201 ingredients[0].items[10].unit',
			'W605 title',
			'W605 body.steps[0]',
			'I701 title'
		]);
	});
});
