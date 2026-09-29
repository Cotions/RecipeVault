// The checker behind the form (plan 04, "What the form must guarantee"). The
// form states the file format's rules on its fields before save; this is the
// net under them. The form's text is checked by the checker itself, here in
// the browser as on the server, and every error it finds is mapped back to
// the row and field it came from (through `fromForm`'s `ids`), so an error
// the form's own rules missed keeps Save disabled on a named field instead of
// failing the save. Never a code on screen: a block carries its code for the
// French line and the log.
//
// Also here: text she typed that the file would read as a marker (E217, and a
// valid marker typed by hand, which Q15 A says she cannot add). Browser-safe.

import { checkFile } from '../vault/check';
import { findBadMarkers, MARKER_RE } from '../vault/markers';
import { serialize } from '../vault/serialize';
import { slugify } from '../vault/slug';
import type { Diagnostic } from '../vault/types';
import { hideMarkers } from './markers';
import { fromForm, type FormItem, type FormRecipe, type FromForm, type Written } from './model';
import type { Block, BlockReason } from './rows';

/**
 * What saving the form writes: `fromForm`, the slug set, the app's fields left
 * for the save path (a new recipe's slug from its title, `recette` if none).
 */
export function formFile(form: FormRecipe, slug?: string): FromForm & { text: string } {
	const r = fromForm(form);
	r.recipe.slug = slug ?? (form.slug || slugify(r.recipe.title) || 'recette');
	r.recipe.slugDerived = false;
	delete r.recipe.status;
	delete r.recipe.added;
	delete r.recipe.updated;
	return { ...r, text: serialize(r.recipe, r.body) };
}

// ---------------------------------------------------------------------------
// Diagnostic → field

/** The block reason for a checker code: a known one gets its own sentence, the rest `checker` (the code's French line). */
const REASONS: Record<string, BlockReason> = {
	E101: 'required',
	E105: 'variant',
	E108: 'integer',
	E111: 'format',
	E114: 'url',
	E200: 'required',
	E202: 'qty',
	E203: 'unit',
	E204: 'format',
	E205: 'range',
	E207: 'required',
	E209: 'duplicate',
	E210: 'nameQuantity',
	E211: 'nameComma',
	E214: 'incomplete',
	E216: 'noteQuantity',
	E217: 'marker',
	E301: 'method'
};

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const ROW_RE = /^(ingredients\[\d+\](?:\.items\[\d+\](?:\.or\[\d+\])*)?)(?:\.(.+))?$/;

/** The row id and form field a diagnostic's path points at (`recipe` for the form itself). */
export function placeOf(d: Pick<Diagnostic, 'code' | 'path'>, ids: Record<string, string>): { id: string; field: string } {
	const p = d.path;
	if (d.code === 'E301') return { id: ids.method ?? 'recipe', field: 'steps' };
	if (!p) return { id: 'recipe', field: 'recipe' };
	const row = p.match(ROW_RE);
	if (row) {
		const [, at, rest] = row;
		// An `or` entry missing from `ids` falls back to its item.
		const id = ids[at] ?? ids[at.replace(/(?:\.or\[\d+\])+$/, '')];
		if (!at.includes('.items[')) return { id: id ?? 'recipe', field: rest === 'group' ? 'name' : 'items' };
		const field = rest ? camel(rest.replace(/\[\d+\]/g, '')) : d.code === 'E203' ? 'unit' : d.code === 'E202' ? 'qty' : 'name';
		return { id: id ?? 'recipe', field };
	}
	if (p.startsWith('body.')) {
		if (p === 'body.preamble') return { id: 'recipe', field: 'preamble' };
		const step = p.match(/^body\.steps\[\d+\]/);
		if (step) return { id: ids[step[0]] ?? ids.method ?? 'recipe', field: 'text' };
		const sec = p.match(/^body\.sections\[\d+\]/);
		return { id: (sec && ids[sec[0]]) ?? 'recipe', field: 'text' };
	}
	if (p === 'yield') return { id: 'recipe', field: d.code === 'E203' ? 'yield.unit' : d.code === 'E202' ? 'yield.qty' : 'yield.text' };
	if (p === 'oven') return { id: 'recipe', field: 'oven.temp' };
	const top = p.match(/^(tags|season|media)\b/);
	if (top) return { id: 'recipe', field: top[1] };
	return { id: 'recipe', field: camel(p.replace(/\[\d+\]/g, '')) };
}

/** Checker errors as blocks, each on its field; warnings are not blocks. */
export function checkerBlocks(diagnostics: Diagnostic[], ids: Record<string, string>): Block[] {
	const out: Block[] = [];
	for (const d of diagnostics) {
		if (d.severity !== 'error') continue;
		let reason = REASONS[d.code] ?? 'checker';
		if (d.code === 'E108' && d.path === 'servings_max') reason = 'range';
		out.push({ ...placeOf(d, ids), reason, code: d.code });
	}
	return out;
}

/** The checker's errors on what saving the form would write (no vault: the server adds E103 / E213). */
export function formCheckBlocks(form: FormRecipe): Block[] {
	const { text, ids } = formFile(form);
	return checkerBlocks(checkFile(text).diagnostics, ids);
}

// ---------------------------------------------------------------------------
// Text she typed that reads as a marker

/**
 * What in text she typed the file would read as a marker: an unknown
 * `[…]`, uncertainty in words (`incertain`, `illisible`, `?)`) — E217 — or
 * one of the four markers typed by hand (Q15 A: she cannot add markers).
 * Undefined when the text is fine.
 */
export function markerIn(text: string): string | undefined {
	const bad = findBadMarkers(text)[0];
	if (bad) return bad.text;
	return text.match(new RegExp(MARKER_RE.source))?.[0];
}

/** The shown text, when she changed it (a field still showing the file's value is written as it was). */
function typed(written: Written, key: string, shown: string): string | undefined {
	const w = written[key];
	if (w !== undefined && hideMarkers(String(w)) === shown) return undefined;
	return shown.trim() ? shown : undefined;
}

/** Every text field she typed a marker into, on its row and field. */
export function markerBlocks(form: FormRecipe): Block[] {
	const out: Block[] = [];
	const check = (id: string, field: string, written: Written, key: string, shown: string) => {
		const t = typed(written, key, shown);
		const value = t === undefined ? undefined : markerIn(t);
		if (value !== undefined) out.push({ id, field, reason: 'marker', value });
	};
	const w = form.written;
	check('recipe', 'title', w, 'title', form.title);
	check('recipe', 'family', w, 'family', form.family);
	check('recipe', 'variant', w, 'variant', form.variant);
	for (const k of ['author', 'url', 'title', 'page', 'note'] as const) check('recipe', `source.${k}`, w, `source.${k}`, form.source[k]);
	check('recipe', 'servingsNote', w, 'servingsNote', form.servingsNote);
	if (form.yield.kind === 'text') check('recipe', 'yield.text', w, 'yield.text', form.yield.text);
	if (form.yield.kind === 'amount') check('recipe', 'yield.note', w, 'yield.note', form.yield.note);
	const item = (it: FormItem) => {
		for (const k of ['name', 'brand', 'note', 'prep'] as const) check(it.id, k, it.written, k, it[k]);
		it.or.forEach(item);
	};
	for (const g of form.groups) {
		check(g.id, 'name', g.written, 'name', g.name);
		g.items.forEach(item);
	}
	for (const s of form.sections) {
		if (s.kind === 'method') for (const r of s.rows) check(r.id, 'text', r.written, 'text', r.text);
		else if (s.kind !== 'other') check(s.id, 'text', s.written, 'text', s.text);
	}
	return out;
}
