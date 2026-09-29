// The form model (plan 04, Phase 2): the editable shape of a recipe, and the
// two conversions `toForm(recipe, body)` / `fromForm(form)`.
//
// Browser-safe, plain JSON (drafts go to localStorage, the form goes to the
// server as is). Every field holds what she sees: text without marker syntax,
// a quantity as she would type it, a duration as hours and minutes. What the
// file held is kept beside it in `written`, keyed by field, whenever the shown
// value would not write it back identically (markers, `"2"` quoted, `90m`,
// `page: "12"`). On the way back a field whose shown value is unchanged
// writes its `written` value; an edited one writes what she typed (Q15:
// editing settles the uncertain markers; `[+]` stays after its text while that
// text is untouched). So an unchanged form serializes byte-identical to the
// recipe it was opened from.
//
// What the form does not edit is carried untouched (Q4 A): the preamble,
// sections other than the four known ones, media keys besides `final`, `item`,
// the app's bookkeeping fields. YAML comments and unknown keys are already
// gone from the parsed recipe: the canonical serializer drops them, as on
// every app save.

import { parseBody } from '../vault/body';
import { parseDuration } from '../vault/duration';
import { parseQuantity } from '../vault/quantity';
import { serialize, serializeBody } from '../vault/serialize';
import { slugify } from '../vault/slug';
import type {
	Alt,
	Body,
	Duration,
	Ingredient,
	IngredientGroup,
	Lang,
	Quantity,
	Recipe,
	Section,
	SectionKind,
	Source,
	SourceType,
	Times,
	Unit,
	YieldObject
} from '../vault/types';
import { durationToForm, emptyDuration, formToDuration, sameDuration, type FormDuration } from './duration';
import { confirmValue, hasMarkers, hideMarkers, isUncertain, markedText, reapplyAdded, type Mark } from './markers';
import { parseNumberInput, parseQuantityInput, showDecimal, showQuantity } from './quantity';
import { rowsFromText, sameRows, textFromRows, type RawRow, type RowType } from './steps';

/** Values as written in the file, per field, where the shown value would not write them back. */
export type Written = Record<string, string | number>;

export interface FormAlt {
	qty: string;
	qtyMax: string;
	unit: Unit | '';
	written: Written;
}

export interface FormItem {
	id: string;
	qty: string;
	qtyMax: string;
	unit: Unit | '';
	name: string;
	brand: string;
	note: string;
	prep: string;
	/** "ou en mesure": the same amount in another measure. */
	alt: FormAlt | null;
	/** "ou remplacer par": replacements, each a row of its own. */
	or: FormItem[];
	toTaste: boolean;
	optional: boolean;
	/** Slug of a sub-recipe. */
	recipe: string;
	buyInstead: boolean;
	/** Registry override: never shown, kept (plan 04, Out of scope). */
	item: string;
	written: Written;
}

export interface FormGroup {
	id: string;
	name: string;
	optional: boolean;
	items: FormItem[];
	written: Written;
}

export interface StepRow {
	id: string;
	type: RowType;
	/** The text without markers; a step's nested list is one line per item. */
	text: string;
	/** Heading level, heading rows only. */
	level?: number;
	written: Written;
}

export type TextKind = 'notes' | 'variants' | 'alternatives';

export interface MethodSection {
	id: string;
	kind: 'method';
	heading: string;
	level: number;
	/** The section text as read; absent for a section the form added. */
	original?: string;
	rows: StepRow[];
}

export interface TextSection {
	id: string;
	kind: TextKind;
	heading: string;
	level: number;
	original?: string;
	/** The text without markers. */
	text: string;
	written: Written;
}

/** A section the form does not edit, kept verbatim. */
export interface OtherSection {
	id: string;
	kind: 'other';
	heading: string;
	level: number;
	text: string;
}

export type FormSection = MethodSection | TextSection | OtherSection;

export interface FormSource {
	type: SourceType | '';
	author: string;
	url: string;
	title: string;
	page: string;
	note: string;
}

export interface FormYield {
	/** `text`: "24 biscuits"; `amount`: qty + unit + note. */
	kind: 'none' | 'text' | 'amount';
	text: string;
	qty: string;
	qtyMax: string;
	unit: Unit | '';
	note: string;
}

export interface FormRecipe {
	/** Model version, for drafts saved by an older app. */
	version: 1;
	schema: number;
	/** Empty for a new recipe: derived from the title on save, then permanent. */
	slug: string;
	lang: Lang;
	title: string;
	family: string;
	variant: string;
	source: FormSource;
	times: { prep: FormDuration; cook: FormDuration; rest: FormDuration; total: FormDuration };
	/** No oven when `temp` is empty. */
	oven: { temp: string; tempMax: string; unit: 'F' | 'C' | '' };
	servings: string;
	servingsMax: string;
	servingsNote: string;
	yield: FormYield;
	tags: string[];
	season: string[];
	difficulty: number | null;
	rating: number | null;
	groups: FormGroup[];
	/** Text before the first heading: not edited, kept. */
	preamble: string;
	sections: FormSection[];
	/** `final` is the photo; other keys are kept. */
	media: Record<string, string>;
	/** Set by the app, never typed (status, added, updated, extracted_by). */
	app: { status?: string; added?: string; updated?: string; extractedBy?: string };
	/** Recipe-level fields as written: `title`, `source.author`, `times.prep`, `oven.temp`, `servings`, `yield.qty`, … */
	written: Written;
}

/** A value the form could not turn into the file's format. The UI prevents these; the save refuses them. */
export interface FormError {
	/** Id of the row, group or section, or `recipe`. */
	id: string;
	field: string;
	reason: string;
}

// ---------------------------------------------------------------------------
// Ids

let counter = 0;
const prefix = Math.random().toString(36).slice(2, 7);
/** A client id, stable while the form is open (reordering, React-style keys). */
export const newId = (): string => `${prefix}${(++counter).toString(36)}`;

// ---------------------------------------------------------------------------
// Field codecs: the file's value ↔ the shown string.

type Raw = string | number;
type Read = { ok: true; raw?: Raw } | { ok: false; reason: string };

interface Codec {
	show(raw: Raw): string;
	read(text: string): Read;
	/** Free text: an edit keeps the `[+]` markers whose text is untouched. */
	text?: boolean;
}

const nfc = (s: string) => s.normalize('NFC');

const TEXT: Codec = {
	show: (raw) => hideMarkers(String(raw)),
	read: (t) => {
		const s = nfc(t).trim();
		return { ok: true, raw: s || undefined };
	},
	text: true
};

const qtyCodec = (lang: Lang): Codec => ({
	show: (raw) => showQuantity(raw, lang),
	read: (t) => {
		if (!t.trim()) return { ok: true };
		const q = parseQuantityInput(t);
		return q.ok ? { ok: true, raw: q.raw } : { ok: false, reason: q.reason };
	}
});

const numberCodec = (lang: Lang): Codec => ({
	show: (raw) => (typeof raw === 'number' ? showDecimal(raw, lang) : hideMarkers(raw)),
	read: (t) => {
		if (!t.trim()) return { ok: true };
		const n = parseNumberInput(t);
		return n.ok ? { ok: true, raw: n.value } : { ok: false, reason: n.reason };
	}
});

const PAGE: Codec = {
	show: (raw) => hideMarkers(String(raw)),
	read: (t) => {
		const s = nfc(t).trim();
		return { ok: true, raw: !s ? undefined : /^\d+$/.test(s) ? Number(s) : s };
	}
};

/** The shown string for a file value, recording the value in `written` when the string would not write it back. */
function show(written: Written, key: string, raw: Raw | undefined, codec: Codec): string {
	if (raw === undefined) return '';
	const shown = codec.show(raw);
	const back = codec.read(shown);
	if (!back.ok || back.raw !== raw) written[key] = raw;
	return shown;
}

/** The file value for a shown string: the written value while the string is unchanged, else what she typed. */
function read(written: Written, key: string, shown: string, codec: Codec, err: (reason: string) => void): Raw | undefined {
	const w = written[key];
	if (w !== undefined && codec.show(w) === shown) return w;
	const r = codec.read(shown);
	if (!r.ok) {
		err(r.reason);
		return undefined;
	}
	if (codec.text && w !== undefined && r.raw !== undefined) return reapplyAdded(String(r.raw), String(w));
	return r.raw;
}

// ---------------------------------------------------------------------------
// Constructors

export function newItem(): FormItem {
	return {
		id: newId(),
		qty: '',
		qtyMax: '',
		unit: '',
		name: '',
		brand: '',
		note: '',
		prep: '',
		alt: null,
		or: [],
		toTaste: false,
		optional: false,
		recipe: '',
		buyInstead: false,
		item: '',
		written: {}
	};
}

export const newGroup = (): FormGroup => ({ id: newId(), name: '', optional: false, items: [newItem()], written: {} });

export const newRow = (type: RowType = 'step'): StepRow =>
	type === 'heading' ? { id: newId(), type, text: '', level: 3, written: {} } : { id: newId(), type, text: '', written: {} };

const SECTION_ORDER: Exclude<SectionKind, 'other'>[] = ['method', 'notes', 'variants', 'alternatives'];

/**
 * The section of that kind, added when the recipe has none: after the known
 * sections that come before it (method, notes, variants, alternatives).
 */
export function ensureSection(form: FormRecipe, kind: 'method'): MethodSection;
export function ensureSection(form: FormRecipe, kind: TextKind): TextSection;
export function ensureSection(form: FormRecipe, kind: 'method' | TextKind): MethodSection | TextSection {
	const found = form.sections.find((s) => s.kind === kind);
	if (found) return found as MethodSection | TextSection;
	const rank = SECTION_ORDER.indexOf(kind);
	let at = 0;
	form.sections.forEach((s, i) => {
		if (s.kind !== 'other' && SECTION_ORDER.indexOf(s.kind) < rank) at = i + 1;
	});
	const section: MethodSection | TextSection =
		kind === 'method'
			? { id: newId(), kind: 'method', heading: '', level: 2, rows: [newRow()] }
			: { id: newId(), kind, heading: '', level: 2, text: '', written: {} };
	form.sections.splice(at, 0, section);
	return section;
}

export interface NewFormOptions {
	lang?: Lang;
	ovenUnit?: 'F' | 'C' | null;
}

/** An empty form for a new recipe: one group with one row, a method with one step. */
export function emptyForm(opts: NewFormOptions = {}): FormRecipe {
	const form: FormRecipe = {
		version: 1,
		schema: 3,
		slug: '',
		lang: opts.lang ?? 'fr',
		title: '',
		family: '',
		variant: '',
		source: { type: '', author: '', url: '', title: '', page: '', note: '' },
		times: { prep: emptyDuration(), cook: emptyDuration(), rest: emptyDuration(), total: emptyDuration() },
		oven: { temp: '', tempMax: '', unit: opts.ovenUnit ?? '' },
		servings: '',
		servingsMax: '',
		servingsNote: '',
		yield: { kind: 'none', text: '', qty: '', qtyMax: '', unit: '', note: '' },
		tags: [],
		season: [],
		difficulty: null,
		rating: null,
		groups: [newGroup()],
		preamble: '',
		sections: [],
		media: {},
		app: {},
		written: {}
	};
	ensureSection(form, 'method');
	return form;
}

// ---------------------------------------------------------------------------
// Recipe → form

function itemToForm(it: Ingredient, lang: Lang): FormItem {
	const w: Written = {};
	const q = qtyCodec(lang);
	return {
		id: newId(),
		qty: show(w, 'qty', it.qty?.raw, q),
		qtyMax: show(w, 'qtyMax', it.qtyMax?.raw, q),
		unit: it.unit ?? '',
		name: show(w, 'name', it.name, TEXT),
		brand: show(w, 'brand', it.brand, TEXT),
		note: show(w, 'note', it.note, TEXT),
		prep: show(w, 'prep', it.prep, TEXT),
		alt: it.alt ? altToForm(it.alt, lang) : null,
		or: (it.or ?? []).map((o) => itemToForm(o, lang)),
		toTaste: !!it.toTaste,
		optional: !!it.optional,
		recipe: it.recipe ?? '',
		buyInstead: !!it.buyInstead,
		item: it.item ?? '',
		written: w
	};
}

function altToForm(a: Alt, lang: Lang): FormAlt {
	const w: Written = {};
	const q = qtyCodec(lang);
	return { qty: show(w, 'qty', a.qty?.raw, q), qtyMax: show(w, 'qtyMax', a.qtyMax?.raw, q), unit: a.unit ?? '', written: w };
}

function rowsToForm(text: string): StepRow[] {
	return rowsFromText(text).map((r) => {
		const w: Written = {};
		const row: StepRow = { id: newId(), type: r.type, text: show(w, 'text', r.text, TEXT), written: w };
		if (r.type === 'heading') row.level = r.level;
		return row;
	});
}

function sectionToForm(s: Section): FormSection {
	const base = { id: newId(), heading: s.heading, level: s.level };
	if (s.kind === 'method') return { ...base, kind: 'method', original: s.text, rows: rowsToForm(s.text) };
	if (s.kind === 'other') return { ...base, kind: 'other', text: s.text };
	const w: Written = {};
	return { ...base, kind: s.kind, original: s.text, text: show(w, 'text', s.text, TEXT), written: w };
}

function durationField(written: Written, key: string, d: Duration | undefined): FormDuration {
	const f = durationToForm(d);
	if (d) {
		const back = formToDuration(f);
		if (!back.ok || back.raw !== d.raw) written[key] = d.raw;
	}
	return f;
}

/** The form for a recipe read by the checker (`checkFile(text).recipe` and `.body`). */
export function toForm(recipe: Recipe, body: Body): FormRecipe {
	const w: Written = {};
	const lang = recipe.lang;
	const num = numberCodec(lang);
	const q = qtyCodec(lang);
	const s = recipe.source ?? {};
	const t = recipe.times ?? {};
	const y = recipe.yield;
	const form: FormRecipe = {
		version: 1,
		schema: recipe.schema,
		slug: recipe.slug,
		lang,
		title: show(w, 'title', recipe.title, TEXT),
		family: show(w, 'family', recipe.family, TEXT),
		variant: show(w, 'variant', recipe.variant, TEXT),
		source: {
			type: s.type ?? '',
			author: show(w, 'source.author', s.author, TEXT),
			url: show(w, 'source.url', s.url, TEXT),
			title: show(w, 'source.title', s.title, TEXT),
			page: show(w, 'source.page', s.page, PAGE),
			note: show(w, 'source.note', s.note, TEXT)
		},
		times: {
			prep: durationField(w, 'times.prep', t.prep),
			cook: durationField(w, 'times.cook', t.cook),
			rest: durationField(w, 'times.rest', t.rest),
			total: durationField(w, 'times.total', t.total)
		},
		oven: recipe.oven
			? {
					temp: show(w, 'oven.temp', recipe.oven.tempRaw ?? recipe.oven.temp, num),
					tempMax: show(w, 'oven.tempMax', recipe.oven.tempMaxRaw ?? recipe.oven.tempMax, num),
					unit: recipe.oven.unit
				}
			: { temp: '', tempMax: '', unit: '' },
		servings: show(w, 'servings', recipe.servingsRaw ?? recipe.servings, num),
		servingsMax: show(w, 'servingsMax', recipe.servingsMaxRaw ?? recipe.servingsMax, num),
		servingsNote: show(w, 'servingsNote', recipe.servingsNote, TEXT),
		yield:
			typeof y === 'string'
				? { kind: 'text', text: show(w, 'yield.text', y, TEXT), qty: '', qtyMax: '', unit: '', note: '' }
				: y && Object.keys(y).length
					? {
							kind: 'amount',
							text: '',
							qty: show(w, 'yield.qty', y.qty?.raw, q),
							qtyMax: show(w, 'yield.qtyMax', y.qtyMax?.raw, q),
							unit: y.unit ?? '',
							note: show(w, 'yield.note', y.note, TEXT)
						}
					: { kind: 'none', text: '', qty: '', qtyMax: '', unit: '', note: '' },
		tags: [...recipe.tags],
		season: [...recipe.season],
		difficulty: recipe.difficulty ?? null,
		rating: recipe.rating ?? null,
		groups: recipe.ingredients.map((g) => {
			const gw: Written = {};
			return {
				id: newId(),
				name: show(gw, 'name', g.group, TEXT),
				optional: !!g.optional,
				items: g.items.map((it) => itemToForm(it, lang)),
				written: gw
			};
		}),
		preamble: body.preamble,
		sections: body.sections.map(sectionToForm),
		media: { ...recipe.media },
		app: {},
		written: w
	};
	for (const k of ['status', 'added', 'updated', 'extractedBy'] as const) if (recipe[k] !== undefined) form.app[k] = recipe[k];
	return form;
}

// ---------------------------------------------------------------------------
// Form → recipe

export interface FromForm {
	recipe: Recipe;
	body: Body;
	/** Fields that could not be written; each left out of `recipe`. */
	errors: FormError[];
}

const blank = (s: string) => !s.trim();

function quantity(raw: Raw | undefined): Quantity | undefined {
	if (raw === undefined) return undefined;
	const q = parseQuantity(raw);
	return { raw, value: q.ok ? q.value : NaN };
}

function isEmptyItem(it: FormItem): boolean {
	return (
		[it.qty, it.qtyMax, it.name, it.brand, it.note, it.prep, it.recipe, it.item].every(blank) &&
		!it.unit &&
		!it.alt &&
		!it.or.length &&
		!it.toTaste &&
		!it.optional &&
		!it.buyInstead
	);
}

function itemFromForm(it: FormItem, lang: Lang, errors: FormError[]): Ingredient | undefined {
	const err = (field: string) => (reason: string) => errors.push({ id: it.id, field, reason });
	const w = it.written;
	const q = qtyCodec(lang);
	const name = read(w, 'name', it.name, TEXT, err('name'));
	if (name === undefined) {
		if (!isEmptyItem(it)) errors.push({ id: it.id, field: 'name', reason: 'required' });
		return undefined;
	}
	const out: Ingredient = { name: String(name) };
	const qty = quantity(read(w, 'qty', it.qty, q, err('qty')));
	if (qty) out.qty = qty;
	const qtyMax = quantity(read(w, 'qtyMax', it.qtyMax, q, err('qtyMax')));
	if (qtyMax) out.qtyMax = qtyMax;
	if (it.unit) out.unit = it.unit;
	if (it.alt) {
		const aw = it.alt.written;
		const aq = quantity(read(aw, 'qty', it.alt.qty, q, err('alt.qty')));
		if (aq && it.alt.unit) {
			const alt: Alt = { qty: aq, unit: it.alt.unit };
			const am = quantity(read(aw, 'qtyMax', it.alt.qtyMax, q, err('alt.qtyMax')));
			if (am) alt.qtyMax = am;
			out.alt = alt;
		} else if (aq || it.alt.unit) errors.push({ id: it.id, field: 'alt', reason: 'incomplete' });
	}
	const brand = read(w, 'brand', it.brand, TEXT, err('brand'));
	if (brand !== undefined) out.brand = String(brand);
	const or = it.or.map((o) => itemFromForm(o, lang, errors)).filter((o): o is Ingredient => !!o);
	if (or.length) out.or = or;
	const note = read(w, 'note', it.note, TEXT, err('note'));
	if (note !== undefined) out.note = String(note);
	const prep = read(w, 'prep', it.prep, TEXT, err('prep'));
	if (prep !== undefined) out.prep = String(prep);
	if (it.toTaste) out.toTaste = true;
	if (it.optional) out.optional = true;
	if (it.recipe.trim()) out.recipe = it.recipe.trim();
	if (it.buyInstead) out.buyInstead = true;
	if (it.item) out.item = it.item;
	return out;
}

function sectionFromForm(s: FormSection, errors: FormError[]): Section | undefined {
	const base = { heading: s.heading, level: s.level };
	if (s.kind === 'other') return { ...base, kind: 'other', text: s.text };
	if (s.kind === 'method') {
		const rows: RawRow[] = s.rows.map((r) => {
			const text = read(r.written, 'text', r.text, TEXT, () => {});
			return { type: r.type, text: text === undefined ? '' : String(text), ...(r.type === 'heading' ? { level: r.level ?? 3 } : {}) };
		});
		const text = s.original !== undefined && sameRows(rows, rowsFromText(s.original)) ? s.original : textFromRows(rows);
		if (!text && s.original !== '') return undefined;
		return { ...base, heading: s.heading || '', kind: 'method', text };
	}
	const raw = read(s.written, 'text', s.text, TEXT, (reason) => errors.push({ id: s.id, field: 'text', reason }));
	const text = raw === undefined ? '' : String(raw);
	// A section she emptied, or added and left empty, is not written; one that was empty in the file stays.
	if (!text && s.original !== '') return undefined;
	return { ...base, kind: s.kind, text };
}

/**
 * The recipe and body a form describes, ready for `serialize`. `markers` is
 * left empty: the save path checks the serialized text, which finds them.
 */
export function fromForm(form: FormRecipe): FromForm {
	const errors: FormError[] = [];
	const w = form.written;
	const lang = form.lang;
	const num = numberCodec(lang);
	const q = qtyCodec(lang);
	const err = (field: string) => (reason: string) => errors.push({ id: 'recipe', field, reason });
	const text = (key: string, shown: string) => {
		const v = read(w, key, shown, TEXT, err(key));
		return v === undefined ? undefined : String(v);
	};

	const title = text('title', form.title) ?? '';
	if (!title) errors.push({ id: 'recipe', field: 'title', reason: 'required' });
	const recipe: Recipe = {
		schema: form.schema,
		title,
		slug: form.slug || slugify(title),
		slugDerived: !form.slug,
		lang,
		tags: [...form.tags],
		season: [...form.season],
		ingredients: [],
		markers: []
	};
	const family = text('family', form.family);
	if (family) recipe.family = family;
	const variant = text('variant', form.variant);
	if (variant) recipe.variant = variant;

	const source: Source = {};
	if (form.source.type) source.type = form.source.type;
	for (const k of ['author', 'url', 'title', 'note'] as const) {
		const v = text(`source.${k}`, form.source[k]);
		if (v) source[k] = v;
	}
	const page = read(w, 'source.page', form.source.page, PAGE, err('source.page'));
	if (page !== undefined) source.page = page;
	if (Object.keys(source).length) recipe.source = source;

	const times: Times = {};
	for (const k of ['prep', 'cook', 'rest', 'total'] as const) {
		const key = `times.${k}`;
		const f = form.times[k];
		const written = w[key];
		let raw: string | undefined;
		if (typeof written === 'string' && sameDuration(durationToForm(parseDuration(written)), f)) raw = written;
		else {
			const d = formToDuration(f);
			if (!d.ok) errors.push({ id: 'recipe', field: key, reason: d.reason });
			else raw = d.raw;
		}
		const d = raw === undefined ? undefined : parseDuration(raw);
		if (d) times[k] = d;
	}
	if (Object.keys(times).length) recipe.times = times;

	const temp = read(w, 'oven.temp', form.oven.temp, num, err('oven.temp'));
	if (temp !== undefined) {
		if (!form.oven.unit) errors.push({ id: 'recipe', field: 'oven.unit', reason: 'required' });
		else {
			recipe.oven = { temp: numeric(temp), unit: form.oven.unit };
			if (typeof temp === 'string') recipe.oven.tempRaw = temp;
			const tempMax = read(w, 'oven.tempMax', form.oven.tempMax, num, err('oven.tempMax'));
			if (tempMax !== undefined) {
				recipe.oven.tempMax = numeric(tempMax);
				if (typeof tempMax === 'string') recipe.oven.tempMaxRaw = tempMax;
			}
		}
	}

	const servings = read(w, 'servings', form.servings, num, err('servings'));
	if (servings !== undefined) {
		recipe.servings = numeric(servings);
		if (typeof servings === 'string') recipe.servingsRaw = servings;
	}
	const servingsMax = read(w, 'servingsMax', form.servingsMax, num, err('servingsMax'));
	if (servingsMax !== undefined) {
		recipe.servingsMax = numeric(servingsMax);
		if (typeof servingsMax === 'string') recipe.servingsMaxRaw = servingsMax;
	}
	const servingsNote = text('servingsNote', form.servingsNote);
	if (servingsNote) recipe.servingsNote = servingsNote;

	if (form.yield.kind === 'text') {
		const y = text('yield.text', form.yield.text);
		if (y) recipe.yield = y;
	} else if (form.yield.kind === 'amount') {
		const y: YieldObject = {};
		const yq = quantity(read(w, 'yield.qty', form.yield.qty, q, err('yield.qty')));
		if (yq) y.qty = yq;
		const ym = quantity(read(w, 'yield.qtyMax', form.yield.qtyMax, q, err('yield.qtyMax')));
		if (ym) y.qtyMax = ym;
		if (form.yield.unit) y.unit = form.yield.unit;
		const note = text('yield.note', form.yield.note);
		if (note) y.note = note;
		if (Object.keys(y).length) recipe.yield = y;
	}
	if (form.difficulty !== null) recipe.difficulty = form.difficulty;
	if (form.rating !== null) recipe.rating = form.rating;

	for (const g of form.groups) {
		const items = g.items.map((it) => itemFromForm(it, lang, errors)).filter((it): it is Ingredient => !!it);
		const name = read(g.written, 'name', g.name, TEXT, (reason) => errors.push({ id: g.id, field: 'name', reason }));
		if (!items.length) {
			if (name !== undefined) errors.push({ id: g.id, field: 'items', reason: 'required' });
			continue;
		}
		const group: IngredientGroup = { items };
		if (name !== undefined) group.group = String(name);
		if (g.optional) group.optional = true;
		recipe.ingredients.push(group);
	}
	if (!recipe.ingredients.length) errors.push({ id: 'recipe', field: 'ingredients', reason: 'required' });

	if (Object.keys(form.media).length) recipe.media = { ...form.media };
	for (const k of ['status', 'added', 'updated', 'extractedBy'] as const) if (form.app[k] !== undefined) recipe[k] = form.app[k];

	const sections = form.sections.map((s) => sectionFromForm(s, errors)).filter((s): s is Section => !!s);
	const body: Body = { preamble: form.preamble, sections, steps: [] };
	body.steps = parseBody(serializeBody(body, lang)).body.steps;
	return { recipe, body, errors };
}

/** The canonical file text of a form: what saving it writes, before the app sets its fields. */
export function formText(form: FormRecipe): string {
	const { recipe, body } = fromForm(form);
	return serialize(recipe, body);
}

function numeric(raw: Raw): number {
	return typeof raw === 'number' ? raw : Number(hideMarkers(raw));
}

// ---------------------------------------------------------------------------
// Markers per field (Q15 A)

const QTY_KEYS = new Set(['qty', 'qtyMax', 'yield.qty', 'yield.qtyMax']);
const NUMBER_KEYS = new Set(['servings', 'servingsMax', 'oven.temp', 'oven.tempMax']);

function codecFor(key: string, lang: Lang): Codec {
	if (QTY_KEYS.has(key)) return qtyCodec(lang);
	if (NUMBER_KEYS.has(key)) return numberCodec(lang);
	if (key === 'source.page') return PAGE;
	return TEXT;
}

/** The field's current value on its owner: `source.author` → `owner.source.author`. */
function valueAt(owner: object, key: string): unknown {
	return key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), owner);
}

/** Whether the field still shows what the file held (not edited since the form opened). */
function untouched(owner: { written: Written }, key: string, lang: Lang): string | undefined {
	const w = owner.written[key];
	if (typeof w !== 'string') return undefined;
	const current = valueAt(owner, key);
	if (key.startsWith('times.')) {
		const d = parseDuration(w);
		return d && sameDuration(durationToForm(d), current as FormDuration) ? w : undefined;
	}
	return codecFor(key, lang).show(w) === current ? w : undefined;
}

export interface FieldMarkers {
	/** An uncertain reading remains (`[?]`, `[?: …]`, `[illisible]`): highlight, offer "C'est bien ça". */
	uncertain: boolean;
	/** The other readings of `[?: …]`. */
	alternatives: string[];
	/** Where each marker applies in the text without markers; for a text field these are spans of the shown value. */
	marks: Mark[];
}

/**
 * The markers a field holds, for display: none once she edited the field
 * (editing settles them). Owner: the form, a group, an item, an `alt`, a step
 * row or a text section; key as in its `written`.
 */
export function fieldMarkers(owner: { written: Written }, key: string, lang: Lang): FieldMarkers {
	const w = untouched(owner, key, lang);
	if (w === undefined || !hasMarkers(w)) return { uncertain: false, alternatives: [], marks: [] };
	const { marks } = markedText(w);
	return {
		uncertain: marks.some((m) => isUncertain(m.kind)),
		alternatives: marks.flatMap((m) => (m.alternative !== undefined ? [m.alternative] : [])),
		marks
	};
}

/**
 * "C'est bien ça": the field's uncertain markers are removed from what will be
 * written; its `[+]` stay. Nothing happens to a field she already edited.
 */
export function confirmField(owner: { written: Written }, key: string, lang: Lang): void {
	const w = untouched(owner, key, lang);
	if (w === undefined) return;
	const confirmed = confirmValue(w);
	if (confirmed === w) return;
	if (hasMarkers(confirmed)) owner.written[key] = confirmed;
	else delete owner.written[key];
}

/** Every field of the form still holding an uncertain marker, as `[owner id, key]` (`recipe` for the form itself). */
export function uncertainFields(form: FormRecipe): [string, string][] {
	const out: [string, string][] = [];
	const scan = (id: string, owner: { written: Written }) => {
		for (const key of Object.keys(owner.written)) if (fieldMarkers(owner, key, form.lang).uncertain) out.push([id, key]);
	};
	scan('recipe', form);
	const item = (it: FormItem) => {
		scan(it.id, it);
		if (it.alt) scan(it.id, it.alt);
		it.or.forEach(item);
	};
	for (const g of form.groups) {
		scan(g.id, g);
		g.items.forEach(item);
	}
	for (const s of form.sections) {
		if (s.kind === 'method') s.rows.forEach((r) => scan(r.id, r));
		else if (s.kind !== 'other') scan(s.id, s);
	}
	return out;
}
