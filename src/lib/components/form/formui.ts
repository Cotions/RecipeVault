// Small pure helpers of the recipe form's components (plan 04, Phases 4–5),
// kept out of the .svelte files so they can be unit-tested. Browser-safe.

import type { Block, Draft, FormItem, FormRecipe, Mark } from '../../form';
import { sameForm } from '../../form/draft';
import { formFile } from '../../form/check';
import { form as f } from '../../i18n';
import { explain } from '../../i18n/diagnostics';

/**
 * "Autre lecture" (Q15 A): the field's shown text with the marked span
 * replaced by its other reading — the rest of the field kept as it is.
 */
export function withAlternative(text: string, mark: Pick<Mark, 'start' | 'end' | 'alternative'>): string {
	if (mark.alternative === undefined) return text;
	return text.slice(0, mark.start) + mark.alternative + text.slice(mark.end);
}

/** The W608 pair offer she accepted: the other recipe and her variant name for it. */
export interface DraftPair {
	slug: string;
	hash: string;
	title: string;
	variant: string;
}

/** A draft of the form (Q17 A) with what she chose beside the form: a new family's label, a W608 pair. */
export interface FormDraft extends Draft {
	familyLabel?: string;
	pair?: DraftPair;
}

/**
 * Whether a draft holds something beyond the form she opened. A draft that
 * writes the very file the form was opened from (an empty row more, « 1/2 »
 * for « ½ », or the edit saved since from another device) holds nothing:
 * no « brouillon trouvé » for it (usability round 5). A draft the form cannot
 * write whole (a box still to fix) is compared as typed.
 */
export function draftDiffers(d: Pick<FormDraft, 'form' | 'familyLabel' | 'pair'>, initial: FormRecipe): boolean {
	if (d.familyLabel || d.pair) return true;
	if (sameForm(d.form, initial)) return false;
	try {
		const mine = formFile(d.form);
		return mine.errors.length > 0 || mine.text !== formFile(initial).text;
	} catch {
		return true;
	}
}

/** The draft to write: the form, the extras only when set. */
export function packDraft(form: FormRecipe, extras: { hash?: string; familyLabel: string; pair: DraftPair | null }, at: number): FormDraft {
	return {
		form,
		...(extras.hash ? { hash: extras.hash } : {}),
		...(extras.familyLabel ? { familyLabel: extras.familyLabel } : {}),
		...(extras.pair ? { pair: { ...extras.pair } } : {}),
		at
	};
}

/** The extras of a loaded draft, checked (a draft is data from the device, not trusted). */
export function unpackDraft(d: FormDraft): { familyLabel: string; pair: DraftPair | null } {
	const p = d.pair;
	const pair =
		p && typeof p === 'object' && typeof p.slug === 'string' && typeof p.hash === 'string' && typeof p.title === 'string' && typeof p.variant === 'string'
			? { slug: p.slug, hash: p.hash, title: p.title, variant: p.variant }
			: null;
	return { familyLabel: typeof d.familyLabel === 'string' ? d.familyLabel : '', pair };
}

/**
 * Enter in a single-line field must not save the recipe (implicit form
 * submission): only the Enregistrer button saves.
 */
export function blocksImplicitSubmit(key: string, target: { tagName?: string; type?: string } | null): boolean {
	if (key !== 'Enter' || !target || target.tagName !== 'INPUT') return false;
	return !['submit', 'button', 'reset', 'image', 'file'].includes((target.type ?? 'text').toLowerCase());
}

/** The fractions a phone keyboard lacks (plan 04, Q7 A). */
export const FRACTIONS = ['¼', '⅓', '½', '⅔', '¾'] as const;

/** A fraction chip on a quantity: after a whole number (« 1 » → « 1 ½ »), else in place of the fraction or the box. */
export function withFraction(value: string, g: string): string {
	const v = value.trim().replace(/\s*[¼⅓½⅔¾]$/, '');
	return /^\d+$/.test(v) ? `${v} ${g}` : g;
}

/**
 * Enter in a step box (round 2 of the usability pass): with the caret at the
 * end of a step that has text, 'next' (the next step, focused); in an empty
 * step, 'stay' (no blank line, no new row); anywhere else — Maj+Entrée, the
 * caret inside the text, a selection, an IME composing, Ctrl/⌘ (Enregistrer)
 * — null: the box's own Enter (a new line).
 */
export function stepEnter(
	e: { key: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; isComposing?: boolean },
	el: { value: string; selectionStart: number | null; selectionEnd: number | null }
): 'next' | 'stay' | null {
	if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return null;
	if (!el.value.trim()) return 'stay';
	const at = el.selectionStart;
	if (at === null || at !== el.selectionEnd || el.value.slice(at).trim()) return null;
	return 'next';
}

/**
 * What a number field of a duration shows: the number, nothing when empty,
 * and what she typed when it is not a number (never "NaN").
 */
export function durationText(value: number | null, typed: string | undefined): string {
	if (value === null) return '';
	if (Number.isNaN(value)) return typed ?? '';
	return String(value);
}

/**
 * The French line next to a blocked field: the form's own sentence for its
 * reason, the words at fault for a marker, the checker's line for any other
 * checker error (never its code).
 */
export function blockText(b: Block | undefined): string | undefined {
	if (!b) return undefined;
	if (b.reason === 'marker') return f.fieldMarker(b.value ?? '[…]');
	if (b.reason === 'checker') return b.code ? explain(b.code) : f.blocks.other;
	// The recipe's own required fields have their own line (« Il manque le titre. »), not an ingredient's.
	if (b.id === 'recipe' && b.reason === 'required' && f.fieldRequired[b.field]) return f.fieldRequired[b.field];
	return f.field[b.reason] ?? f.field.format;
}

/** The browser's blocks and the server's (the vault check, a refused save), one per field. */
export function mergeBlocks(mine: Block[], server: Block[]): Block[] {
	const out = [...mine];
	for (const b of server) if (!out.some((o) => o.id === b.id && o.field === b.field)) out.push(b);
	return out;
}

/** The key of a block's line in `f.blocks` (and `f.missing` / `f.fix`); undefined for a checker error or a marker. */
function reasonKey(b: Block): string | undefined {
	if (b.reason === 'checker' || b.reason === 'marker') return undefined;
	return (
		b.field === 'title' || b.field === 'ingredients' || b.field === 'variant' || b.field === 'family' || b.field === 'items'
			? b.field
			: b.field.startsWith('times.') && b.reason !== 'range'
				? 'time'
				: b.field === 'oven.unit'
				? 'oven'
				: b.field === 'source.url'
					? 'url'
					: b.reason === 'required' && b.field === 'name'
						? 'name'
						: b.reason === 'fraction' || b.reason === 'zero'
							? 'format'
							: b.reason === 'incomplete'
								? 'unit'
								: b.reason);
}

/** The short line in the save bar for one block (what keeps Save disabled). */
export function reasonLine(b: Block): string {
	if (b.reason === 'checker') return b.code ? explain(b.code) : f.blocks.other;
	if (b.reason === 'marker') return f.blocks.marker;
	const k = reasonKey(b)!;
	return f.blocks[k] ?? (b.code ? explain(b.code) : f.blocks.other);
}

/** What is missing (a title, an ingredient) rather than wrong. */
const MISSING = new Set(['title', 'ingredients', 'name', 'unit', 'qty', 'variant', 'family', 'items']);

/**
 * One block as the save bar's sentence says it (« Il manque : un titre, un
 * ingrédient. À corriger : un temps. »): a few words, and whether it is
 * missing or to fix. A checker error the form has no words for is « un champ
 * signalé »; its own sentence is on its field.
 */
export function reasonShort(b: Pick<Block, 'reason' | 'field'> & { code?: string }): { missing: boolean; text: string } {
	if (b.reason === 'marker') return { missing: false, text: f.fix.marker };
	const k = b.reason === 'checker' ? undefined : reasonKey(b as Block);
	if (k && MISSING.has(k) && f.missing[k]) return { missing: true, text: f.missing[k] };
	return { missing: false, text: (k && f.fix[k]) || f.fix.other };
}

/** The save bar's sentence parts, each kind once per wording, missing first. */
export function reasonGroups<T extends { block: Pick<Block, 'reason' | 'field'> & { code?: string } }>(reasons: T[]): { missing: (T & { text: string })[]; fix: (T & { text: string })[] } {
	const missing: (T & { text: string })[] = [];
	const fix: (T & { text: string })[] = [];
	for (const r of reasons) {
		const s = reasonShort(r.block);
		const list = s.missing ? missing : fix;
		if (!list.some((x) => x.text === s.text)) list.push({ ...r, text: s.text });
	}
	return { missing, fix };
}

/** A line as a sentence: capital first, a final period. */
const sentence = (s: string) => {
	const t = s.trim();
	return t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?…]$/.test(t) ? '' : '.');
};

/**
 * The message above Save when the server's check refused the save (an error
 * the browser's check missed, VALIDATION.md "never a generic failure"): each
 * problem named, once — the field's own line where the form has one, else the
 * code's French sentence (`explain`). The fields are marked on their rows too.
 */
export function invalidMessage(errors: Block[]): string {
	const lines = [...new Set(errors.map((b) => sentence(reasonLine(b))))];
	return lines.length ? f.invalidNamed(lines) : f.invalid;
}

const RECIPE_FIELDS: Record<string, string> = {
	title: 'title',
	lang: 'lang',
	variant: 'variant',
	pairVariant: 'pair-variant',
	family: 'family-search',
	servings: 'servings',
	servingsMax: 'servings-max',
	servingsNote: 'servings-note',
	'oven.temp': 'oven-temp',
	'oven.unit': 'oven-temp',
	'oven.tempMax': 'oven-max',
	'source.type': 'src-type',
	'source.author': 'src-author',
	'source.title': 'src-title',
	'source.page': 'src-page',
	'source.url': 'src-url',
	'source.note': 'src-note'
};
const ITEM_FIELDS: Record<string, string> = { qty: 'qty', unit: 'unit', name: 'name', prep: 'prep', note: 'note', brand: 'brand', qtyMax: 'max', alt: 'alt-qty', 'alt.qtyMax': 'alt-qty', recipe: 'sub' };

/**
 * The id of the field a block is on, for the save bar's "take me there":
 * the box she has to fix. Undefined when the form has no box of its own for
 * it (the caller then goes to the first field marked invalid).
 */
export function fieldId(b: Pick<Block, 'id' | 'field'>, form: FormRecipe): string | undefined {
	const firstName = (items: FormItem[]) => (items[0] ? `it-${items[0].id}-name` : undefined);
	if (b.id === 'recipe') {
		if (b.field === 'ingredients') return firstName(form.groups[0]?.items ?? []);
		if (b.field.startsWith('times.')) return `time-${b.field.slice(6)}`;
		if (b.field.startsWith('yield')) return 'yield';
		return RECIPE_FIELDS[b.field];
	}
	for (const g of form.groups) {
		if (g.id === b.id) return b.field === 'items' ? (firstName(g.items) ?? `g-${g.id}`) : `g-${g.id}`;
		for (const it of g.items)
			for (const x of [it, ...it.or]) if (x.id === b.id) return `it-${x.id}-${ITEM_FIELDS[b.field] ?? 'name'}`;
	}
	for (const s of form.sections) {
		if (s.id === b.id) return s.kind === 'method' ? (s.rows[0] ? `r-${s.rows[0].id}` : undefined) : s.kind === 'other' ? undefined : `t-${s.kind}`;
		if (s.kind === 'method' && s.rows.some((r) => r.id === b.id)) return `r-${b.id}`;
	}
	return undefined;
}

/**
 * A list as the language joins it (Intl.ListFormat, conjunction): « un titre
 * et un ingrédient », « a, b et c ». In parts, so each item can be its own
 * button in the save bar while the commas and « et » stay plain text.
 */
export function listParts(items: string[], lang: string): { item: boolean; text: string }[] {
	if (!items.length) return [];
	try {
		const fmt = new Intl.ListFormat(`${lang}-CA`, { style: 'long', type: 'conjunction' });
		return fmt.formatToParts(items).map((p) => ({ item: p.type === 'element', text: p.value }));
	} catch {
		// No Intl.ListFormat: commas, with their space.
		return items.flatMap((text, k) => (k ? [{ item: false, text: ', ' }, { item: true, text }] : [{ item: true, text }]));
	}
}

/** The save bar's sentence as one string: « Il manque : un titre et un ingrédient. À corriger : un temps. » */
export function saveSentence(said: { missing: { text: string }[]; fix: { text: string }[] }, lang: string): string {
	const join = (rs: { text: string }[]) => listParts(rs.map((r) => r.text), lang).map((p) => p.text).join('');
	return [said.missing.length ? `${f.missingLead} ${join(said.missing)}.` : '', said.fix.length ? `${f.fixLead} ${join(said.fix)}.` : '']
		.filter(Boolean)
		.join(' ');
}

/** The parts of the form the section rail jumps to (plan 04, UI pass 3). */
export const FORM_SECTIONS = ['title', 'source', 'ingredients', 'method', 'notes', 'class'] as const;
export type FormSectionKey = (typeof FORM_SECTIONS)[number];
/** Filled, empty, or holding something to fix (a block that is not only « missing »). */
export type SectionState = 'done' | 'empty' | 'fix';

const CLASS_KEYS = ['family', 'variant', 'lang', 'tags', 'season', 'difficulty', 'rating'];

/** Which part of the form a block is in; undefined for the parts the rail does not list (portions, times, oven). */
export function sectionOf(b: Pick<Block, 'id' | 'field'>, form: FormRecipe): FormSectionKey | undefined {
	if (b.id === 'recipe') {
		if (b.field === 'title' || b.field === 'pairVariant') return 'title';
		if (b.field.startsWith('source.') || b.field === 'source') return 'source';
		if (b.field === 'ingredients') return 'ingredients';
		if (CLASS_KEYS.some((k) => b.field === k || b.field.startsWith(`${k}.`) || b.field.startsWith(`${k}[`))) return 'class';
		return undefined;
	}
	for (const g of form.groups) {
		if (g.id === b.id) return 'ingredients';
		for (const it of g.items) if (it.id === b.id || it.or.some((o) => o.id === b.id)) return 'ingredients';
	}
	for (const s of form.sections) {
		if (s.id === b.id) return s.kind === 'method' ? 'method' : s.kind === 'other' ? undefined : 'notes';
		if (s.kind === 'method' && s.rows.some((r) => r.id === b.id)) return 'method';
	}
	return undefined;
}

/** Each part of the rail with its dot: filled, empty, or something to fix in it. */
export function sectionStates(form: FormRecipe, blocks: Block[]): Record<FormSectionKey, SectionState> {
	const s = form.source;
	const filled: Record<FormSectionKey, boolean> = {
		title: !!form.title.trim(),
		source: !!(s.type || s.author.trim() || s.title.trim() || s.page.trim() || s.url.trim() || s.note.trim()),
		ingredients: form.groups.some((g) => g.items.some((it) => !!it.name.trim())),
		method: form.sections.some((x) => x.kind === 'method' && x.rows.some((r) => r.type !== 'heading' && !!r.text.trim())),
		notes: form.sections.some((x) => (x.kind === 'notes' || x.kind === 'variants' || x.kind === 'alternatives') && !!x.text.trim()),
		class: !!(form.family || form.tags.length || form.season.length || form.difficulty !== null || form.rating !== null)
	};
	const fix = new Set<FormSectionKey>();
	for (const b of blocks) {
		if (reasonShort(b).missing) continue;
		const k = sectionOf(b, form);
		if (k) fix.add(k);
	}
	return Object.fromEntries(FORM_SECTIONS.map((k) => [k, fix.has(k) ? 'fix' : filled[k] ? 'done' : 'empty'])) as Record<FormSectionKey, SectionState>;
}
