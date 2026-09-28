// prices.csv (docs/STORAGE.md, "Prices are an append-only log"; plan 03,
// Phase 4): parse the file, pick the current price per ingredient, flag stale
// rows, and write one new line. Generic: the currency is the config's, shops
// are free text, units are the canonical list. Browser-safe.
//
// The file is data, not a recipe: a problem is reported with its line number
// (codes E812–W815, docs/VALIDATION.md "Price codes"), and a line that does
// not read is skipped, never fatal.

import { SLUG_RE } from '../vault/slug';
import { UNITS, type Unit } from '../vault/types';

export const PRICES_FILE = 'prices.csv';
export const PRICE_COLUMNS = ['date', 'ingredient', 'amount', 'currency', 'pack_qty', 'pack_unit', 'shop', 'note'] as const;
export const PRICE_HEADER = PRICE_COLUMNS.join(',');
const REQUIRED = ['date', 'ingredient', 'amount', 'pack_qty', 'pack_unit'] as const;

export interface PriceRow {
	/** Line number in the file (1-based), for problems and same-day ties. */
	line: number;
	/** YYYY-MM-DD. */
	date: string;
	/** Registry slug. */
	ingredient: string;
	/** What was paid for the pack. */
	amount: number;
	/** ISO 4217 code, uppercase. */
	currency: string;
	packQty: number;
	packUnit: Unit;
	shop: string;
	note: string;
}

export interface PriceProblem {
	code: 'E812' | 'E813' | 'W814' | 'W815';
	severity: 'error' | 'warning';
	/** 1-based line number in prices.csv. */
	line: number;
	message: string;
	fix?: string;
}

export interface ParseOptions {
	/** The config's currency: fills an empty `currency` cell, and a row in another one is W815. */
	currency: string;
	/** Registry slugs; when given, a row for another slug is W814. */
	slugs?: ReadonlySet<string>;
}

/** Split CSV text into records of cells, each with the line it starts on. RFC 4180 quoting. */
export function csvRecords(text: string): { line: number; cells: string[] }[] {
	const s = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').normalize('NFC');
	const out: { line: number; cells: string[] }[] = [];
	let line = 1;
	let start = 1;
	let cells: string[] = [];
	let cell = '';
	let quoted = false;
	let any = false;
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (quoted) {
			if (ch === '"') {
				if (s[i + 1] === '"') {
					cell += '"';
					i++;
				} else quoted = false;
			} else {
				if (ch === '\n') line++;
				cell += ch;
			}
			continue;
		}
		if (ch === '"' && cell === '') {
			quoted = true;
			any = true;
		} else if (ch === ',') {
			cells.push(cell);
			cell = '';
			any = true;
		} else if (ch === '\n') {
			cells.push(cell);
			if (any || cell !== '') out.push({ line: start, cells });
			cells = [];
			cell = '';
			any = false;
			start = ++line;
		} else {
			cell += ch;
			if (ch.trim()) any = true;
		}
	}
	cells.push(cell);
	if (any || cell !== '') out.push({ line: start, cells });
	return out;
}

/** A number as a spreadsheet may write it: `0.89`, `0,89` (a decimal comma, in a quoted cell), `1 000`. */
function num(s: string): number | undefined {
	const t = s.trim().replace(/[\s  ]/g, '').replace(',', '.');
	if (!/^\d+(?:\.\d+)?$|^\.\d+$/.test(t)) return undefined;
	return Number(t);
}

/** A real calendar date written YYYY-MM-DD. */
export function validDate(s: string): boolean {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
	if (!m) return false;
	const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
	return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Parse prices.csv. Lines that do not read are skipped and reported. */
export function parsePrices(text: string, opts: ParseOptions): { rows: PriceRow[]; problems: PriceProblem[] } {
	const records = csvRecords(text);
	const problems: PriceProblem[] = [];
	const rows: PriceRow[] = [];
	if (!records.length) return { rows, problems };
	const header = records[0].cells.map((c) => c.trim().toLowerCase());
	const missing = REQUIRED.filter((c) => !header.includes(c));
	if (missing.length) {
		problems.push({
			code: 'E812',
			severity: 'error',
			line: records[0].line,
			message: `the first line of prices.csv must be the header; it lacks ${missing.map((c) => `\`${c}\``).join(', ')}.`,
			fix: `Start the file with \`${PRICE_HEADER}\`.`
		});
		return { rows, problems };
	}
	const col = (name: string) => header.indexOf(name);
	const at = (cells: string[], name: string) => (col(name) >= 0 ? (cells[col(name)] ?? '').trim() : '');
	const currency = opts.currency.toUpperCase();
	for (const { line, cells } of records.slice(1)) {
		const bad = (message: string, fix?: string) => problems.push({ code: 'E813', severity: 'error', line, message, ...(fix ? { fix } : {}) });
		if (cells.length > header.length) {
			bad(`${cells.length} cells for ${header.length} columns.`, 'Put a text holding a comma (a shop, a note) between double quotes.');
			continue;
		}
		const date = at(cells, 'date');
		const ingredient = at(cells, 'ingredient');
		const amount = num(at(cells, 'amount'));
		const packQty = num(at(cells, 'pack_qty'));
		const unit = at(cells, 'pack_unit');
		const cur = (at(cells, 'currency') || currency).toUpperCase();
		if (!validDate(date)) bad(`\`date\` "${date}" is not a date written YYYY-MM-DD.`);
		else if (!SLUG_RE.test(ingredient)) bad(`\`ingredient\` "${ingredient}" is not an ingredient slug.`, 'Write the slug of the ingredient file, like `tomates-concassees`.');
		else if (amount === undefined || amount <= 0) bad(`\`amount\` "${at(cells, 'amount')}" is not a positive number.`, 'Write the price paid, like `0.89`.');
		else if (packQty === undefined || packQty <= 0) bad(`\`pack_qty\` "${at(cells, 'pack_qty')}" is not a positive number.`, 'Write the size of the pack, like `400`.');
		else if (!(UNITS as readonly string[]).includes(unit)) bad(`\`pack_unit\` "${unit}" is not a canonical unit.`, `One of: ${UNITS.join(', ')}.`);
		else if (!/^[A-Z]{3}$/.test(cur)) bad(`\`currency\` "${cur}" is not a three-letter currency code.`, `Like \`${currency}\`.`);
		else {
			rows.push({ line, date, ingredient, amount, currency: cur, packQty, packUnit: unit as Unit, shop: at(cells, 'shop'), note: at(cells, 'note') });
			if (opts.slugs && !opts.slugs.has(ingredient)) problems.push(unknownSlug(line, ingredient));
			if (cur !== currency) problems.push(foreignCurrency(line, cur, currency));
		}
	}
	return { rows, problems };
}

export function unknownSlug(line: number, slug: string): PriceProblem {
	return {
		code: 'W814',
		severity: 'warning',
		line,
		message: `\`${slug}\` is not in the ingredient registry; the row is kept but not used.`,
		fix: `Create ingredients/${slug}.md, or correct the slug in a new row.`
	};
}

export function foreignCurrency(line: number, cur: string, currency: string): PriceProblem {
	return {
		code: 'W815',
		severity: 'warning',
		line,
		message: `the row is in ${cur}, not ${currency}: shown, but not used for cost.`
	};
}

/** Latest row first: by date, a same-day tie going to the later line. */
export const newestFirst = (a: Pick<PriceRow, 'date' | 'line'>, b: Pick<PriceRow, 'date' | 'line'>) =>
	a.date < b.date ? 1 : a.date > b.date ? -1 : b.line - a.line;

/** The current price per ingredient: its latest row in the given currency. */
export function currentPrices(rows: readonly PriceRow[], currency: string): Map<string, PriceRow> {
	const out = new Map<string, PriceRow>();
	for (const r of rows) {
		if (r.currency !== currency.toUpperCase()) continue;
		const cur = out.get(r.ingredient);
		if (!cur || newestFirst(r, cur) < 0) out.set(r.ingredient, r);
	}
	return out;
}

/** Today as YYYY-MM-DD, in local time. */
export function today(now = new Date()): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** A price is stale once it is more than a year old (docs/INGREDIENTS.md, "Price history"). */
export function isStale(date: string, on = today()): boolean {
	const yearAgo = `${Number(on.slice(0, 4)) - 1}${on.slice(4)}`;
	return date < yearAgo;
}

function cell(s: string): string {
	return /[",\n\r]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A number as the file writes it: a dot, no trailing zeros beyond what was typed (`0.89`, `400`). */
export function csvNumber(n: number): string {
	return String(Math.round(n * 1e6) / 1e6);
}

/** The cell a new row writes under a column (empty for a column the app does not know). */
function rowCell(r: Omit<PriceRow, 'line'>, column: string): string {
	switch (column) {
		case 'date':
			return r.date;
		case 'ingredient':
			return r.ingredient;
		case 'amount':
			return csvNumber(r.amount);
		case 'currency':
			return r.currency;
		case 'pack_qty':
			return csvNumber(r.packQty);
		case 'pack_unit':
			return r.packUnit;
		case 'shop':
			return r.shop;
		case 'note':
			return r.note;
		default:
			return '';
	}
}

/** One CSV line (no newline) for a new row, in the given column order (default: PRICE_COLUMNS). */
export function priceLine(r: Omit<PriceRow, 'line'>, columns: readonly string[] = PRICE_COLUMNS): string {
	return columns.map((c) => cell(rowCell(r, c))).join(',');
}

/**
 * Why a row cannot be appended to a prices.csv as it is: its header lacks a
 * required column (`header`, E812), lacks a column that would drop a value
 * the person typed (`column`: `shop` or `note`), or the line would not read
 * back as the row entered (`readback`). Nothing is written.
 */
export class PriceFileError extends Error {
	constructor(
		readonly reason: 'header' | 'column' | 'readback',
		readonly columns: string[] = []
	) {
		super(
			reason === 'header'
				? `prices.csv has no header with ${columns.join(', ')}`
				: reason === 'column'
					? `prices.csv has no ${columns.join(', ')} column`
					: 'the new row would not read back as entered'
		);
	}
}

/**
 * The file with one row appended (docs/STORAGE.md, "Prices are an append-only
 * log"): the default header first when the file is new or empty; otherwise the
 * cells follow the file's own header, since columns are found by name — a
 * column the app does not know gets an empty cell, a missing `currency` is the
 * config's. Refused (PriceFileError) rather than written wrong: a header
 * lacking a required column, a typed shop or note with no column to hold it,
 * or a line that does not read back as the row entered. A newline goes before
 * the row when the last line lacks one.
 */
export function appendPriceLine(text: string, r: Omit<PriceRow, 'line'>): string {
	if (!text.trim()) return `${PRICE_HEADER}\n${priceLine(r)}\n`;
	const header = csvRecords(text)[0].cells.map((c) => c.trim().toLowerCase());
	const missing = REQUIRED.filter((c) => !header.includes(c));
	if (missing.length) throw new PriceFileError('header', missing);
	const lost = (['shop', 'note'] as const).filter((c) => r[c] && !header.includes(c));
	if (lost.length) throw new PriceFileError('column', lost);
	const out = `${text}${text.endsWith('\n') ? '' : '\n'}${priceLine(r, header)}\n`;
	const back = parsePrices(out, { currency: r.currency }).rows.at(-1);
	const same =
		back &&
		back.date === r.date &&
		back.ingredient === r.ingredient &&
		back.amount === Number(csvNumber(r.amount)) &&
		back.currency === r.currency.toUpperCase() &&
		back.packQty === Number(csvNumber(r.packQty)) &&
		back.packUnit === r.packUnit &&
		back.shop === r.shop.trim() &&
		back.note === r.note.trim() &&
		back.line === csvRecords(out).at(-1)!.line;
	if (!same) throw new PriceFileError('readback');
	return out;
}
