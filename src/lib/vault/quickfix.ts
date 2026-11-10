// Quick fixes the paste box offers for errors it can settle without the AI
// (docs/VALIDATION.md, "Quick fixes in the paste box"): where a frontmatter
// that does not read goes wrong (E002), one line realigned, a title or the
// format version added (E101, E110), "1 1/2 tasse" split into qty and unit
// (E204), an ingredient line left whole read into an entry (E207), bare step
// lines put under a method heading and step-like lines written as steps
// (W401, W403), a preparation word moved out of a name (W302), a source
// type picked from the list (E106), a time written in the format (E109). Each fix is a
// list of edits on one file's text (normalized, as the checker reads it), and
// is offered only when the file, checked again with it, no longer has the
// problem and gains no error. Never a change of the rules: the fixed text is
// checked like any other. Browser-safe.

import { isMap, isScalar, isSeq, parseDocument, type Node, type Pair } from 'yaml';
import { checkFile, type CheckOptions } from './check';
import { methodBlocks } from './body';
import { pathTokens, yamlScalar } from './locate';
import { normalizeText } from './normalize';
import { parseQuantity } from './quantity';
import { UNITS, type Diagnostic, type Lang, type SourceType, type Unit } from './types';
import { findAllQtyUnits, headingKind, SCHEMA_VERSIONS, SOURCE_TYPES, unitForAlias } from './vocab';
import { parseDuration, suggestDuration } from './duration';
import { findAtEdge, nameWords, type CheckWords } from './words';
import { itemFlow } from './serialize';
import type { Ingredient } from './types';
import { parseIngredientList } from '../form/lineparse';

/** Replace `start`–`end` (file offsets, end excluded) with `text`. */
export interface Edit {
	start: number;
	end: number;
	text: string;
}

export interface Fix {
	edits: Edit[];
	/** The file once fixed. */
	result: string;
}

/** Apply edits to a text, last first so the offsets hold. */
export function applyEdits(text: string, edits: Edit[], base = 0): string {
	let out = text;
	for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, base + e.start) + e.text + out.slice(base + e.end);
	return out;
}

interface Split {
	text: string;
	lines: string[];
	/** Index of the closing `---` line. */
	end: number;
	/** Offset of the first frontmatter line. */
	yamlStart: number;
	yamlText: string;
	/** Offset of each line's start. */
	starts: number[];
}

function split(file: string): Split | null {
	const text = normalizeText(file);
	const lines = text.split('\n');
	if (lines[0]?.trimEnd() !== '---') return null;
	const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---');
	if (end === -1) return null;
	const starts: number[] = [];
	let at = 0;
	for (const l of lines) {
		starts.push(at);
		at += l.length + 1;
	}
	return { text, lines, end, yamlStart: starts[1], yamlText: lines.slice(1, end).join('\n'), starts };
}

const parse = (yamlText: string) => parseDocument(yamlText, { version: '1.2', uniqueKeys: true });

/** The frontmatter reads as a mapping, as the checker needs (no E002). */
function reads(yamlText: string): boolean {
	const doc = parse(yamlText);
	if (doc.errors.length) return false;
	try {
		const js = doc.toJS();
		return js === null || (typeof js === 'object' && !Array.isArray(js));
	} catch {
		return false;
	}
}

const errorsOf = (ds: Diagnostic[]) => ds.filter((d) => d.severity === 'error');

/** The fix holds: `gone` no longer fires, and no error appears that the file did not have. */
function holds(before: string, after: string, gone: (d: Diagnostic) => boolean, opts: CheckOptions = {}): boolean {
	const key = (d: Diagnostic) => `${d.code}|${d.path}`;
	const was = new Set(errorsOf(checkFile(before, opts).diagnostics).map(key));
	const now = checkFile(after, opts).diagnostics;
	return !now.some(gone) && errorsOf(now).every((d) => was.has(key(d)));
}

function fixOf(s: Split, edits: Edit[]): Fix {
	return { edits, result: applyEdits(s.text, edits) };
}

// --- E002: where the frontmatter stops reading --------------------------------

export interface YamlTrouble {
	/** Line index in the file (0 is the opening `---`). */
	line: number;
	/** Column of the parser's position on that line, from 0. */
	col: number;
	/** The line as written. */
	text: string;
	/** The line before it, for context; undefined on the first frontmatter line. */
	before?: string;
	/** The line's content in the file (indentation left out): what "Montrer dans le texte" selects. */
	span: { start: number; end: number };
	/** One line realigned with its neighbours makes the frontmatter read: the line, the indentation it gets. */
	realign?: { line: number; from: number; to: number; fix: Fix };
}

const indentOf = (l: string) => /^ */.exec(l)![0].length;
const isDash = (l: string) => /^ *-(?: |$)/.test(l);
const blank = (l: string) => l.trim() === '' || /^\s*#/.test(l);

/**
 * Where an E002 frontmatter stops reading, from the YAML parser's first
 * error: its line in the file, the column, the line before for context. Null
 * when the frontmatter reads (its E002 is an alias or not a mapping: no place).
 */
export function yamlTrouble(file: string): YamlTrouble | null {
	const s = split(file);
	if (!s) return null;
	const doc = parse(s.yamlText);
	const err = doc.errors[0];
	if (!err) return null;
	const pos = Math.min(err.pos[0], s.yamlText.length);
	const yl = s.yamlText.slice(0, pos).split('\n').length - 1;
	const col = pos - (s.yamlText.lastIndexOf('\n', pos - 1) + 1);
	const line = yl + 1;
	const out: YamlTrouble = {
		line,
		col,
		text: s.lines[line] ?? '',
		before: line > 1 ? s.lines[line - 1] : undefined,
		span: lineSpan(s, line)
	};
	const end = Math.min(err.pos[1], s.yamlText.length);
	const yEnd = s.yamlText.slice(0, end).split('\n').length - 1;
	const realign = realignFor(s, yl, Math.max(yl, yEnd));
	if (realign) {
		out.realign = realign;
		// The line the fix moves is the one to show.
		if (realign.line !== line) {
			out.line = realign.line;
			out.text = s.lines[realign.line];
			out.before = realign.line > 1 ? s.lines[realign.line - 1] : undefined;
			out.col = indentOf(out.text);
			out.span = lineSpan(s, realign.line);
		}
	}
	return out;
}

function lineSpan(s: Split, line: number): { start: number; end: number } {
	const l = s.lines[line] ?? '';
	const start = s.starts[line] + indentOf(l);
	return { start, end: Math.max(start, s.starts[line] + l.trimEnd().length) };
}

/**
 * One frontmatter line whose indentation is off from its neighbours (a list
 * item one space too far, a key under its siblings' column): the
 * indentation, taken from the line above or the one below, that makes the
 * whole frontmatter read. A list item aligns with a list item, a key with a
 * key (or the text after a neighbour's `- `). Lines from the error's first to
 * one past its last, then the one before. Nothing when no single move works.
 */
function realignFor(s: Split, from: number, to: number): YamlTrouble['realign'] | undefined {
	const ylines = s.yamlText.split('\n');
	const order = [];
	for (let l = from; l <= Math.min(to + 1, ylines.length - 1); l++) order.push(l);
	if (from > 0) order.push(from - 1);
	for (const yl of order) {
		const line = ylines[yl];
		if (blank(line) || /^\s*\t/.test(line)) continue;
		const ind = indentOf(line);
		const near = (step: number) => {
			for (let k = yl + step; k >= 0 && k < ylines.length; k += step) if (!blank(ylines[k])) return ylines[k];
			return undefined;
		};
		const targets: number[] = [];
		for (const nb of [near(-1), near(1)]) {
			if (nb === undefined) continue;
			if (isDash(line)) {
				if (isDash(nb)) targets.push(indentOf(nb));
			} else if (isDash(nb)) {
				if (/^ *- +[^\s#{[-][^:]*:(?: |$)/.test(nb)) targets.push(/^ *- +/.exec(nb)![0].length);
			} else if (/^ *[^\s#][^:]*:(?: |$)/.test(nb)) targets.push(indentOf(nb));
		}
		for (const t of [...new Set(targets)]) {
			if (t === ind) continue;
			const moved = [...ylines];
			moved[yl] = ' '.repeat(t) + line.slice(ind);
			if (!reads(moved.join('\n'))) continue;
			const fileLine = yl + 1;
			const at = s.starts[fileLine];
			return { line: fileLine, from: ind, to: t, fix: fixOf(s, [{ start: at, end: at + ind, text: ' '.repeat(t) }]) };
		}
	}
	return undefined;
}

// --- E110: the format version --------------------------------------------------

const SCHEMA = SCHEMA_VERSIONS[SCHEMA_VERSIONS.length - 1];

/** `schema` missing: `schema: 3` as the frontmatter's first line (an empty `schema:` line filled). Never a version replaced. */
export function schemaFix(file: string): Fix | null {
	const s = split(file);
	if (!s) return null;
	const ylines = s.yamlText.split('\n');
	const empty = ylines.findIndex((l) => /^schema[ \t]*:[ \t]*(?:#.*)?$/.test(l));
	if (empty === -1 && ylines.some((l) => /^schema[ \t]*:/.test(l))) return null;
	const edit: Edit =
		empty === -1
			? { start: s.yamlStart, end: s.yamlStart, text: `schema: ${SCHEMA}\n` }
			: { start: s.starts[empty + 1], end: s.starts[empty + 1] + ylines[empty].length, text: `schema: ${SCHEMA}` };
	const fix = fixOf(s, [edit]);
	return holds(s.text, fix.result, (d) => d.code === 'E110') ? fix : null;
}

// --- E101: the title -------------------------------------------------------------

/** `title` missing: `title: …` written after `schema` (or first), an empty `title:` line filled. */
export function titleFix(file: string, title: string): Fix | null {
	const s = split(file);
	const value = title.normalize('NFC').replace(/\s+/g, ' ').trim();
	if (!s || !value) return null;
	const ylines = s.yamlText.split('\n');
	const line = `title: ${yamlScalar(value)}`;
	const empty = ylines.findIndex((l) => /^title[ \t]*:[ \t]*(?:#.*)?$/.test(l));
	let edit: Edit;
	if (empty !== -1) edit = { start: s.starts[empty + 1], end: s.starts[empty + 1] + ylines[empty].length, text: line };
	else if (ylines.some((l) => /^title[ \t]*:/.test(l))) return null;
	else {
		const schema = ylines.findIndex((l) => /^schema[ \t]*:/.test(l));
		const at = schema === -1 ? s.yamlStart : s.starts[schema + 2] ?? s.yamlStart;
		edit = { start: at, end: at, text: line + '\n' };
	}
	const fix = fixOf(s, [edit]);
	return holds(s.text, fix.result, (d) => d.code === 'E101') ? fix : null;
}

const strip = (l: string) =>
	l
		.replace(/^#{1,6}\s+/, '')
		.replace(/[*_`]/g, '')
		.replace(/\s+/g, ' ')
		.trim();

/** A title to offer for a file without one: the body's first heading that is not a section's, else its first line of text. */
export function titleGuess(file: string): string {
	const s = split(file);
	if (!s) return '';
	const body = s.lines.slice(s.end + 1);
	for (const l of body) {
		const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(l);
		if (h && headingKind(h[1]) === 'other') return cap(strip(h[1]));
	}
	const first = body.find((l) => l.trim() && !/^#{1,6}\s/.test(l) && !/^\s{0,3}(?:\d+[.)]|[-*])\s/.test(l));
	return first ? cap(strip(first)) : '';
}

const cap = (t: string) => (t.length > 80 ? '' : t);

// --- E204: "1 1/2 tasse" in a quantity -------------------------------------------

const VULGAR: Record<string, string> = { '½': '1/2', '¼': '1/4', '¾': '3/4', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8' };

/** The node a path names in the frontmatter, with the map holding its last key. */
function nodeAt(yamlText: string, path: string): { parent: Node; pair: Pair } | null {
	const tokens = pathTokens(path);
	if (!tokens) return null;
	const doc = parse(yamlText);
	if (doc.errors.length) return null;
	let node: unknown = doc.contents;
	for (let i = 0; i < tokens.length; i++) {
		const k = tokens[i];
		if (typeof k === 'number') {
			if (!isSeq(node)) return null;
			node = node.items[k];
		} else {
			if (!isMap(node)) return null;
			const pair = node.items.find((p) => isScalar(p.key) && p.key.value === k);
			if (!pair) return null;
			if (i === tokens.length - 1) return { parent: node, pair };
			node = pair.value;
		}
	}
	return null;
}

/** A number as she wrote it, as `qty` takes it: `2`, `0.5`, `"1 1/2"`; vulgar fractions spelled out (`1½` → `"1 1/2"`). */
function qtyOf(raw: string): string | undefined {
	let t = raw.trim().replace(/^(\d+)\s*-\s*(\d+\/\d+)$/, '$1 $2');
	const v = /^(\d*)\s*([½¼¾⅓⅔⅛])$/.exec(t);
	if (v) t = v[1] ? `${v[1]} ${VULGAR[v[2]]}` : VULGAR[v[2]];
	if (!parseQuantity(/^\d+(?:\.\d+)?$/.test(t) ? Number(t) : t).ok) return undefined;
	return /^\d+(?:\.\d+)?$/.test(t) ? t : JSON.stringify(t);
}

/**
 * A quantity that holds its unit (`qty: 1 1/2 tasse`): the number in `qty`,
 * the unit's code in `unit` — only when the number reads, the words are one
 * unit the alias table knows, and the line has no other unit.
 */
export function splitQtyFix(file: string, path: string | null | undefined, lang: Lang): { qty: string; unit: Unit; fix: Fix } | null {
	if (!path || !/\.qty$/.test(path)) return null;
	const s = split(file);
	if (!s) return null;
	const at = nodeAt(s.yamlText, path);
	if (!at || !isScalar(at.pair.value) || typeof at.pair.value.value !== 'string' || !at.pair.value.range) return null;
	const m = /^\s*(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+|\d+\s*-\s*\d+\/\d+|\d*\s*[½¼¾⅓⅔⅛])\s*(\p{L}.*?)\s*$/u.exec(at.pair.value.value.normalize('NFC'));
	if (!m) return null;
	const qty = qtyOf(m[1]);
	const word = m[2].replace(/\s+/g, ' ');
	const unit = (UNITS as readonly string[]).includes(word) ? (word as Unit) : (unitForAlias(word, lang) ?? undefined);
	if (!qty || !unit) return null;
	const parent = at.parent;
	if (!isMap(parent)) return null;
	const had = parent.items.find((p) => isScalar(p.key) && p.key.value === 'unit');
	if (had && !(isScalar(had.value) && had.value.value === unit)) return null;
	const [vs, ve] = at.pair.value.range;
	const edits: Edit[] = [{ start: s.yamlStart + vs, end: s.yamlStart + ve, text: qty }];
	if (!had) {
		const key = at.pair.key as Node;
		if (!key.range) return null;
		const keyAt = s.yamlStart + key.range[0];
		const col = keyAt - (s.text.lastIndexOf('\n', keyAt - 1) + 1);
		edits.push({ start: s.yamlStart + ve, end: s.yamlStart + ve, text: parent.flow ? `, unit: ${unit}` : `\n${' '.repeat(col)}unit: ${unit}` });
	}
	const fix = fixOf(s, edits);
	const item = path.replace(/\.qty$/, '');
	const ok = holds(s.text, fix.result, (d) => d.path === path || ((d.code === 'E203' || d.code === 'E201') && (d.path === item || d.path === `${item}.unit`)));
	return ok ? { qty, unit, fix } : null;
}

// --- E210: "500 g de lait" in a name ---------------------------------------------

/**
 * A name that holds the line's quantity and unit (`name: 500 g de lait`, an
 * entry with no `qty` or `unit` of its own): the number in `qty`, the unit's
 * code in `unit`, the rest the name (« de »/« of » dropped, a marker kept) —
 * only when the name holds one amount, its unit is one the alias table knows,
 * and the file, checked again, loses that E210 and gains no error. Used by the
 * paste box ("Séparer en 500 ml + lait") and run by the web import on its own
 * output (docs/VALIDATION.md, "Quick fixes in the paste box").
 */
export function nameQtyFix(file: string, path: string | null | undefined, lang: Lang): { qty: string; unit: Unit; name: string; fix: Fix } | null {
	if (!path || !/^ingredients\[\d+\]\.items\[\d+\](?:\.or\[\d+\])?\.name$/.test(path)) return null;
	const s = split(file);
	if (!s) return null;
	const at = nodeAt(s.yamlText, path);
	if (!at || !isScalar(at.pair.value) || typeof at.pair.value.value !== 'string' || !at.pair.value.range) return null;
	const parent = at.parent;
	if (!isMap(parent) || parent.items.some((p) => isScalar(p.key) && (p.key.value === 'qty' || p.key.value === 'unit'))) return null;
	const written = at.pair.value.value.normalize('NFC');
	const amounts = findAllQtyUnits(written);
	if (amounts.length !== 1) return null;
	const m = amounts[0];
	const unit = unitForAlias(m.unitText, lang);
	const qty = qtyOf(m.qty.replace(',', '.'));
	if (!unit || !qty) return null;
	const name = (written.slice(0, m.start) + ' ' + written.slice(m.end))
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^(?:de |d['’]|of )/i, '')
		.replace(/^[\s,:;–—-]+|[\s,:;–—-]+$/g, '')
		// « beurre : [?] »: the colon that led to the amount goes too, the marker stays.
		.replace(/\s*[,:;–—-]+\s*(?=\[[^\]]*\]$)/, ' ')
		.trim();
	if (!name || /^\[[^\]]*\]$/.test(name)) return null;
	const key = at.pair.key as Node;
	if (!key.range) return null;
	const [vs, ve] = at.pair.value.range;
	const keyAt = s.yamlStart + key.range[0];
	const col = keyAt - (s.text.lastIndexOf('\n', keyAt - 1) + 1);
	const edits: Edit[] = [
		// Before `name`: `qty` and `unit`, as the format writes an entry.
		{ start: keyAt, end: keyAt, text: parent.flow ? `qty: ${qty}, unit: ${unit}, ` : `qty: ${qty}\n${' '.repeat(col)}unit: ${unit}\n${' '.repeat(col)}` },
		{ start: s.yamlStart + vs, end: s.yamlStart + ve, text: yamlScalar(name) }
	];
	const fix = fixOf(s, edits);
	return holds(s.text, fix.result, (d) => d.code === 'E210' && d.path === path) ? { qty, unit, name, fix } : null;
}

/**
 * Every E210 and E204 of a file the box can split by itself, split, one after
 * the other (each checked again, as a tap would): what the web import runs on
 * its own output before showing it. The file unchanged when none holds.
 */
export function splitAll(file: string, lang: Lang, opts: CheckOptions = {}): string {
	let text = normalizeText(file);
	for (let round = 0; round < 50; round++) {
		const ds = checkFile(text, opts).diagnostics;
		let next: Fix | null = null;
		for (const d of ds) {
			if (d.code === 'E210') next = nameQtyFix(text, d.path, lang)?.fix ?? null;
			else if (d.code === 'E204') next = splitQtyFix(text, d.path, lang)?.fix ?? null;
			if (next) break;
		}
		if (!next) return text;
		text = next.result;
	}
	return text;
}

// --- E207: an ingredient line left whole --------------------------------------------

const ENTRY_PATH = /^ingredients\[\d+\]\.items\[\d+\]$/;

/** The plain-string item a path names (`- 1 1/2 tasse de lait`): its text and its range in the frontmatter. */
function plainItemAt(yamlText: string, path: string): { value: string; range: [number, number] } | null {
	const tokens = pathTokens(path);
	if (!tokens) return null;
	const doc = parse(yamlText);
	if (doc.errors.length) return null;
	let node: unknown = doc.contents;
	for (const k of tokens) {
		if (typeof k === 'number') {
			if (!isSeq(node)) return null;
			node = node.items[k];
		} else {
			if (!isMap(node)) return null;
			node = node.items.find((p) => isScalar(p.key) && p.key.value === k)?.value;
		}
	}
	if (!isScalar(node) || typeof node.value !== 'string' || !node.range) return null;
	return { value: node.value, range: [node.range[0], node.range[1]] };
}

/** One line read whole by « Coller une liste »'s reader (src/lib/form/lineparse.ts), or nothing: never a guess. */
function readLine(value: string, lang: Lang): Ingredient | undefined {
	const groups = parseIngredientList(value, lang);
	const only = groups.length === 1 && !groups[0].name && groups[0].items.length === 1 ? groups[0].items[0] : undefined;
	return only?.read ? only.item : undefined;
}

/**
 * Ingredient lines written whole, as plain strings (`- 1 1/2 tasse de lait`,
 * E207): each read with the line reader of « Coller une liste » and written as
 * an entry (`{ qty: "1 1/2", unit: cup, name: lait }`) — only lines that read
 * whole (the reader guesses nothing), and only when the file, checked again,
 * loses those E207 and gains no error. Several paths: all of them in one fix
 * (« Lire partout »), or nothing.
 */
export function entryFix(file: string, paths: (string | null | undefined)[], lang: Lang): { items: Ingredient[]; fix: Fix } | null {
	const s = split(file);
	if (!s || !paths.length) return null;
	const items: Ingredient[] = [];
	const edits: Edit[] = [];
	for (const path of paths) {
		if (!path || !ENTRY_PATH.test(path)) return null;
		const at = plainItemAt(s.yamlText, path);
		const item = at ? readLine(at.value.normalize('NFC'), lang) : undefined;
		if (!at || !item) return null;
		items.push(item);
		edits.push({ start: s.yamlStart + at.range[0], end: s.yamlStart + at.range[1], text: itemFlow(item) });
	}
	const fix = fixOf(s, edits);
	const gone = new Set(paths);
	return holds(s.text, fix.result, (d) => d.code === 'E207' && gone.has(d.path)) ? { items, fix } : null;
}

/** E207 on a plain-string item: the line is there, only not split into quantity, unit and name. */
export function isPlainLine(file: string, path: string | null | undefined): boolean {
	const s = path && ENTRY_PATH.test(path) ? split(file) : null;
	return !!s && !!plainItemAt(s.yamlText, path!);
}

// --- W401 / E301: bare step lines, no method heading --------------------------------

const STEP_LINE = /^\s{0,3}(?:\d+[.)]|[-*])\s+\S/;
const BREAK_LINE = /^\s{0,3}([-*])(?:[ \t]*\1){2,}[ \t]*$/;

/**
 * Steps written as list lines with no method section — before any heading
 * (W401), or under a heading that is no section's, often the title written
 * again (`# Galette`, E301): `## Préparation` (`## Instructions` in English)
 * put right above the first of them. The number of steps it makes.
 */
export function methodFix(file: string, lang: Lang): { steps: number; fix: Fix } | null {
	const s = split(file);
	if (!s) return null;
	const body = s.lines.slice(s.end + 1);
	if (body.some((l) => { const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(l); return !!h && headingKind(h[1]) === 'method'; })) return null;
	const first = body.findIndex((l) => STEP_LINE.test(l) && !BREAK_LINE.test(l));
	if (first === -1) return null;
	const next = body.findIndex((l, i) => i > first && /^#{1,2}\s/.test(l));
	const steps = methodBlocks(body.slice(first, next === -1 ? undefined : next)).filter((b) => b.type === 'step').length;
	if (!steps) return null;
	const at = s.starts[s.end + 1 + first];
	const before = first > 0 && body[first - 1].trim() !== '' ? '\n' : '';
	const fix = fixOf(s, [{ start: at, end: at, text: `${before}## ${lang === 'en' ? 'Instructions' : 'Préparation'}\n\n` }]);
	const after = checkFile(fix.result);
	if (after.diagnostics.some((d) => d.code === 'W401' || d.code === 'E301') || !after.body || after.body.steps.length !== steps) return null;
	return holds(s.text, fix.result, (d) => d.code === 'W401' || d.code === 'E301') ? { steps, fix } : null;
}

// --- W401 / W403: lines that look like steps, none read as one ------------------------

/** A numbered step written another way: `Étape 2 : …`, `2 - …`, `2.Cuire`, or `2. …` indented 4 spaces or more (Markdown's code, not a list). */
const LOOSE_NUMBERED = /^\s*(?:(?:étape|etape|step)\s*)?(\d{1,2})\s*[.):–—-]\s*(\S.*)$/iu;
/** A bullet indented 4 spaces or more. */
const LOOSE_BULLET = /^\s{4,}[-*]\s+(\S.*)$/;

export interface StepsFix {
	steps: number;
	/** The first such line: its line in the file (0 is the opening `---`) and its text, as written. */
	first: { line: number; text: string };
	fix: Fix;
}

/**
 * Lines that look like steps but none is read as one — `Étape 1 : …`,
 * `1 - …`, `1.Mélanger`, a list indented 4 spaces (read as code): each written
 * `1. …` at the margin, `## Préparation` (`## Instructions`) put above the
 * first when the file has no method heading. Only when no step is read, the
 * numbered ones run 1, 2, 3… in order, and the file, checked again, reads that
 * many steps, loses W401 / W403 / E301 and gains no error. Bare list lines
 * with no heading are `methodFix`'s.
 */
export function stepsFix(file: string, lang: Lang): StepsFix | null {
	const s = split(file);
	if (!s) return null;
	const before = checkFile(s.text);
	if (!before.body || before.body.steps.length) return null;
	const body = s.lines.slice(s.end + 1);
	const method = body.findIndex((l) => {
		const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(l);
		return !!h && headingKind(h[1]) === 'method';
	});
	const from = method + 1;
	const stop = body.findIndex((l, i) => i >= from && /^#{1,2}\s/.test(l));
	const region = body.slice(from, stop === -1 ? undefined : stop);
	if (method === -1 && region.some((l) => STEP_LINE.test(l) && !BREAK_LINE.test(l))) return null;
	const found: { at: number; text: string }[] = [];
	let n = 0;
	for (let i = 0; i < region.length; i++) {
		const l = region[i];
		if (/^#{1,6}\s/.test(l)) continue;
		const num = LOOSE_NUMBERED.exec(l);
		if (num) {
			if (Number(num[1]) !== n + 1) return null;
			n++;
			found.push({ at: from + i, text: num[2].trim() });
			continue;
		}
		const bullet = LOOSE_BULLET.exec(l);
		if (bullet) found.push({ at: from + i, text: bullet[1].trim() });
	}
	if (!found.length) return null;
	const edits: Edit[] = found.map((f, k) => {
		const line = s.end + 1 + f.at;
		return { start: s.starts[line], end: s.starts[line] + s.lines[line].length, text: `${k + 1}. ${f.text}` };
	});
	if (method === -1) {
		const at = s.starts[s.end + 1 + found[0].at];
		const blankBefore = found[0].at > 0 && body[found[0].at - 1].trim() !== '' ? '\n' : '';
		edits.push({ start: at, end: at, text: `${blankBefore}## ${lang === 'en' ? 'Instructions' : 'Préparation'}\n\n` });
	}
	const fix = fixOf(s, edits);
	const after = checkFile(fix.result);
	if (!after.body || after.body.steps.length !== found.length) return null;
	if (after.diagnostics.some((d) => d.code === 'W401' || d.code === 'W403' || d.code === 'E301')) return null;
	if (!holds(s.text, fix.result, (d) => d.code === 'W401' || d.code === 'W403' || d.code === 'E301')) return null;
	const line = s.end + 1 + found[0].at;
	return { steps: found.length, first: { line, text: s.lines[line] }, fix };
}

// --- W302: a preparation word in the name ------------------------------------------

/**
 * `name: beurre fondu` → `name: beurre` and `prep: fondu` (added before a
 * `prep` already there, as the checker's own fix says): the word the vault's
 * participle list finds at the name's edge. Only on an ingredient entry's
 * `name` (not a plain `or` option), and only when the file, checked again
 * with the same word lists, loses that W302 and gains no error.
 */
export function prepFix(file: string, path: string | null | undefined, words: CheckWords | undefined): { name: string; prep: string; fix: Fix } | null {
	if (!path || !/\.name$/.test(path) || !words?.participles) return null;
	const s = split(file);
	if (!s) return null;
	const at = nodeAt(s.yamlText, path);
	if (!at || !isScalar(at.pair.value) || typeof at.pair.value.value !== 'string' || !at.pair.value.range) return null;
	const parent = at.parent;
	if (!isMap(parent)) return null;
	const m = findAtEdge(nameWords(at.pair.value.value), words.participles);
	if (!m || !m.rest) return null;
	const [vs, ve] = at.pair.value.range;
	const edits: Edit[] = [{ start: s.yamlStart + vs, end: s.yamlStart + ve, text: yamlScalar(m.rest) }];
	const had = parent.items.find((p) => isScalar(p.key) && p.key.value === 'prep');
	if (had) {
		if (!isScalar(had.value) || typeof had.value.value !== 'string' || !had.value.range) return null;
		const old = had.value.value.trim();
		const [ps, pe] = had.value.range;
		edits.push({ start: s.yamlStart + ps, end: s.yamlStart + pe, text: yamlScalar(old ? `${m.text}, ${old}` : m.text) });
	} else {
		const key = at.pair.key as Node;
		if (!key.range) return null;
		const keyAt = s.yamlStart + key.range[0];
		const col = keyAt - (s.text.lastIndexOf('\n', keyAt - 1) + 1);
		edits.push({
			start: s.yamlStart + ve,
			end: s.yamlStart + ve,
			text: parent.flow ? `, prep: ${yamlScalar(m.text)}` : `\n${' '.repeat(col)}prep: ${yamlScalar(m.text)}`
		});
	}
	const fix = fixOf(s, edits);
	const ok = holds(s.text, fix.result, (d) => d.code === 'W302' && d.path === path, { words });
	return ok ? { name: m.rest, prep: m.text, fix } : null;
}

// --- E106: a source type out of the list; E109: a time out of the format --------

/** One scalar the path names exactly, replaced by `text`: the fix, when the file checked again holds it. */
function replaceScalar(file: string, path: string, text: string, gone: (d: Diagnostic) => boolean): Fix | null {
	const s = split(file);
	if (!s) return null;
	const at = nodeAt(s.yamlText, path);
	if (!at || !isScalar(at.pair.value) || !at.pair.value.range) return null;
	const [vs, ve] = at.pair.value.range;
	const fix = fixOf(s, [{ start: s.yamlStart + vs, end: s.yamlStart + ve, text }]);
	return holds(s.text, fix.result, gone) ? fix : null;
}

/**
 * `source.type` not in the list (`type: card`): one fix per allowed type,
 * the code written (`family`, `book`…), for the paste box's one button per
 * type (« Écrire family (recette personnelle) »). Nothing guessed: the
 * person picks. Only `source.type` itself, never a `source` that is not a
 * mapping. Empty when the path is another or no type would hold.
 */
export function sourceTypeFixes(file: string, path: string | null | undefined): { type: SourceType; fix: Fix }[] {
	if (path !== 'source.type') return [];
	return SOURCE_TYPES.flatMap((type) => {
		const fix = replaceScalar(file, path, type, (d) => d.code === 'E106' && d.path === path);
		return fix ? [{ type, fix }] : [];
	});
}

/**
 * A time written another way (`cook: 40 min`, `prep: 1 h 15`): the format
 * (`40m`, `1h15m`), when it reads it with no doubt (`suggestDuration`: a
 * bare number, hours or minutes unsaid, is never guessed). The words after
 * the time (« de réfrigération ») would be dropped: no fix then — they belong
 * in the steps, as the checker says.
 */
export function durationFix(file: string, path: string | null | undefined): { value: string; fix: Fix } | null {
	if (!path || !/^times\.(?:prep|cook|rest|total)$/.test(path)) return null;
	const s = split(file);
	if (!s) return null;
	const at = nodeAt(s.yamlText, path);
	if (!at || !isScalar(at.pair.value) || typeof at.pair.value.value !== 'string') return null;
	const written = at.pair.value.value;
	if (parseDuration(written) || /\s(?:de|d'|d’|pour|au|dans|of|for|in)\b/i.test(written)) return null;
	const value = suggestDuration(written);
	if (!value) return null;
	const fix = replaceScalar(file, path, value, (d) => d.code === 'E109' && d.path === path);
	return fix ? { value, fix } : null;
}

// --- W305: the known ingredients a name resembles ----------------------------------

/** The registry slugs a W305 names (src/lib/ingredients/resolve.ts writes them in its message). */
export function resemblesSlugs(d: Pick<Diagnostic, 'code' | 'message'>): string[] {
	if (d.code !== 'W305') return [];
	const m = /several ingredients \(([^)]*)\)|the resolve queue suggests (.+?)\.$/.exec(d.message);
	const list = m?.[1] ?? m?.[2];
	return list ? list.split(', ').filter((x) => /^[a-z0-9-]+$/.test(x)) : [];
}

/** W305 says "several ingredients": the name is ambiguous, not merely unknown. */
export const ambiguous = (d: Pick<Diagnostic, 'message'>) => /several ingredients/.test(d.message);
