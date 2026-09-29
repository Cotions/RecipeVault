// The form's rows and structural rules (plan 04, Phase 4: add, remove,
// reorder, the detail fields, "What the form must guarantee"), the live name
// hints (Q9 A) and the autosave slot (Q17 A) — the logic behind the form's
// components, without a browser.

import { describe, expect, it } from 'vitest';
import { applyNameHint, FORM_HINT_CODES, nameHint } from '../../../src/lib/form/hints';
import { emptyForm, fromForm, newItem, type FormItem, type FormRecipe } from '../../../src/lib/form/model';
import { addGroup, addItem, addStepRow, blockOn, blocks, move, removeAt, restoreAt, setToTaste, showGroups } from '../../../src/lib/form/rows';
import { clearDraft, draftKey, loadDraft, sameForm, saveDraft } from '../../../src/lib/form/draft';
import { formHintText } from '../../../src/lib/i18n/diagnostics';
import { seedCheckWords } from '../../../src/lib/server/vocab';
import { VOCAB_DOC } from '../../helpers/checkopts';

function form(edit?: (f: FormRecipe, it: FormItem) => void): FormRecipe {
	const f = emptyForm();
	f.title = 'Galettes';
	Object.assign(f.groups[0].items[0], { qty: '2', unit: 'cup', name: 'farine' });
	edit?.(f, f.groups[0].items[0]);
	return f;
}

describe('rows', () => {
	it('add, remove with undo, reorder', () => {
		const f = form();
		const g = f.groups[0];
		const b = addItem(g);
		b.name = 'sucre';
		const a = addItem(g, 0);
		a.name = 'sel';
		expect(g.items.map((i) => i.name)).toEqual(['farine', 'sel', 'sucre']);
		expect(move(g.items, 2, -1)).toBe(true);
		expect(g.items.map((i) => i.name)).toEqual(['farine', 'sucre', 'sel']);
		expect(move(g.items, 0, -1)).toBe(false);
		const removed = removeAt(g.items, 1)!;
		expect(g.items.map((i) => i.name)).toEqual(['farine', 'sel']);
		restoreAt(g.items, removed);
		expect(g.items.map((i) => i.name)).toEqual(['farine', 'sucre', 'sel']);
	});

	it('steps and section titles are rows; reordering renumbers', () => {
		const f = form();
		const m = f.sections[0];
		if (m.kind !== 'method') throw new Error('no method');
		m.rows[0].text = 'Mélanger.';
		addStepRow(m.rows).text = 'Cuire.';
		addStepRow(m.rows, 'heading', 0).text = 'Glaçage';
		addStepRow(m.rows).text = 'Glacer.';
		move(m.rows, 1, 1);
		expect(fromForm(f).body.sections[0].text).toBe('1. Mélanger.\n2. Cuire.\n\n### Glaçage\n\n3. Glacer.');
	});

	it('the group UI shows only once there is a second group (or a named one)', () => {
		const f = form();
		expect(showGroups(f)).toBe(false);
		addGroup(f);
		expect(showGroups(f)).toBe(true);
		f.groups.pop();
		f.groups[0].name = 'Pâte';
		expect(showGroups(f)).toBe(true);
	});
});

describe('what keeps Save disabled', () => {
	it('an empty form: title and an ingredient', () => {
		const f = emptyForm();
		const b = blocks(f);
		expect(blockOn(b, 'recipe', 'title')).toBeTruthy();
		expect(blockOn(b, 'recipe', 'ingredients')).toBeTruthy();
		expect(blocks(form())).toEqual([]);
	});

	it('a quantity needs a unit, a unit a quantity (E202 / E203)', () => {
		expect(blockOn(blocks(form((_, it) => (it.unit = ''))), form().groups[0].items[0].id, 'unit')).toBeUndefined();
		const f = form((_, it) => (it.unit = ''));
		expect(blockOn(blocks(f), f.groups[0].items[0].id, 'unit')?.reason).toBe('unit');
		const g = form((_, it) => (it.qty = ''));
		expect(blockOn(blocks(g), g.groups[0].items[0].id, 'qty')?.reason).toBe('qty');
	});

	it('au goût clears and disables the amount (E206)', () => {
		const f = form();
		const it = f.groups[0].items[0];
		it.qtyMax = '3';
		setToTaste(it, true);
		expect([it.qty, it.qtyMax, it.unit]).toEqual(['', '', '']);
		expect(blocks(f)).toEqual([]);
		expect(fromForm(f).recipe.ingredients[0].items[0]).toEqual({ name: 'farine', toTaste: true });
	});

	it('a range: the upper bound above the lower (E205), never alone', () => {
		const f = form((_, it) => (it.qtyMax = '1 ½'));
		expect(blockOn(blocks(f), f.groups[0].items[0].id, 'qtyMax')?.reason).toBe('range');
		f.groups[0].items[0].qtyMax = '2 ½';
		expect(blocks(f)).toEqual([]);
		f.groups[0].items[0].qty = '';
		expect(blockOn(blocks(f), f.groups[0].items[0].id, 'qtyMax')?.reason).toBe('qty');
	});

	it('a quantity she cannot write is flagged on its field', () => {
		const f = form((_, it) => (it.qty = 'deux'));
		expect(blockOn(blocks(f), f.groups[0].items[0].id, 'qty')).toBeTruthy();
	});

	it('the same name twice in a group (E209); in two groups is fine', () => {
		const f = form();
		const dup = addItem(f.groups[0]);
		Object.assign(dup, { qty: '1', unit: 'cup', name: 'Farine' });
		expect(blockOn(blocks(f), dup.id, 'name')?.reason).toBe('duplicate');
		f.groups[0].items.pop();
		const g = addGroup(f);
		Object.assign(g.items[0], { qty: '1', unit: 'cup', name: 'farine' });
		expect(blocks(f)).toEqual([]);
	});

	it('a family needs a variant (E105); servings and oven ranges go up', () => {
		const f = form((f) => (f.family = 'galettes'));
		expect(blockOn(blocks(f), 'recipe', 'variant')).toBeTruthy();
		f.variant = 'au sarrasin';
		f.servings = '6';
		f.servingsMax = '4';
		f.oven = { temp: '350', tempMax: '325', unit: 'F' };
		const b = blocks(f);
		expect(blockOn(b, 'recipe', 'servingsMax')?.reason).toBe('range');
		expect(blockOn(b, 'recipe', 'oven.tempMax')?.reason).toBe('range');
	});

	it('an oven temperature needs its unit; a duration range goes up', () => {
		const f = form((f) => {
			f.oven = { temp: '350', tempMax: '', unit: '' };
			f.times.cook = { hours: null, minutes: 40, maxHours: null, maxMinutes: 30 };
		});
		const b = blocks(f);
		expect(blockOn(b, 'recipe', 'oven.unit')).toBeTruthy();
		expect(blockOn(b, 'recipe', 'times.cook')?.reason).toBe('range');
	});
});

describe('name hints (Q9 A)', () => {
	const words = seedCheckWords(VOCAB_DOC);

	it('a preparation word moves to préparation in one tap', () => {
		const it = newItem();
		it.name = 'oignon haché';
		const h = nameHint(it.name, words)!;
		expect(h).toMatchObject({ code: 'W302', field: 'prep', word: 'haché', rest: 'oignon' });
		it.prep = 'finement';
		applyNameHint(it, h);
		expect([it.name, it.prep]).toEqual(['oignon', 'haché, finement']);
		expect(nameHint(it.name, words)).toBeUndefined();
	});

	it('a size goes to the note, a brand to the brand', () => {
		expect(nameHint('oignon moyen', words)).toMatchObject({ code: 'W304', field: 'note', word: 'moyen' });
		expect(nameHint('farine', words)).toBeUndefined();
		expect(nameHint('farine', undefined)).toBeUndefined();
	});

	it('every code the form maps has a French text', () => {
		for (const code of FORM_HINT_CODES) expect(formHintText[code], code).toBeTruthy();
	});
});

describe('autosave slot (Q17 A)', () => {
	class Mem {
		m = new Map<string, string>();
		getItem = (k: string) => this.m.get(k) ?? null;
		setItem = (k: string, v: string) => void this.m.set(k, v);
		removeItem = (k: string) => void this.m.delete(k);
	}

	it('saves, loads back, clears; one slot per recipe and one for a new one', () => {
		const s = new Mem() as unknown as Storage;
		const f = form();
		expect(draftKey()).not.toBe(draftKey('galettes'));
		saveDraft(s, draftKey('galettes'), { form: f, hash: 'h', at: 1 });
		const d = loadDraft(s, draftKey('galettes'))!;
		expect(d.hash).toBe('h');
		expect(sameForm(d.form, f)).toBe(true);
		expect(loadDraft(s, draftKey())).toBeUndefined();
		clearDraft(s, draftKey('galettes'));
		expect(loadDraft(s, draftKey('galettes'))).toBeUndefined();
	});

	it('ignores what it cannot read, and compares forms without their ids', () => {
		const s = new Mem() as unknown as Storage;
		s.setItem(draftKey(), '{nope');
		expect(loadDraft(s, draftKey())).toBeUndefined();
		const a = form();
		const b = form();
		expect(a.groups[0].id).not.toBe(b.groups[0].id);
		expect(sameForm(a, b)).toBe(true);
		b.title = 'Autre';
		expect(sameForm(a, b)).toBe(false);
	});
});
