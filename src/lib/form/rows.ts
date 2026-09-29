// Row operations and the structural rules of the form (plan 04, "What the form
// must guarantee"): the invalid states the form prevents instead of reporting.
// Pure functions over the form model, so the UI stays thin and the rules are
// tested without a browser. Browser-safe.

import { fold } from '../vault/normalize';
import { WEB_URL_RE } from '../vault/rules/source';
import { newGroup, newItem, newRow, type FormGroup, type FormItem, type FormRecipe, type StepRow } from './model';
import { checkFile } from '../vault/check';
import { checkerBlocks, formFile, markerBlocks } from './check';
import { parseNumberInput, parseQuantityInput } from './quantity';
import type { RowType } from './steps';

/** Move the element at `i` by `by` (−1 up, +1 down); nothing at an edge. */
export function move<T>(list: T[], i: number, by: -1 | 1): boolean {
	const j = i + by;
	if (i < 0 || j < 0 || i >= list.length || j >= list.length) return false;
	[list[i], list[j]] = [list[j], list[i]];
	return true;
}

/** Add an empty ingredient row after `after` (or at the end); returns it. */
export function addItem(group: FormGroup, after?: number): FormItem {
	const it = newItem();
	group.items.splice(after === undefined ? group.items.length : after + 1, 0, it);
	return it;
}

/** Remove a row; returns what is needed to put it back (the form's own undo, before save). */
export function removeAt<T>(list: T[], i: number): { item: T; index: number } | undefined {
	if (i < 0 || i >= list.length) return undefined;
	const [item] = list.splice(i, 1);
	return { item, index: i };
}

export function restoreAt<T>(list: T[], removed: { item: T; index: number }): void {
	list.splice(Math.min(removed.index, list.length), 0, removed.item);
}

/** A new group (with one empty row), after the others. */
export function addGroup(form: FormRecipe): FormGroup {
	const g = newGroup();
	form.groups.push(g);
	return g;
}

export function addStepRow(rows: StepRow[], type: RowType = 'step', after?: number): StepRow {
	const r = newRow(type);
	rows.splice(after === undefined ? rows.length : after + 1, 0, r);
	return r;
}

/** The group UI shows once there is more than one group, or the only one has a name or is optional. */
export const showGroups = (form: FormRecipe) => form.groups.length > 1 || form.groups.some((g) => g.name.trim() || g.optional);

/** "Au goût": no amount (E206). Checking it clears the quantity and the unit. */
export function setToTaste(item: FormItem, on: boolean): void {
	item.toTaste = on;
	if (on) {
		item.qty = '';
		item.qtyMax = '';
		item.unit = '';
		item.alt = null;
	}
}

// ---------------------------------------------------------------------------
// What keeps Save disabled

export type BlockReason =
	| 'required'
	| 'unit'
	| 'qty'
	| 'format'
	| 'range'
	| 'duplicate'
	| 'variant'
	| 'fraction'
	| 'zero'
	| 'incomplete'
	| 'url'
	/** Servings: a whole number (E108). */
	| 'integer'
	/** A quantity with its unit in the name (E210): it goes in the amount. */
	| 'nameQuantity'
	/** A comma in the name with no note or preparation (E211): two ingredients, or a detail for the note. */
	| 'nameComma'
	/** A quantity with its unit in the note (E216): it goes in the amount, or in a replacement. */
	| 'noteQuantity'
	/** Text the file would read as a marker (E217, or a marker typed by hand, Q15 A); `value` holds it. */
	| 'marker'
	/** The method emptied while another section remains (E301). */
	| 'method'
	/** Any other checker error: `code` names it, its French line is `explain(code)`. */
	| 'checker';

export interface Block {
	/** Row id (item, `or` entry, step row), group id, section id, or `recipe`. */
	id: string;
	field: string;
	reason: BlockReason;
	/** The checker's code, when the block comes from the checker (for the French line, never shown as is). */
	code?: string;
	/** The words at fault, as she typed them (`marker`). */
	value?: string;
}

const qtyOk = (s: string) => !s.trim() || parseQuantityInput(s).ok;
const qtyValue = (s: string) => {
	const q = parseQuantityInput(s);
	return q.ok ? q.value : undefined;
};

function itemBlocks(it: FormItem, out: Block[]): void {
	const push = (field: string, reason: BlockReason) => out.push({ id: it.id, field, reason });
	const hasQty = !!it.qty.trim();
	if (!qtyOk(it.qty)) push('qty', 'format');
	if (!qtyOk(it.qtyMax)) push('qtyMax', 'format');
	if (!it.toTaste) {
		// A quantity needs a unit and a unit a quantity (E202 / E203).
		if (hasQty && !it.unit) push('unit', 'unit');
		if (!hasQty && it.unit && it.name.trim()) push('qty', 'qty');
	}
	if (it.qtyMax.trim()) {
		const a = qtyValue(it.qty);
		const b = qtyValue(it.qtyMax);
		if (!hasQty) push('qtyMax', 'qty');
		else if (a !== undefined && b !== undefined && b <= a) push('qtyMax', 'range');
	}
	if (it.alt && (it.alt.qty.trim() || it.alt.unit) && !(it.alt.qty.trim() && it.alt.unit && qtyOk(it.alt.qty))) push('alt', 'incomplete');
	if (it.alt?.qtyMax.trim()) {
		const a = qtyValue(it.alt.qty);
		const b = qtyValue(it.alt.qtyMax);
		if (a !== undefined && b !== undefined && b <= a) push('alt.qtyMax', 'range');
	}
	it.or.forEach((o) => {
		if (o.name.trim() || o.qty.trim() || o.unit) itemBlocks(o, out);
	});
}

/**
 * Everything that keeps Save disabled, each on its field: the errors
 * `fromForm` reports (title, ingredients, names, quantities, durations), the
 * rules the file format enforces that the form states before save (unit
 * with a quantity, range bounds, family with a variant, a name twice in one
 * group, whole servings, a marker typed in text), then — the net — every
 * error the checker still finds in what Save would write, on its field
 * (`formCheckBlocks`). Empty: the form can be saved. The server runs the same
 * before it writes (`formSave`).
 */
export function blocks(form: FormRecipe): Block[] {
	const out: Block[] = [];
	const file = formFile(form);
	for (const e of file.errors) out.push({ id: e.id, field: e.field, reason: (e.reason as BlockReason) ?? 'format' });
	for (const g of form.groups) {
		const seen = new Map<string, string>();
		for (const it of g.items) {
			itemBlocks(it, out);
			const k = fold(it.name).trim();
			if (!k) continue;
			if (seen.has(k)) out.push({ id: it.id, field: 'name', reason: 'duplicate' });
			else seen.set(k, it.id);
		}
	}
	if (form.family.trim() && !form.variant.trim()) out.push({ id: 'recipe', field: 'variant', reason: 'variant' });
	if (!form.family.trim() && form.variant.trim()) out.push({ id: 'recipe', field: 'family', reason: 'required' });
	const s = parseNumberInput(form.servings);
	const sm = parseNumberInput(form.servingsMax);
	if (form.servingsMax.trim() && !form.servings.trim()) out.push({ id: 'recipe', field: 'servingsMax', reason: 'qty' });
	else if (s.ok && sm.ok && sm.value <= s.value) out.push({ id: 'recipe', field: 'servingsMax', reason: 'range' });
	// E108: servings are a whole number (the number input takes 2,5 for the oven's sake).
	if (s.ok && !Number.isInteger(s.value)) out.push({ id: 'recipe', field: 'servings', reason: 'integer' });
	if (sm.ok && !Number.isInteger(sm.value)) out.push({ id: 'recipe', field: 'servingsMax', reason: 'integer' });
	// The yield's amount follows the ingredient rules (E202 / E203 / E205).
	if (form.yield.kind === 'amount') {
		const y = form.yield;
		const has = !!y.qty.trim();
		if (has && !y.unit) out.push({ id: 'recipe', field: 'yield.unit', reason: 'unit' });
		if (!has && y.unit) out.push({ id: 'recipe', field: 'yield.qty', reason: 'qty' });
		if (y.qtyMax.trim()) {
			const a = qtyValue(y.qty);
			const b = qtyValue(y.qtyMax);
			if (!has) out.push({ id: 'recipe', field: 'yield.qtyMax', reason: 'qty' });
			else if (a !== undefined && b !== undefined && b <= a) out.push({ id: 'recipe', field: 'yield.qtyMax', reason: 'range' });
		}
	}
	// E114: a web address the file format accepts (the checker's own test).
	if (form.source.url.trim() && !WEB_URL_RE.test(form.source.url.trim())) out.push({ id: 'recipe', field: 'source.url', reason: 'url' });
	const t = parseNumberInput(form.oven.temp);
	const tm = parseNumberInput(form.oven.tempMax);
	if (t.ok && tm.ok && tm.value <= t.value) out.push({ id: 'recipe', field: 'oven.tempMax', reason: 'range' });
	// E301: the method emptied while a section the file does not recognize remains.
	const method = form.sections.find((x) => x.kind === 'method');
	if (method && form.sections.some((x) => x.kind === 'other') && !file.body.sections.some((x) => x.kind === 'method')) out.push({ id: method.id, field: 'steps', reason: 'method' });
	out.push(...markerBlocks(form));
	// The net: what the checker still refuses in what Save would write.
	out.push(...checkerBlocks(checkFile(file.text).diagnostics, file.ids));
	// One block per field is enough to show.
	return out.filter((b, i) => out.findIndex((o) => o.id === b.id && o.field === b.field) === i);
}

/** The block on one field, if any. */
export const blockOn = (list: Block[], id: string, field: string) => list.find((b) => b.id === id && b.field === field);
