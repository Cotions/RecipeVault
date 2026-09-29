// The checker behind the form's Save (plan 04, "What the form must
// guarantee"): every value the checker refuses keeps Save disabled on its own
// row and field — the form's own rules first, the checker's errors mapped back
// through `ids` as the net. One test per finding of the P2 review, plus the
// net itself. Invented recipes only.

import { describe, expect, it } from 'vitest';
import { checkerBlocks, formCheckBlocks, markerBlocks, markerIn, placeOf } from '../../../src/lib/form/check';
import { emptyForm, fromForm, toForm, type FormItem, type FormRecipe, type MethodSection } from '../../../src/lib/form/model';
import { addItem, blockOn, blocks, removeAt } from '../../../src/lib/form/rows';
import { codeText } from '../../../src/lib/i18n/diagnostics';
import { checkFile } from '../../../src/lib/vault/check';

function form(edit?: (f: FormRecipe, it: FormItem) => void): FormRecipe {
	const f = emptyForm({ ovenUnit: 'F' });
	f.title = 'Galettes inventées';
	Object.assign(f.groups[0].items[0], { qty: '1', unit: 'cup', name: 'beurre' });
	(f.sections[0] as MethodSection).rows[0].text = 'Mélanger.';
	edit?.(f, f.groups[0].items[0]);
	return f;
}

const method = (f: FormRecipe) => f.sections.find((s) => s.kind === 'method') as MethodSection;

function open(text: string): FormRecipe {
	const c = checkFile(text);
	expect(c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
	return toForm(c.recipe!, c.body!);
}

describe('the base form saves', () => {
	it('no block', () => expect(blocks(form())).toEqual([]));
});

describe('E210 / E211: a name the checker refuses', () => {
	it('a comma in the name, au goût', () => {
		const f = form((_, it) => Object.assign(it, { qty: '', unit: '', name: 'sel, poivre', toTaste: true }));
		const b = blockOn(blocks(f), f.groups[0].items[0].id, 'name');
		expect(b).toMatchObject({ reason: 'nameComma', code: 'E211' });
		// With a note the comma is a detail, not two ingredients.
		f.groups[0].items[0].note = 'moulu';
		expect(blocks(f)).toEqual([]);
	});

	it('a quantity with its unit in the name', () => {
		const f = form((_, it) => Object.assign(it, { qty: '1', unit: 'can', name: 'tomates 796 ml' }));
		expect(blockOn(blocks(f), f.groups[0].items[0].id, 'name')).toMatchObject({ reason: 'nameQuantity', code: 'E210' });
	});

	it('in a replacement (`or`) row, on that row', () => {
		const f = form();
		const o = addItem({ id: 'x', name: '', optional: false, items: f.groups[0].items[0].or, written: {} });
		Object.assign(o, { qty: '1', unit: 'cup', name: 'margarine, fondue' });
		expect(blockOn(blocks(f), o.id, 'name')).toMatchObject({ reason: 'nameComma' });
	});
});

describe('E216: a quantity in the note', () => {
	it('1/2 lb and environ 1 tasse, on the note field', () => {
		for (const note of ['1/2 lb', 'environ 1 tasse']) {
			const f = form((_, it) => (it.note = note));
			expect(blockOn(blocks(f), f.groups[0].items[0].id, 'note')).toMatchObject({ reason: 'noteQuantity', code: 'E216' });
		}
	});

	it('one size on a can is what the note is for', () => {
		const f = form((_, it) => Object.assign(it, { unit: 'can', name: 'tomates', note: '796 ml' }));
		expect(blocks(f)).toEqual([]);
	});
});

describe('E217: text she typed that reads as a marker', () => {
	it('an unknown bracket in a step, on its row', () => {
		const f = form();
		const row = method(f).rows[0];
		row.text = 'Cuire [voir note].';
		expect(blockOn(blocks(f), row.id, 'text')).toMatchObject({ reason: 'marker', value: '[voir note]' });
	});

	it('uncertainty in words in a step; brackets in a note', () => {
		const f = form((_, it) => (it.note = '[tamisée]'));
		const row = method(f).rows[0];
		row.text = 'Cuire 10 min; temps incertain selon le four.';
		const b = blocks(f);
		expect(blockOn(b, row.id, 'text')).toMatchObject({ reason: 'marker', value: 'incertain' });
		expect(blockOn(b, f.groups[0].items[0].id, 'note')).toMatchObject({ reason: 'marker', value: '[tamisée]' });
	});

	it('a marker typed by hand is refused too (Q15 A: she cannot add markers)', () => {
		const f = form((f) => (f.title = 'Galettes [?]'));
		expect(blockOn(blocks(f), 'recipe', 'title')).toMatchObject({ reason: 'marker', value: '[?]' });
		expect(markerIn('Cuire (voir la note).')).toBeUndefined();
		expect(markerIn('Un [lien](https://exemple.invalid)')).toBeUndefined();
	});

	it('a marker the file already held, untouched, is not hers to fix', () => {
		const f = open(`---\nschema: 3\ntitle: Galettes inventées\nslug: galettes-inventees\nlang: fr\ningredients:\n  - items:\n      - { qty: 1, unit: cup, name: "beurre [?]" }\n---\n\n## Préparation\n\n1. Cuire 10 min [+].\n`);
		expect(markerBlocks(f)).toEqual([]);
		expect(blocks(f)).toEqual([]);
	});

	it('the checker net maps a step error to its row, not only to the method', () => {
		const f = form();
		const m = method(f);
		m.rows.push({ id: 'r2', type: 'step', text: 'Cuire [voir note].', written: {} });
		expect(formCheckBlocks(f)).toContainEqual({ id: 'r2', field: 'text', reason: 'marker', code: 'E217' });
	});
});

describe('E108: servings are whole', () => {
	it('2,5 and 1.5 are refused on servings; a decimal maximum on its field', () => {
		for (const s of ['2,5', '1.5']) expect(blockOn(blocks(form((f) => (f.servings = s))), 'recipe', 'servings')?.reason).toBe('integer');
		expect(blockOn(blocks(form((f) => ((f.servings = '2'), (f.servingsMax = '3,5')))), 'recipe', 'servingsMax')?.reason).toBe('integer');
		expect(blocks(form((f) => ((f.servings = '4'), (f.servingsMax = '6'))))).toEqual([]);
	});
});

describe('E202 / E203 / E205: the yield amount', () => {
	const y = (edit: Partial<FormRecipe['yield']>) => form((f) => (f.yield = { kind: 'amount', text: '', qty: '', qtyMax: '', unit: '', note: '', ...edit }));
	it('a quantity without a unit, a unit without a quantity, a range going down', () => {
		expect(blockOn(blocks(y({ qty: '12' })), 'recipe', 'yield.unit')?.reason).toBe('unit');
		expect(blockOn(blocks(y({ unit: 'piece' })), 'recipe', 'yield.qty')?.reason).toBe('qty');
		expect(blockOn(blocks(y({ qty: '3', qtyMax: '2', unit: 'piece' })), 'recipe', 'yield.qtyMax')?.reason).toBe('range');
		expect(blocks(y({ qty: '2', qtyMax: '3', unit: 'piece' }))).toEqual([]);
	});

	it('the net places a yield error on the yield field', () => {
		expect(placeOf({ code: 'E203', path: 'yield' }, {})).toEqual({ id: 'recipe', field: 'yield.unit' });
		expect(placeOf({ code: 'E205', path: 'yield.qty_max' }, {})).toEqual({ id: 'recipe', field: 'yield.qtyMax' });
	});
});

describe('E205: the other measure (alt) range', () => {
	it('250 to 100 ml is refused on alt.qtyMax', () => {
		const f = form((_, it) => Object.assign(it, { name: 'farine', alt: { qty: '250', qtyMax: '100', unit: 'ml', written: {} } }));
		expect(blockOn(blocks(f), f.groups[0].items[0].id, 'alt.qtyMax')?.reason).toBe('range');
		f.groups[0].items[0].alt!.qtyMax = '300';
		expect(blocks(f)).toEqual([]);
	});
});

describe('E301: the method emptied beside a section the file does not know', () => {
	const TEXT = `---\nschema: 3\ntitle: Galettes inventées\nslug: galettes-inventees\nlang: fr\ningredients:\n  - items:\n      - { qty: 1, unit: cup, name: beurre }\n---\n\n## Préparation\n\n1. Mélanger.\n2. Cuire.\n\n## Conservation\n\nAu frais, une semaine.\n`;
	it('removing every step blocks Save on the method', () => {
		const f = open(TEXT);
		const m = method(f);
		while (m.rows.length) removeAt(m.rows, 0);
		expect(blockOn(blocks(f), m.id, 'steps')).toMatchObject({ reason: 'method' });
	});

	it('without the other section, an empty method is allowed (a warning only)', () => {
		const f = form();
		const m = method(f);
		m.rows[0].text = '';
		expect(blocks(f)).toEqual([]);
	});
});

describe('the oven maximum without a temperature', () => {
	it('is never dropped silently: a block, and fromForm reports it', () => {
		const f = form((f) => (f.oven = { temp: '', tempMax: '375', unit: 'F' }));
		expect(blockOn(blocks(f), 'recipe', 'oven.tempMax')?.reason).toBe('qty');
		expect(fromForm(f).errors).toContainEqual({ id: 'recipe', field: 'oven.tempMax', reason: 'qty' });
	});
});

describe('the net: any checker error is a named block', () => {
	it('a unit the picker cannot produce comes back on its field with its code', () => {
		const f = form((_, it) => ((it as { unit: string }).unit = 'tasse'));
		expect(blockOn(blocks(f), f.groups[0].items[0].id, 'unit')).toMatchObject({ reason: 'checker', code: 'E201' });
	});

	it('every code the net can name has a French line', () => {
		const f = form((_, it) => ((it as { unit: string }).unit = 'tasse'));
		for (const b of formCheckBlocks(f)) expect(codeText[b.code!]).toBeTruthy();
	});

	it('paths map to rows and fields', () => {
		const ids = { 'ingredients[0]': 'g', 'ingredients[0].items[1]': 'i', 'ingredients[0].items[1].or[0]': 'o', 'body.sections[1]': 's', method: 'm' };
		const at = (code: string, path: string | null) => placeOf({ code, path }, ids);
		expect(at('E216', 'ingredients[0].items[1].note')).toEqual({ id: 'i', field: 'note' });
		expect(at('E205', 'ingredients[0].items[1].alt.qty_max')).toEqual({ id: 'i', field: 'alt.qtyMax' });
		expect(at('E210', 'ingredients[0].items[1].or[0].name')).toEqual({ id: 'o', field: 'name' });
		expect(at('E203', 'ingredients[0].items[1]')).toEqual({ id: 'i', field: 'unit' });
		expect(at('E200', 'ingredients[0].items')).toEqual({ id: 'g', field: 'items' });
		expect(at('E217', 'body.sections[1]')).toEqual({ id: 's', field: 'text' });
		expect(at('E217', 'body.steps[3]')).toEqual({ id: 'm', field: 'text' });
		expect(at('E301', 'body.sections[0]')).toEqual({ id: 'm', field: 'steps' });
		expect(at('E108', 'servings_max')).toEqual({ id: 'recipe', field: 'servingsMax' });
		expect(at('E111', 'oven.temp_max')).toEqual({ id: 'recipe', field: 'oven.tempMax' });
		expect(at('E217', 'source.note')).toEqual({ id: 'recipe', field: 'source.note' });
		expect(checkerBlocks([{ code: 'W605', severity: 'warning', path: 'title', message: '' }], ids)).toEqual([]);
	});
});
