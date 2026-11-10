// « Coller une liste » (plan 04, follow-up UI pass 2): a block of typed or
// pasted text → ingredient rows and step rows. One line per ingredient, read
// with the web import's line reader (moved here so the browser has it; the
// server's `webimport.ts` reads web pages with the same rules). Browser-safe.

import { fold } from '../vault/normalize';
import { parseQuantity } from '../vault/quantity';
import type { Ingredient, Lang, Quantity, Unit } from '../vault/types';
import { UNITS } from '../vault/types';
import { UNIT_ALIASES, findQtyUnit, unitForAlias } from '../vault/vocab';

const VULGAR: Record<string, string> = { '½': '1/2', '¼': '1/4', '¾': '3/4', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8' };
const QTY_SRC = String.raw`\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?\s*[½¼¾⅓⅔⅛]|\d+(?:[.,]\d+)?|[½¼¾⅓⅔⅛]`;
const LEAD_RE = new RegExp(String.raw`^(${QTY_SRC})(?:\s*(?:-|–|à|to|ou|or)\s*(${QTY_SRC}))?\s*(.*)$`, 'u');
const ALIASES = [...new Set(UNITS.flatMap((u) => UNIT_ALIASES[u]))].sort((a, b) => b.length - a.length);

/** A quantity as the file writes it: numbers plain, fractions as quoted strings. */
function toQuantity(s: string): Quantity | undefined {
	let t = s.trim().replace(/(\d)\s*([½¼¾⅓⅔⅛])/, '$1 $2');
	t = t.replace(/[½¼¾⅓⅔⅛]/, (g) => VULGAR[g]);
	const raw: number | string = /^\d+(?:[.,]\d+)?$/.test(t) ? Number(t.replace(',', '.')) : t;
	const p = parseQuantity(raw);
	return p.ok ? { raw, value: p.value } : undefined;
}

function leadingUnit(rest: string, lang: Lang): { unit: Unit; rest: string } | undefined {
	for (const alias of ALIASES) {
		if (!rest.toLowerCase().startsWith(alias.toLowerCase())) continue;
		const after = rest.slice(alias.length);
		if (after && !/^[\s.,)]/.test(after)) continue;
		const unit = unitForAlias(rest.slice(0, alias.length), lang);
		if (!unit) continue;
		const left = after.replace(/^\.?\s*/, '');
		// « 2 branches de céleri »: the alias names the ingredient too.
		const of = alias.match(/ de (.+)$/)?.[1];
		if (of && (!left || /^[,(]/.test(left))) return { unit, rest: rest.slice(alias.length - of.length, alias.length) + (left.startsWith('(') ? ' ' : '') + left };
		return { unit, rest: left };
	}
	return undefined;
}

const CONTAINERS: readonly Unit[] = ['piece', 'can', 'packet', 'bottle', 'jar', 'bag'];
const SIZE_UNITS: readonly Unit[] = ['g', 'kg', 'ml', 'cl', 'l', 'oz', 'lb'];

/**
 * « 1 boîte de 796 ml (28 oz) de tomates »: after a container, the size
 * printed on it. It goes in `note`, where the checker allows one size and its
 * equivalent in parentheses (E216).
 */
function containerSize(rest: string, lang: Lang): { size: string; rest: string } | undefined {
	const de = rest.match(/^de\s+(?=[\d½¼¾⅓⅔⅛])/i);
	if (!de) return undefined;
	const text = rest.slice(de[0].length);
	const lead = text.match(LEAD_RE);
	const unit = lead && !lead[2] ? leadingUnit(lead[3], lang) : undefined;
	if (!lead || !unit || !SIZE_UNITS.includes(unit.unit) || !toQuantity(lead[1])) return undefined;
	let after = unit.rest;
	const paren = after.match(/^\(([^()]*)\)\s*/);
	if (paren) {
		const inner = paren[1].match(LEAD_RE);
		const innerUnit = inner && !inner[2] ? leadingUnit(inner[3], lang) : undefined;
		if (!innerUnit || innerUnit.rest || !SIZE_UNITS.includes(innerUnit.unit)) return undefined;
		after = after.slice(paren[0].length);
	}
	if (!/^(?:de |d['’])/i.test(after)) return undefined;
	return { size: text.slice(0, text.length - after.length).trim(), rest: after };
}

/** A word folded for the measure-word test: no accents, no trailing dot, no plural s/x. */
const measureKey = (w: string) => {
	const f = fold(w).replace(/\.+$/, '');
	return f.length > 2 ? f.replace(/[sx]$/, '') : f;
};
/** First words of every unit alias, plus spellings that are not aliases but still a measure. */
const MEASURE_WORDS = new Set(
	[...ALIASES.map((a) => a.split(/\s+/)[0]), 'cuillère', 'cuillerée', 'cuiller', 'cuil', 'c', 'cs', 'ct', 'tbs', 'tbl'].map(measureKey)
);

/** The line reads like "<qty> <a unit word we cannot place> …": defaulting to `piece` would be a guess. */
function looksLikeUnit(rest: string): boolean {
	const word = rest.match(/^[^\s,()]+/)?.[0];
	return !!word && MEASURE_WORDS.has(measureKey(word));
}

/**
 * "farine (tamisée)" → name and note: the "(…)" that ends the text, from the
 * first "(" after any earlier ")". Found by index, never a regex that could go
 * quadratic on a line of "(".
 */
function trailingNote(s: string): { name: string; note: string } | undefined {
	const t = s.trimEnd();
	if (!t.endsWith(')')) return;
	const close = t.length - 1;
	const open = t.indexOf('(', t.lastIndexOf(')', close - 1) + 1);
	if (open < 0 || open >= close) return;
	const name = t.slice(0, open).trimEnd();
	return name ? { name, note: t.slice(open + 1, close).trim() } : undefined;
}

/** One line read into an entry; undefined when it does not read cleanly. `text` is plain, one line. */
export function readIngredientLine(text: string, lang: Lang): Ingredient | undefined {
	const lead = text.match(LEAD_RE);
	let it: Ingredient;
	let size: string | undefined;
	if (!lead) {
		it = { name: text };
	} else {
		const qty = toQuantity(lead[1]);
		const qtyMax = lead[2] ? toQuantity(lead[2]) : undefined;
		if (!qty || (lead[2] && (!qtyMax || qtyMax.value <= qty.value))) return undefined;
		let rest = lead[3];
		const u = leadingUnit(rest, lang);
		if (!u && looksLikeUnit(rest)) return undefined;
		// "c." alone is a cup, but "c. à …" is a spoon this list does not know: not a cup.
		if (u?.unit === 'cup' && /^à\s/i.test(u.rest)) return undefined;
		it = { name: '', qty, unit: u?.unit ?? 'piece' };
		if (qtyMax) it.qtyMax = qtyMax;
		rest = u ? u.rest : rest;
		const sized = u && u.unit !== 'piece' && CONTAINERS.includes(u.unit) ? containerSize(rest, lang) : undefined;
		if (sized) {
			size = sized.size;
			rest = sized.rest;
		}
		// "1 tasse (250 ml) de farine": the metric one goes in qty/unit, the other in alt.
		const paren = rest.match(/^\(([^)]*)\)\s*(.*)$/);
		if (paren) {
			const inner = paren[1].match(LEAD_RE);
			const innerUnit = inner ? leadingUnit(inner[3], lang) : undefined;
			const innerQty = inner ? toQuantity(inner[1]) : undefined;
			if (inner && innerUnit && innerQty && !innerUnit.rest && !inner[2]) {
				const metric = (['g', 'kg', 'ml', 'cl', 'l'] as Unit[]).includes(innerUnit.unit);
				if (metric && u) {
					it.alt = { qty: it.qty!, unit: it.unit! };
					it.qty = innerQty;
					it.unit = innerUnit.unit;
					if (it.qtyMax) {
						it.alt.qtyMax = it.qtyMax;
						delete it.qtyMax;
					}
				} else it.alt = { qty: innerQty, unit: innerUnit.unit };
				rest = paren[2];
			}
		}
		rest = rest.replace(/^(?:de |d['’]|of )/i, '');
		it.name = rest;
	}
	// A trailing "(…)" is a note; ", …" is the preparation.
	const note = trailingNote(it.name);
	if (note && size) return undefined;
	if (note) {
		it.name = note.name;
		it.note = note.note;
	} else if (size) it.note = size;
	const comma = it.name.indexOf(',');
	if (comma > 0) {
		it.prep = it.name.slice(comma + 1).trim();
		it.name = it.name.slice(0, comma).trim();
	}
	it.name = it.name.trim();
	if (!it.name || findQtyUnit(it.name) || (it.prep !== undefined && !it.prep)) return undefined;
	if (it.note && findQtyUnit(it.note) && it.unit && !CONTAINERS.includes(it.unit)) return undefined;
	return it;
}

/** One line on one line: NFC, spaces collapsed. */
const oneLine = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();

/**
 * One ingredient line → an entry. A line that does not read cleanly becomes
 * `{ name: "<the whole line> [?]" }` so the checker flags it for review
 * instead of losing it (the web import's rule).
 */
export function parseIngredientLine(line: string, lang: Lang): Ingredient {
	const text = oneLine(line);
	return readIngredientLine(text, lang) ?? { name: `${text} [?]` };
}

/**
 * « 1 pincée de sel » typed whole in a row's name (usability round 3): the
 * amount at its start, read by the same reader as « Coller une liste », for
 * the row's [Séparer : 1 · pincée · sel]. Undefined when the name does not
 * start with an amount or does not read cleanly (nothing is guessed).
 */
export function nameSplit(name: string, lang: Lang): Ingredient | undefined {
	const text = oneLine(name);
	if (!/^[\d½¼¾⅓⅔⅛]/.test(text)) return undefined;
	const it = readIngredientLine(text, lang);
	return it?.qty ? it : undefined;
}

// ---------------------------------------------------------------------------
// A pasted list

/** A list's bullet, never a number (« 2 tasses » is a quantity). */
const BULLET = /^(?:[-–—•*·▪◦□☐]|\[ ?\])\s*/;
/** « ## Pâte », « Pâte : », « POUR LA PÂTE: »: a heading line, short, no amount at its start. */
function headingOf(line: string): string | undefined {
	const md = line.match(/^#{1,6}\s+(.+)$/);
	if (md) return md[1].replace(/\s*:$/, '').trim() || undefined;
	if (line.length > 60 || !/:\s*$/.test(line) || /^[\d½¼¾⅓⅔⅛]/.test(line)) return undefined;
	const t = line.replace(/\s*:\s*$/, '').trim();
	return t || undefined;
}

export interface ListedIngredient {
	/** The line as she wrote it. */
	line: string;
	item: Ingredient;
	/** Read whole, nothing guessed; false: the whole line is the name, to check. */
	read: boolean;
}

export interface ListedGroup {
	/** A heading line before these items (« Pâte : »); undefined for the lines before any heading. */
	name?: string;
	items: ListedIngredient[];
}

/**
 * A pasted ingredient list: one ingredient per line, a heading line
 * (« Garniture : », « ## Pâte ») starts a group. Bullets are dropped; a
 * line « sel, au goût » is *au goût*. A line that does not read cleanly keeps
 * the whole line as its name and `read: false` — never a `[?]`, which the
 * form refuses in a name.
 */
export function parseIngredientList(text: string, lang: Lang): ListedGroup[] {
	const out: ListedGroup[] = [];
	let cur: ListedGroup | undefined;
	for (const raw of text.normalize('NFC').split(/\r?\n/)) {
		const line = oneLine(raw).replace(BULLET, '');
		if (!line) continue;
		const h = headingOf(line);
		if (h) {
			cur = { name: h, items: [] };
			out.push(cur);
			continue;
		}
		if (!cur) out.push((cur = { items: [] }));
		const it = readIngredientLine(line, lang);
		if (!it) {
			cur.items.push({ line, item: { name: line }, read: false });
			continue;
		}
		if (!it.qty && it.prep && /^(?:au goût|to taste)$/i.test(it.prep)) {
			delete it.prep;
			it.toTaste = true;
		}
		cur.items.push({ line, item: it, read: true });
	}
	return out.filter((g) => g.items.length || g.name);
}

export interface ListedStep {
	type: 'step' | 'heading';
	text: string;
}

const NUMBERED = /^\(?\d+\s*[.)–-]\s+/;

/**
 * Pasted steps. Numbered lines (« 1. », « 2) ») start steps and the lines
 * between join the step above (text copied from a page or a PDF breaks lines
 * anywhere); else blank lines separate steps when there are any; else one line
 * is one step. A short line ending in « : » is a section title.
 */
export function parseStepList(text: string): ListedStep[] {
	const all = text.normalize('NFC').split(/\r?\n/).map((l) => l.replace(/[ \t]+/g, ' ').trim());
	// Blank lines before the first line and after the last say nothing (a paste often ends with one).
	const from = all.findIndex(Boolean);
	const lines = from < 0 ? [] : all.slice(from, all.findLastIndex(Boolean) + 1);
	const out: ListedStep[] = [];
	const heading = (l: string) => (/^#{1,6}\s/.test(l) || (l.length <= 60 && /:$/.test(l) && !NUMBERED.test(l)) ? headingOf(l) : undefined);
	const push = (t: string) => {
		const s = t.replace(BULLET, '').trim();
		if (s) out.push({ type: 'step', text: s });
	};
	if (lines.some((l) => NUMBERED.test(l))) {
		let open = false;
		for (const l of lines) {
			if (!l) continue;
			const h = heading(l);
			if (NUMBERED.test(l)) {
				push(l.replace(NUMBERED, ''));
				open = out.length > 0 && out[out.length - 1].type === 'step';
			} else if (h) {
				out.push({ type: 'heading', text: h });
				open = false;
			} else if (open) out[out.length - 1].text += ' ' + l.replace(BULLET, '');
			else push(l);
		}
		return out;
	}
	if (lines.some((l) => !l)) {
		const paras: string[][] = [[]];
		for (const l of lines) {
			if (l) paras[paras.length - 1].push(l);
			else if (paras[paras.length - 1].length) paras.push([]);
		}
		for (const p of paras) {
			if (!p.length) continue;
			const h = p.length === 1 ? heading(p[0]) : undefined;
			if (h) out.push({ type: 'heading', text: h });
			else if (p.every((l) => BULLET.test(l))) p.forEach(push);
			else push(p.join(' '));
		}
		return out;
	}
	for (const l of lines) {
		if (!l) continue;
		const h = heading(l);
		if (h) out.push({ type: 'heading', text: h });
		else push(l);
	}
	return out;
}
