// What changed between two versions of a recipe file, field by field, for the
// history page (plan 04, Phase 7): both versions are parsed and put through the
// form model (`toForm`), so the comparison is on what she sees — text without
// marker syntax, quantities as shown — never on the Markdown. No Node import:
// the page could compute it in the browser too.

import { toForm, type FormItem, type FormRecipe, type FormSection } from '../form/model';
import { t, tagLabel } from '../i18n/fr';
import { checkFile } from '../vault/check';
import { stripMarkers } from '../vault/markers';
import type { Recipe } from '../vault/types';

/** A field the summary names without detail. */
export type Field =
	| 'family'
	| 'variant'
	| 'source'
	| 'times'
	| 'oven'
	| 'servings'
	| 'yield'
	| 'season'
	| 'difficulty'
	| 'rating'
	| 'lang'
	| 'groups'
	| 'notes'
	| 'variants'
	| 'alternatives'
	| 'text';

export type Change =
	| { kind: 'created' }
	| { kind: 'trashed' }
	| { kind: 'untrashed' }
	| { kind: 'renamed'; from: string }
	| { kind: 'deleted' }
	/** The version cannot be read by today's parser: nothing to compare. */
	| { kind: 'unreadable' }
	/** The file changed but nothing she sees did (the canonical rewrite of a first app save, `updated`). */
	| { kind: 'format' }
	| { kind: 'title'; from: string; to: string }
	| { kind: 'fields'; fields: Field[] }
	| { kind: 'tags'; added: string[]; removed: string[] }
	| { kind: 'ingredients'; added: string[]; removed: string[]; changed: string[] }
	| { kind: 'steps'; added: number; removed: number; changed: number; reordered: boolean }
	| { kind: 'photo'; action: 'added' | 'changed' | 'removed' }
	| { kind: 'verified'; now: boolean }
	| { kind: 'markers'; confirmed: number; added: number };

export interface Parsed {
	recipe: Recipe;
	form: FormRecipe;
}

/** A version's text parsed for comparison; null when today's checker cannot read it. */
export function parseVersion(text: string): Parsed | null {
	const f = checkFile(text);
	if (!f.recipe || !f.body) return null;
	return { recipe: f.recipe, form: toForm(f.recipe, f.body) };
}

/** Title of a version's text, even when it no longer passes the checker. */
export function titleOfText(text: string): string | undefined {
	const f = checkFile(text);
	const title = f.recipe?.title ?? f.frontmatter?.title;
	return typeof title === 'string' ? stripMarkers(title) : undefined;
}

/** A value with the form's client ids and `written` records dropped: what she sees. */
function seen(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(seen);
	if (v && typeof v === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, x] of Object.entries(v)) if (k !== 'id' && k !== 'written' && k !== 'original') out[k] = seen(x);
		return out;
	}
	return v;
}
const same = (a: unknown, b: unknown) => JSON.stringify(seen(a)) === JSON.stringify(seen(b));

const items = (f: FormRecipe): FormItem[] => f.groups.flatMap((g) => g.items);
const itemKey = (it: FormItem) => it.name.trim().toLocaleLowerCase('fr');

function ingredientChanges(a: FormRecipe, b: FormRecipe): Change | null {
	const before = new Map<string, FormItem[]>();
	for (const it of items(a)) before.set(itemKey(it), [...(before.get(itemKey(it)) ?? []), it]);
	const added: string[] = [];
	const changed: string[] = [];
	for (const it of items(b)) {
		const olds = before.get(itemKey(it));
		if (!olds?.length) {
			added.push(it.name);
			continue;
		}
		const i = olds.findIndex((o) => same(o, it));
		const old = olds.splice(i === -1 ? 0 : i, 1)[0];
		if (i === -1 && !same(old, it)) changed.push(it.name);
	}
	const removed = [...before.values()].flat().map((it) => it.name);
	return added.length || removed.length || changed.length ? { kind: 'ingredients', added, removed, changed } : null;
}

const stepTexts = (f: FormRecipe) =>
	f.sections.flatMap((s) => (s.kind === 'method' ? s.rows.filter((r) => r.type === 'step').map((r) => r.text.trim()) : []));

function stepChanges(a: FormRecipe, b: FormRecipe): Change | null {
	const x = stepTexts(a);
	const y = stepTexts(b);
	if (JSON.stringify(x) === JSON.stringify(y)) return null;
	const pool = [...x];
	let kept = 0;
	for (const s of y) {
		const i = pool.indexOf(s);
		if (i !== -1) {
			pool.splice(i, 1);
			kept++;
		}
	}
	const reordered = kept === x.length && kept === y.length;
	if (reordered) return { kind: 'steps', added: 0, removed: 0, changed: 0, reordered: true };
	const unmatchedOld = x.length - kept;
	const unmatchedNew = y.length - kept;
	const changed = Math.min(unmatchedOld, unmatchedNew);
	return { kind: 'steps', added: unmatchedNew - changed, removed: unmatchedOld - changed, changed, reordered: false };
}

const sectionText = (f: FormRecipe, kind: FormSection['kind']) =>
	f.sections
		.filter((s) => s.kind === kind)
		.map((s) => (s.kind === 'method' ? '' : s.text.trim()))
		.join('\n');
const otherText = (f: FormRecipe) => JSON.stringify([f.preamble.trim(), f.sections.filter((s) => s.kind === 'other').map(seen)]);

const uncertain = (r: Recipe) => r.markers.filter((m) => m.kind !== 'added').length;

/**
 * What changed from `before` to `after` (either may be null: a version the
 * parser cannot read). `textChanged` says whether the files differ at all, so
 * an invisible change reads "mise en forme" rather than nothing.
 */
export function diffVersions(before: Parsed | null, after: Parsed | null, textChanged = true): Change[] {
	if (!after || !before) return [{ kind: 'unreadable' }];
	const a = before.form;
	const b = after.form;
	const out: Change[] = [];
	if (a.title !== b.title) out.push({ kind: 'title', from: a.title, to: b.title });
	const fields: Field[] = [];
	const check = (field: Field, x: unknown, y: unknown) => {
		if (!same(x, y)) fields.push(field);
	};
	check('family', a.family, b.family);
	check('variant', a.variant, b.variant);
	check('source', a.source, b.source);
	check('times', a.times, b.times);
	check('oven', a.oven, b.oven);
	check('servings', [a.servings, a.servingsMax, a.servingsNote], [b.servings, b.servingsMax, b.servingsNote]);
	check('yield', a.yield, b.yield);
	check('season', [...a.season].sort(), [...b.season].sort());
	check('difficulty', a.difficulty, b.difficulty);
	check('rating', a.rating, b.rating);
	check('lang', a.lang, b.lang);
	check(
		'groups',
		a.groups.map((g) => [g.name, g.optional]),
		b.groups.map((g) => [g.name, g.optional])
	);
	if (fields.length) out.push({ kind: 'fields', fields });

	const tagsAdded = b.tags.filter((x) => !a.tags.includes(x));
	const tagsRemoved = a.tags.filter((x) => !b.tags.includes(x));
	if (tagsAdded.length || tagsRemoved.length) out.push({ kind: 'tags', added: tagsAdded, removed: tagsRemoved });

	const ing = ingredientChanges(a, b);
	if (ing) out.push(ing);
	const steps = stepChanges(a, b);
	if (steps) out.push(steps);

	const text: Field[] = [];
	for (const k of ['notes', 'variants', 'alternatives'] as const) if (sectionText(a, k) !== sectionText(b, k)) text.push(k);
	if (otherText(a) !== otherText(b)) text.push('text');
	if (text.length) out.push({ kind: 'fields', fields: text });

	const pa = a.media.final;
	const pb = b.media.final;
	if (pa !== pb) out.push({ kind: 'photo', action: !pa ? 'added' : !pb ? 'removed' : 'changed' });

	const va = before.recipe.status === 'verified';
	const vb = after.recipe.status === 'verified';
	if (va !== vb) out.push({ kind: 'verified', now: vb });

	const ua = uncertain(before.recipe);
	const ub = uncertain(after.recipe);
	if (ua !== ub) out.push({ kind: 'markers', confirmed: Math.max(0, ua - ub), added: Math.max(0, ub - ua) });

	if (!out.length && textChanged) out.push({ kind: 'format' });
	return out;
}

const list = (xs: string[]) => xs.map((x) => `« ${x} »`).join(', ');

/** One plain French line per change. */
export function describeChange(c: Change): string {
	const h = t.history.change;
	switch (c.kind) {
		case 'created':
			return h.created;
		case 'trashed':
			return h.trashed;
		case 'untrashed':
			return h.untrashed;
		case 'renamed':
			return h.renamed(c.from);
		case 'deleted':
			return h.deleted;
		case 'unreadable':
			return h.unreadable;
		case 'format':
			return h.format;
		case 'title':
			return h.title(c.from, c.to);
		case 'fields':
			return h.fields(c.fields.map((f) => h.field[f]));
		case 'tags':
			return [c.added.length ? h.tagsAdded(c.added.map((x) => tagLabel(x)).join(', ')) : '', c.removed.length ? h.tagsRemoved(c.removed.map((x) => tagLabel(x)).join(', ')) : '']
				.filter(Boolean)
				.join(' ; ');
		case 'ingredients':
			return [
				c.added.length ? h.ingredientsAdded(c.added.length, list(c.added)) : '',
				c.removed.length ? h.ingredientsRemoved(c.removed.length, list(c.removed)) : '',
				c.changed.length ? h.ingredientsChanged(c.changed.length, list(c.changed)) : ''
			]
				.filter(Boolean)
				.join(' ; ');
		case 'steps':
			if (c.reordered) return h.stepsReordered;
			return [c.added ? h.stepsAdded(c.added) : '', c.removed ? h.stepsRemoved(c.removed) : '', c.changed ? h.stepsChanged(c.changed) : '']
				.filter(Boolean)
				.join(' ; ');
		case 'photo':
			return h.photo[c.action];
		case 'verified':
			return c.now ? h.verified : h.unverified;
		case 'markers':
			return [c.confirmed ? h.markersConfirmed(c.confirmed) : '', c.added ? h.markersAdded(c.added) : ''].filter(Boolean).join(' ; ');
	}
}

export const describeChanges = (changes: Change[]): string[] => changes.map(describeChange);
