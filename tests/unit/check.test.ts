import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkBatch, checkPaste, checkRecipe, sortDiagnostics } from '../../src/lib/vault/check';
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

	it('reads a leading decimal point as a decimal', () => {
		const [d] = find(edit('{ qty: 2, unit: tbsp, name: beurre }', '{ name: vin blanc, note: .75 l }'), 'E216');
		expect(d.fix).toContain('`{ qty: 0.75, unit: l, name: vin blanc }`');
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
		'{ qty: 2, unit: slice, name: bacon, note: 1/4 lb en tout }',
		'{ qty: 1, unit: can, name: pois chiches, note: "19 oz (540 ml)" }',
		'{ qty: 1, unit: can, name: pois chiches, note: "540 ml (19 oz), égouttés" }',
		'{ qty: 1, unit: can, name: épices, note: "4 ml (3/4 c. à thé)" }',
		'{ qty: 1, unit: bottle, name: vin blanc, note: .75 l }',
		'{ qty: 1, unit: packet, name: saucisses, note: 2 x 400 g }'
	])('allows one size on a counted or contained item: %s', (entry) => {
		expect(codes(item(entry))).toEqual([]);
	});

	it.each([
		['measure unit', '{ qty: 250, unit: g, name: fromage, note: environ 450 g }'],
		['no unit', '{ name: fromage, note: environ 450 g }'],
		['two amounts', '{ qty: 1, unit: can, name: tomates, note: "796 ml, 540 ml" }'],
		['two sizes in one unit, one in parentheses', '{ qty: 1, unit: can, name: tomates, note: "796 ml (540 ml)" }'],
		['a parenthesised equivalent followed by another size', '{ qty: 1, unit: can, name: tomates, note: "19 oz (540 ml) + 2 oz" }'],
		['an alternative in parentheses', '{ qty: 1, unit: can, name: tomates, note: "19 oz (ou 540 ml)" }'],
		['alternative, French', '{ qty: 1, unit: packet, name: bouillon, note: ou 1 sachet de bouillon }'],
		['alternative mid-note', '{ qty: 1, unit: piece, name: citron, note: "gros, or 2 tbsp juice" }']
	])('still fires E216: %s', (_, entry) => {
		expect(codes(item(entry))).toEqual(['E216']);
	});

	it.each([
		['{ qty: 1, unit: piece, name: courge, note: "environ 450 g, ou 2 t. de restes" }', '`or: [{ qty: 2, unit: cup, name: … }]`'],
		['{ qty: 1, unit: can, name: lait, note: "385 ml ou environ 1 t." }', '`or: [{ qty: 1, unit: cup, name: … }]`']
	])('puts the amount after ou in or: %s', (entry, fix) => {
		const [d] = find(item(entry), 'E216');
		expect(d.fix).toContain(fix);
	});

	it('reads 1-1/2 in a name as a mixed number', () => {
		const [d] = find(edit('{ qty: 1, unit: cup, name: farine }', '{ name: 1-1/2 tasse de farine }'), 'E210');
		expect(d.fix).toBe('Move it: `{ qty: "1 1/2", unit: cup, name: farine }`');
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
		const text = edit('title: Pouding chômeur', 'title: [?: Pouding]').replace('author: Grand-maman Lucienne', 'author: [illisible]');
		const ds = checkRecipe(text).diagnostics;
		expect(ds.map((d) => [d.code, d.path, d.fix])).toEqual([
			['E218', 'source.author', 'Wrap the value in double quotes: `author: "[illisible]"`.'],
			['E101', 'title', 'Wrap the value in double quotes: `title: "[?: Pouding]"`.']
		]);
	});
});

describe('a number, unit, type or time holding only a marker', () => {
	const ask = 'and ask about it in QUESTIONS — never guess it.';
	it.each([
		['qty, unquoted', ['{ qty: 1, unit: cup, name: farine }', '{ qty: [?], unit: cup, name: farine }'], 'E204', 'ingredients[0].items[0].qty', `leave out the amount (\`qty\`, \`qty_max\`, \`unit\`) ${ask}`],
		['qty, quoted', ['{ qty: 1, unit: cup, name: farine }', '{ qty: "[illisible]", unit: cup, name: farine }'], 'E204', 'ingredients[0].items[0].qty', 'leave out the amount'],
		['unit', ['{ qty: 1, unit: cup, name: farine }', '{ qty: 1, unit: "[illisible]", name: farine }'], 'E201', 'ingredients[0].items[0].unit', 'leave out the amount'],
		['alt unit', ['{ qty: 1, unit: cup, name: farine }', '{ qty: 1, unit: cup, name: farine, alt: { qty: 250, unit: [illisible] } }'], 'E201', 'ingredients[0].items[0].alt.unit', 'leave out `alt`'],
		['source.type', ['type: family', 'type: [illisible]'], 'E106', 'source.type', `leave out \`type\` ${ask}`],
		['a time', ['cook: 40m', 'cook: "[?]"'], 'E109', 'times.cook', `leave out \`cook\` ${ask}`],
		['servings', ['servings: 8', 'servings: [illisible]'], 'E108', 'servings', 'leave out `servings` (and `servings_max`)'],
		['oven.temp', ['oven: { temp: 350, unit: F }', 'oven: { temp: "[illisible]", unit: F }'], 'E111', 'oven.temp', 'leave out `oven`']
	] as const)('%s: leave it out and ask', (_, [from, to], code, path, fix) => {
		const ds = checkRecipe(edit(from, to)).diagnostics.filter((d) => d.severity === 'error');
		expect(ds.map((d) => [d.code, d.path])).toEqual([[code, path]]);
		expect(ds[0].message).toContain('holds only a marker');
		expect(ds[0].fix).toContain(fix);
		expect(ds[0].fix).not.toContain('double quotes');
	});
});

describe('markers on servings and oven temperatures', () => {
	it('are allowed as on qty, and the numbers stay numbers', () => {
		const text = edit('servings: 8', 'servings: "8 [?]"\nservings_max: "10 [?: 12]"').replace('oven: { temp: 350, unit: F }', 'oven: { temp: "350 [?]", temp_max: 375, unit: F }');
		const r = checkRecipe(text);
		expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
		expect(r.diagnostics.filter((d) => d.code === 'W605').map((d) => d.path)).toEqual(['oven.temp', 'servings', 'servings_max']);
		expect(r.recipe).toMatchObject({ servings: 8, servingsMax: 10, servingsRaw: '8 [?]', servingsMaxRaw: '10 [?: 12]' });
		expect(r.recipe?.oven).toEqual({ temp: 350, tempMax: 375, unit: 'F', tempRaw: '350 [?]' });
	});

	it.each([
		['servings: "huit [?]"', 'E108'],
		['servings: "8"', 'E108'],
		['servings: "8.5 [?]"', 'E108'],
		['servings: "8 [?]"\nservings_max: "6 [?]"', 'E108']
	])('still rejects what is not a number once the markers are gone: %s', (to, code) => {
		expect(find(edit('servings: 8', to), code)).toHaveLength(1);
	});

	it('still rejects an oven range that does not rise', () => {
		const ds = find(edit('oven: { temp: 350, unit: F }', 'oven: { temp: "350 [?]", temp_max: "325 [?]", unit: F }'), 'E111');
		expect(ds.map((d) => d.path)).toEqual(['oven.temp_max']);
	});

	it('followed by text it breaks the YAML: E002 names the value to quote', () => {
		const [d] = checkRecipe(edit('{ qty: 1, unit: cup, name: farine }', '{ qty: 1, unit: cup, name: [+] farine }')).diagnostics;
		expect(d.code).toBe('E002');
		expect(d.fix).toContain('`name: "[+] farine"`');
	});
});

describe('a list entry starting with an unquoted marker', () => {
	it('quotes only that entry, keeping the list', () => {
		const tags = find(edit('tags: [dessert, quebecois]', 'tags: [dessert, [illisible], quebecois]'), 'E218');
		expect(tags.map((d) => [d.path, d.fix])).toEqual([['tags[1]', 'Wrap the entry in double quotes: `tags: [dessert, "[illisible]", quebecois]`.']]);
		const [or] = find(edit('{ qty: 2, unit: tbsp, name: beurre }', '{ qty: 2, unit: tbsp, name: beurre, or: [[?]] }'), 'E215');
		expect(or.fix).toBe('Wrap the entry in double quotes: `or: ["[?]"]`.');
	});
});

describe('fixes are valid YAML', () => {
	it.each([
		['123', '"123"'],
		['true', '"true"']
	])('quotes a slug that would not read as text: %s', (slug, fixed) => {
		const [d] = find(edit('slug: pouding-chomeur', `slug: ${slug}`), 'E102');
		expect(d.fix).toBe(`Write \`slug: ${fixed}\`.`);
	});

	it('never shows [object Object] for a mapping title', () => {
		const [d] = find(edit('title: Pouding chômeur', 'title:\n  fr: Pouding\n  en: Pudding'), 'E101');
		expect(d.fix).not.toContain('[object Object]');
	});
});

describe('E002 on YAML alias errors', () => {
	it.each([
		['an unresolved alias', 'servings: *huit*', 'Unresolved alias'],
		['a self-referencing anchor', 'x: &x { y: *x }', 'refers to itself'],
		['too many aliases', `a: &a [${'x,'.repeat(10)}]\nb: &b [${'*a,'.repeat(10)}]\nc: [${'*b,'.repeat(11)}]`, 'alias count']
	])('%s', (_, yaml, message) => {
		const [d] = checkRecipe(edit('servings: 8', yaml)).diagnostics;
		expect(d.code).toBe('E002');
		expect(d.message).toContain(message);
	});

	it('names the value to quote', () => {
		const [d] = checkRecipe(edit('servings: 8', 'servings: *huit*')).diagnostics;
		expect(d.fix).toContain('`servings: "*huit*"`');
	});

	it('does not stop a batch', () => {
		const r = checkBatch([
			{ name: 'a.md', text: edit('servings: 8', 'servings: *huit*') },
			{ name: 'b.md', text: BASE.replace('slug: pouding-chomeur', 'slug: autre') }
		]);
		expect(r.files.map((f) => f.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code))).toEqual([['E002'], []]);
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

	it.each([
		['tags: dessert', 'tags', 'Write it as a list: `tags: [dessert]`.'],
		['tags: dessert, hiver', 'tags', 'Write it as a list: `tags: [dessert, hiver]`.'],
		['tags: [dessert, quebecois]\nseason: hiver', 'season', 'Write it as a list: `season: [hiver]`.'],
		['tags: [dessert, quebecois]\nseason: { a: 1 }', 'season', 'Write it as a list: `season: [automne, hiver]`.'],
		['tags: [dessert, quebecois]\nmedia: final.jpg', 'media', 'Write `media: { final: final.jpg }`.']
	])('fires on a list or mapping field holding a single value: %s', (to, path, fix) => {
		const ds = checkRecipe(edit('tags: [dessert, quebecois]', to)).diagnostics;
		expect(ds.map((d) => [d.code, d.path, d.fix])).toEqual([['E218', path, fix]]);
	});

	it('keeps a number in a text field as text', () => {
		const r = checkRecipe(edit('name: eau, note: bouillante', 'name: eau, note: 796'));
		expect(r.diagnostics).toEqual([]);
		expect(r.recipe?.ingredients[1].items[1].note).toBe('796');
	});
});

describe('E003 files merged into one', () => {
	const second = BASE.replace('title: Pouding chômeur', 'title: Pouding deux').replace('slug: pouding-chomeur', 'slug: pouding-deux');

	it('fires on bare files pasted one after the other', () => {
		const r = checkPaste(`${BASE}\n${second}`);
		expect(r.files).toHaveLength(1);
		const [d] = r.files[0].diagnostics.filter((x) => x.severity === 'error');
		expect(d.code).toBe('E003');
		expect(d.path).toBe('body.sections[0]');
		expect(d.fix).toContain('its own ```markdown fence');
	});

	it('an unclosed fence before the next opener is split, not merged', () => {
		const r = checkPaste('```markdown\n' + BASE + '\n```markdown\n' + second + '```\n');
		expect(r.files.map((f) => f.recipe?.title)).toEqual(['Pouding chômeur', 'Pouding deux']);
		expect(r.files.flatMap((f) => f.diagnostics)).toEqual([]);
	});

	it('leaves a horizontal rule alone', () => {
		expect(codes(edit('4. Cuire 40 min.', '4. Cuire 40 min.\n\n---\n\nservir chaud.'))).toEqual([]);
		expect(codes(`${BASE}\n---\n\nschema du montage : voir la photo.\n`)).toEqual([]);
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

	it.each([
		['Cuire à 350º, 40 min.', 350],
		['Bake at 350 degrees for 40 minutes.', 350],
		['Préchauffer le four à 375.', 375],
		['Four 350, 40 min.', 350],
		['Preheat the oven to 400.', 400]
	])('W609 on %s', (step, temp) => {
		const [d] = find(edit('oven: { temp: 350, unit: F }\n', '').replace('4. Cuire 40 min.', `4. ${step}`), 'W609');
		expect(d?.fix).toBe(`Add \`oven: { temp: ${temp}, unit: F }\`.`);
	});

	/** The base card with its numbered steps as `-` bullets. */
	const bullets = (text: string) => text.replace(/^\d+\. /gm, '- ');

	it('bullet steps are steps: no warning on the clean card', () => {
		expect(codes(bullets(BASE))).toEqual([]);
	});

	it('W402 and W609 see bullet step text', () => {
		expect(codes(bullets(edit('4. Cuire 40 min.', `4. ${'Cuire longtemps. '.repeat(30)}`)))).toEqual(['W402']);
		const [d] = find(bullets(edit('oven: { temp: 350, unit: F }\n', '').replace('4. Cuire 40 min.', '* Cuire à 375°F, 40 min.')), 'W609');
		expect(d?.path).toBe('body.steps[3]');
		expect(d?.fix).toBe('Add `oven: { temp: 375, unit: F }`.');
	});

	it('W403 when a method section has text but no steps', () => {
		const text = BASE.replace(/^\d+\. /gm, '');
		const [d] = find(text, 'W403');
		expect(d.path).toBe('body.sections[0]');
		expect(d.fix).toBe('Write each step as a numbered (`1.`) or `-` line.');
		expect(codes(text)).toEqual(['W403']);
	});

	it('no W403 for an empty method section or one with steps under a sub-heading', () => {
		const head = BASE.slice(0, BASE.indexOf('## Préparation'));
		expect(codes(`${head}## Préparation
`)).toEqual([]);
		expect(codes(`${head}## Préparation

### Pâte

- Mélanger.
`)).toEqual([]);
	});

	it('W403 names each method section without steps', () => {
		const head = BASE.slice(0, BASE.indexOf('## Préparation'));
		const text = `${head}## Tarte

### Préparation

Tout mélanger.

## Instructions

1. Cuire.
`;
		expect(find(text, 'W403').map((d) => d.path)).toEqual(['body.sections[1]']);
	});

	it('no E301 for a method heading under a title heading', () => {
		expect(codes(edit('## Préparation', '## Pouding\n\n### Préparation'))).toEqual([]);
	});

	it('E109 gives no guessed value for a bare number', () => {
		const [d] = find(edit('  cook: 40m', '  cook: 1.5'), 'E109');
		expect(d.fix).toBe('Durations are written `30m`, `1h`, `1h15m`; ranges `45m-50m`.');
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

describe('source.type', () => {
	it('is optional: a source with no type is valid and built without one', () => {
		const r = checkRecipe(edit('  type: family\n', ''));
		expect(r.diagnostics).toEqual([]);
		expect(r.recipe?.source).toEqual({ author: 'Grand-maman Lucienne' });
	});

	it('is still checked when present', () => {
		const [d] = find(edit('type: family', 'type: grand-mère'), 'E106');
		expect(d.path).toBe('source.type');
		expect(d.fix).toContain('leave `type` out');
	});
});

describe('E114 source.url', () => {
	it.each([
		['https://recettes.example.com/pouding'],
		['http://example.com'],
		['HTTPS://EXAMPLE.COM/A']
	])('accepts a web address: %s', (url) => {
		expect(codes(edit('  type: family\n', `  type: website\n  url: ${url}\n`))).toEqual([]);
	});

	it.each([
		['"javascript:alert(1)"', 'starting with `https://`'],
		['ftp://example.com/x', 'starting with `https://`'],
		['Recettes de chez nous', 'goes in `title`'],
		['www.example.com/tarte', 'Write the full address: `url: https://www.example.com/tarte`.'],
		['"https:// example.com"', 'starting with `https://`']
	])('rejects anything else: %s', (url, fix) => {
		const ds = find(edit('  type: family\n', `  type: website\n  url: ${url}\n`), 'E114');
		expect(ds.map((d) => d.path)).toEqual(['source.url']);
		expect(ds[0].fix).toContain(fix);
	});
});

describe('W504 season', () => {
	const seasons = (list: string) => checkRecipe(edit('tags: [dessert, quebecois]', `tags: [dessert, quebecois]\nseason: ${list}`));

	it('accepts the four seasons and their aliases', () => {
		const r = seasons('[printemps, été, Summer, fall, autumn, winter, "hiver [?]"]');
		expect(r.diagnostics.filter((d) => d.code !== 'W605')).toEqual([]);
	});

	it('warns on anything else, suggesting the closest season', () => {
		const ds = seasons('[hivers, noël]').diagnostics;
		expect(ds.map((d) => [d.code, d.path, d.severity])).toEqual([
			['W504', 'season[0]', 'warning'],
			['W504', 'season[1]', 'warning']
		]);
		expect(ds[0].fix).toMatch(/^Did you mean `hiver`\?/);
		expect(ds[1].fix).not.toContain('Did you mean');
	});
});
