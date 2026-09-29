// Row operations and the structural rules of the form (plan 04, "What the form
// must guarantee"): the invalid states the form prevents instead of reporting.
// Pure functions over the form model, so the UI stays thin and the rules are
// tested without a browser. Browser-safe.

import { fold } from '../vault/normalize';
import { WEB_URL_RE } from '../vault/rules/source';
import { fromForm, newGroup, newItem, newRow, type FormGroup, type FormItem, type FormRecipe, type StepRow } from './model';
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
	| 'url';

export interface Block {
	/** Row id, group id, or `recipe`. */
	id: string;
	field: string;
	reason: BlockReason;
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
	it.or.forEach((o) => {
		if (o.name.trim() || o.qty.trim() || o.unit) itemBlocks(o, out);
	});
}

/**
 * Everything that keeps Save disabled, each on its field: the errors
 * `fromForm` reports (title, ingredients, names, quantities, durations) and
 * the rules the file format enforces that the form states before save (unit
 * with a quantity, range bounds, family with a variant, a name twice in one
 * group). Empty: the form can be saved.
 */
export function blocks(form: FormRecipe): Block[] {
	const out: Block[] = [];
	for (const e of fromForm(form).errors) out.push({ id: e.id, field: e.field, reason: (e.reason as BlockReason) ?? 'format' });
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
	// E114: a web address the file format accepts (the checker's own test).
	if (form.source.url.trim() && !WEB_URL_RE.test(form.source.url.trim())) out.push({ id: 'recipe', field: 'source.url', reason: 'url' });
	const t = parseNumberInput(form.oven.temp);
	const tm = parseNumberInput(form.oven.tempMax);
	if (t.ok && tm.ok && tm.value <= t.value) out.push({ id: 'recipe', field: 'oven.tempMax', reason: 'range' });
	// One block per field is enough to show.
	return out.filter((b, i) => out.findIndex((o) => o.id === b.id && o.field === b.field) === i);
}

/** The block on one field, if any. */
export const blockOn = (list: Block[], id: string, field: string) => list.find((b) => b.id === id && b.field === field);
