// Recipe → canonical Markdown (docs/STORAGE.md, "Canonical serialization").
// One fixed key order and formatting whatever was pasted, so diffs show only
// real changes and two files with the same content are byte-identical.
// Browser-safe: the paste preview and the web import use it too.

import { parse } from 'yaml';
import { normalizeText } from './normalize';
import type { Alt, Body, Duration, Ingredient, IngredientGroup, Lang, Quantity, Recipe, SectionKind } from './types';

/** Body headings written back, per language (docs/RECIPE-SCHEMA.md, "Body"). */
export const CANONICAL_HEADINGS: Record<Lang, Record<Exclude<SectionKind, 'other'>, string>> = {
	fr: { method: 'Préparation', notes: 'Notes', variants: 'Variantes', alternatives: 'Alternatives' },
	en: { method: 'Instructions', notes: 'Notes', variants: 'Variants', alternatives: 'Alternatives' }
};

// Words YAML 1.1 reads as booleans or null. The parser here is 1.2, but Obsidian
// and other tools may not be, so these are always quoted.
const YAML11_WORDS = /^(?:y|yes|n|no|true|false|on|off|null|~)$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function needsQuotes(s: string, flow: boolean): boolean {
	if (s === '' || s.trim() !== s) return true;
	if (YAML11_WORDS.test(s)) return true;
	// Anything that could read as a number, a time (`1:30` is 5400 in YAML 1.1),
	// or a version: digits and punctuation only.
	if (/^[-+.]?[\d][\d_:.,eE+-]*$/.test(s) || /^[-+]?\.(?:inf|nan)$/i.test(s)) return true;
	if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s)) return true;
	if (/:(?:\s|$)|\s#|[\t\n\r]/.test(s)) return true;
	// Markers and any other bracket: `[` inside `{ … }` opens a list.
	if (/[[\]]/.test(s)) return true;
	if (flow && /[,{}]/.test(s)) return true;
	if (/[\u0000-\u001f\u007f﻿]/.test(s)) return true;
	return false;
}

/** A string as a YAML scalar: plain when nothing could misread it, else double-quoted. */
export function scalar(s: string, flow = false): string {
	if (DATE_RE.test(s)) return s;
	if (!needsQuotes(s, flow)) {
		// Belt and braces: the plain form must read back as the same string.
		try {
			const back = parse(flow ? `[${s}]` : `k: ${s}`, { version: '1.2' });
			if ((flow ? back?.[0] : back?.k) === s) return s;
		} catch {
			// fall through to quoting
		}
	}
	// JSON string syntax is valid YAML double-quoted syntax.
	return JSON.stringify(s);
}

type Value = string | number | boolean | Quoted;

function value(v: Value, flow: boolean): string {
	if (v instanceof Quoted) return JSON.stringify(v.s);
	return typeof v === 'string' ? scalar(v, flow) : String(v);
}

type Pair = [string, Value | undefined];

/** `{ a: 1, b: x }`, keys with undefined values omitted. */
function flowMap(pairs: Pair[]): string {
	const parts = pairs.filter((p) => p[1] !== undefined).map(([k, v]) => `${k}: ${value(v!, true)}`);
	return `{ ${parts.join(', ')} }`;
}

/** Fractions stay strings as written, and are always quoted (`"1 1/2"`). */
class Quoted {
	constructor(readonly s: string) {}
}
const qty = (q: Quantity | undefined): number | Quoted | undefined =>
	q === undefined ? undefined : typeof q.raw === 'string' ? new Quoted(q.raw) : q.raw;
const dur = (d: Duration | undefined) => d?.raw;

function altFlow(a: Alt): string {
	return flowMap([
		['qty', qty(a.qty)],
		['qty_max', qty(a.qtyMax)],
		['unit', a.unit]
	]);
}

/** Item key order follows the prompt's rule 6 (docs/AI-TEMPLATE.md). */
function itemFlow(it: Ingredient): string {
	const parts: string[] = [];
	const add = (k: string, v: Value | undefined) => {
		if (v !== undefined) parts.push(`${k}: ${value(v, true)}`);
	};
	add('qty', qty(it.qty));
	add('qty_max', qty(it.qtyMax));
	add('unit', it.unit);
	add('name', it.name);
	add('brand', it.brand);
	add('note', it.note);
	add('prep', it.prep);
	if (it.alt) parts.push(`alt: ${altFlow(it.alt)}`);
	if (it.or?.length) {
		const entries = it.or.map((o) => (Object.keys(o).length === 1 ? scalar(o.name, true) : itemFlow(o)));
		parts.push(`or: [${entries.join(', ')}]`);
	}
	if (it.toTaste) add('to_taste', true);
	if (it.optional) add('optional', true);
	add('recipe', it.recipe);
	if (it.buyInstead) add('buy_instead', true);
	add('item', it.item);
	return `{ ${parts.join(', ')} }`;
}

function groupLines(g: IngredientGroup): string[] {
	const head: string[] = [];
	if (g.group !== undefined) head.push(`group: ${scalar(g.group)}`);
	if (g.optional) head.push('optional: true');
	head.push('items:');
	const lines = head.map((l, i) => (i === 0 ? `  - ${l}` : `    ${l}`));
	for (const it of g.items) lines.push(`      - ${itemFlow(it)}`);
	return lines;
}

function block(key: string, pairs: Pair[]): string[] {
	const present = pairs.filter((p) => p[1] !== undefined);
	if (!present.length) return [];
	return [`${key}:`, ...present.map(([k, v]) => `  ${k}: ${value(v!, false)}`)];
}

function frontmatter(r: Recipe): string[] {
	const out: string[] = [];
	const line = (k: string, v: string | number | undefined) => {
		if (v !== undefined) out.push(`${k}: ${value(v, false)}`);
	};
	line('schema', r.schema);
	line('title', r.title);
	line('slug', r.slug);
	line('lang', r.lang);
	line('family', r.family);
	line('variant', r.variant);
	if (r.source) {
		const s = r.source;
		out.push(
			...block('source', [
				['type', s.type],
				['author', s.author],
				['url', s.url],
				['title', s.title],
				['page', s.page],
				['note', s.note]
			])
		);
	}
	if (r.times) {
		const t = r.times;
		out.push(
			...block('times', [
				['prep', dur(t.prep)],
				['cook', dur(t.cook)],
				['rest', dur(t.rest)],
				['total', dur(t.total)]
			])
		);
	}
	if (r.oven) {
		out.push(
			`oven: ${flowMap([
				['temp', r.oven.tempRaw ?? r.oven.temp],
				['temp_max', r.oven.tempMaxRaw ?? r.oven.tempMax],
				['unit', r.oven.unit]
			])}`
		);
	}
	line('servings', r.servingsRaw ?? r.servings);
	line('servings_max', r.servingsMaxRaw ?? r.servingsMax);
	line('servings_note', r.servingsNote);
	if (typeof r.yield === 'string') line('yield', r.yield);
	else if (r.yield && Object.keys(r.yield).length) {
		const y = r.yield;
		out.push(
			`yield: ${flowMap([
				['qty', qty(y.qty)],
				['qty_max', qty(y.qtyMax)],
				['unit', y.unit],
				['note', y.note]
			])}`
		);
	}
	if (r.tags.length) out.push(`tags: [${r.tags.map((t) => scalar(t, true)).join(', ')}]`);
	if (r.season.length) out.push(`season: [${r.season.map((t) => scalar(t, true)).join(', ')}]`);
	line('difficulty', r.difficulty);
	line('rating', r.rating);
	out.push('ingredients:');
	for (const g of r.ingredients) out.push(...groupLines(g));
	if (r.media && Object.keys(r.media).length) {
		out.push('media:');
		for (const [k, v] of Object.entries(r.media)) out.push(`  ${k}: ${scalar(v)}`);
	}
	line('status', r.status);
	line('added', r.added);
	line('updated', r.updated);
	line('extracted_by', r.extractedBy);
	return out;
}

/**
 * The body with recognized section headings rewritten in the recipe's
 * language. Section text is kept as written; other sections keep their heading.
 */
export function serializeBody(body: Body, lang: Lang): string {
	const parts: string[] = [];
	if (body.preamble) parts.push(body.preamble);
	for (const s of body.sections) {
		const heading =
			s.kind === 'other' ? `${'#'.repeat(s.level)} ${s.heading}` : `## ${CANONICAL_HEADINGS[lang][s.kind]}`;
		parts.push(s.text ? `${heading}\n\n${s.text}` : heading);
	}
	return parts.join('\n\n');
}

/** The canonical file for a recipe: NFC, LF, one trailing newline. */
export function serialize(recipe: Recipe, body: Body): string {
	const text = ['---', ...frontmatter(recipe), '---', '', serializeBody(body, recipe.lang)].join('\n');
	return normalizeText(text).replace(/\s+$/, '') + '\n';
}
