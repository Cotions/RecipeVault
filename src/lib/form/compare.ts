// A stale save side by side (plan 04, Q18 A): her version and the other one,
// field by field, as plain lines she can read — never the file. Browser-safe.

import { unitLabel } from '../render/ingredient';
import { hideMarkers } from './markers';
import type { FormDuration } from './duration';
import type { FormItem, FormRecipe } from './model';

export type CompareKey =
	| 'title'
	| 'family'
	| 'tags'
	| 'times'
	| 'oven'
	| 'servings'
	| 'source'
	| 'ingredient'
	| 'step'
	| 'notes'
	| 'variants'
	| 'alternatives'
	| 'photo';

export interface CompareRow {
	key: CompareKey;
	/** 1-based, for `ingredient` and `step`. */
	n?: number;
	mine: string;
	theirs: string;
}

function item(it: FormItem): string {
	const amount = it.qty + (it.qtyMax ? ` à ${it.qtyMax}` : '');
	const unit = it.unit ? unitLabel(it.unit, 2, 'fr') : '';
	const parts = [amount, unit, it.name].filter(Boolean).join(' ');
	return [parts, it.prep, it.note].filter(Boolean).join(', ') + (it.toTaste ? ' (au goût)' : '') + (it.optional ? ' (facultatif)' : '');
}

function items(f: FormRecipe): string[] {
	return f.groups.flatMap((g) => [...(g.name ? [`— ${g.name}`] : []), ...g.items.filter((i) => i.name.trim()).map(item)]);
}

function steps(f: FormRecipe): string[] {
	const m = f.sections.find((s) => s.kind === 'method');
	return m && m.kind === 'method' ? m.rows.filter((r) => r.text.trim()).map((r) => (r.type === 'heading' ? `— ${r.text}` : r.text)) : [];
}

function text(f: FormRecipe, kind: 'notes' | 'variants' | 'alternatives'): string {
	const s = f.sections.find((x) => x.kind === kind);
	return s && s.kind === kind ? s.text.trim() : '';
}

function dur(d: FormDuration): string {
	const one = (h: number | null, m: number | null) => [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
	const a = one(d.hours, d.minutes);
	const b = one(d.maxHours, d.maxMinutes);
	return a && b ? `${a} à ${b}` : a;
}

function times(f: FormRecipe): string {
	const t = f.times;
	return [
		['prép.', t.prep],
		['cuisson', t.cook],
		['repos', t.rest],
		['total', t.total]
	]
		.map(([k, d]) => (dur(d as FormDuration) ? `${k} ${dur(d as FormDuration)}` : ''))
		.filter(Boolean)
		.join(', ');
}

const oven = (f: FormRecipe) => (f.oven.temp ? `${f.oven.temp}${f.oven.tempMax ? ` à ${f.oven.tempMax}` : ''} °${f.oven.unit}` : '');
const servings = (f: FormRecipe) =>
	[f.servings + (f.servingsMax ? ` à ${f.servingsMax}` : ''), f.servingsNote, f.yield.kind === 'text' ? f.yield.text : f.yield.kind === 'amount' ? [f.yield.qty, f.yield.unit && unitLabel(f.yield.unit, 2, 'fr'), f.yield.note].filter(Boolean).join(' ') : '']
		.filter((s) => s.trim())
		.join(', ');
const source = (f: FormRecipe) => [f.source.author, f.source.title, f.source.page && `p. ${f.source.page}`, f.source.url, f.source.note].filter(Boolean).join(', ');

/** Every field where the two versions differ, in form order. Empty: they hold the same. */
export function compareForms(mine: FormRecipe, theirs: FormRecipe): CompareRow[] {
	const out: CompareRow[] = [];
	const add = (key: CompareKey, a: string, b: string, n?: number) => {
		a = hideMarkers(a);
		b = hideMarkers(b);
		if (a !== b) out.push({ key, ...(n ? { n } : {}), mine: a, theirs: b });
	};
	add('title', mine.title, theirs.title);
	add('family', [mine.family, mine.variant].filter(Boolean).join(' : '), [theirs.family, theirs.variant].filter(Boolean).join(' : '));
	add('tags', mine.tags.join(', '), theirs.tags.join(', '));
	add('times', times(mine), times(theirs));
	add('oven', oven(mine), oven(theirs));
	add('servings', servings(mine), servings(theirs));
	add('source', source(mine), source(theirs));
	const [ia, ib] = [items(mine), items(theirs)];
	for (let i = 0; i < Math.max(ia.length, ib.length); i++) add('ingredient', ia[i] ?? '', ib[i] ?? '', i + 1);
	const [sa, sb] = [steps(mine), steps(theirs)];
	for (let i = 0; i < Math.max(sa.length, sb.length); i++) add('step', sa[i] ?? '', sb[i] ?? '', i + 1);
	for (const k of ['notes', 'variants', 'alternatives'] as const) add(k, text(mine, k), text(theirs, k));
	add('photo', mine.media.final ?? '', theirs.media.final ?? '');
	return out;
}
