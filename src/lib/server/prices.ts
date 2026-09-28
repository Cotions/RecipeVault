// prices.csv on disk → the index, and a new price row → the file and a
// commit (plan 03, Phase 4; docs/STORAGE.md, "Prices are an append-only log").
// Through the app the file is only ever appended to; a hand edit in a
// spreadsheet is picked up by the watcher or the next sync.

import { existsSync, readFileSync } from 'node:fs';
import {
	appendPriceLine,
	csvNumber,
	foreignCurrency,
	parsePrices,
	PriceFileError,
	PRICES_FILE,
	today,
	unknownSlug,
	validDate,
	type PriceProblem,
	type PriceRow
} from '../ingredients/prices';
import { SLUG_RE } from '../vault/slug';
import { UNITS, type Unit } from '../vault/types';
import type { VaultContext } from './context';
import { FileWriteError, readVaultFile, writeAndCommit } from './files';
import { getMeta, setMeta, sha256 } from './index/build';
import type { DB } from './index/db';
import type { VaultPaths } from './vault';

export interface PricesReport {
	/** Rows that read. */
	rows: number;
	/** False when prices.csv and the currency are those of the last load. */
	changed: boolean;
	/** Lines skipped (E812, E813). */
	skipped: number;
}

/**
 * Bring the `prices` table in line with prices.csv. Skipped when the file and
 * the currency are those of the last load (`meta.prices_hash`), unless forced.
 * A few thousand rows: the table is simply rebuilt.
 */
export function syncPrices(db: DB, paths: VaultPaths, currency: string, { force = false } = {}): PricesReport {
	const text = existsSync(paths.prices) ? readFileSync(paths.prices, 'utf8') : '';
	const hash = sha256(`${currency}\n${text}`);
	if (!force && getMeta(db, 'prices_hash') === hash) {
		return {
			rows: db.prepare('SELECT count(*) FROM prices').pluck().get() as number,
			changed: false,
			skipped: db.prepare('SELECT count(*) FROM price_problems').pluck().get() as number
		};
	}
	const { rows, problems } = parsePrices(text, { currency });
	db.prepare('DELETE FROM prices').run();
	db.prepare('DELETE FROM price_problems').run();
	const ins = db.prepare(
		'INSERT OR REPLACE INTO prices (line, date, ingredient, amount, currency, pack_qty, pack_unit, shop, note, usable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
	);
	for (const r of rows) ins.run(r.line, r.date, r.ingredient, r.amount, r.currency, r.packQty, r.packUnit, r.shop, r.note, r.currency === currency ? 1 : 0);
	const insP = db.prepare('INSERT INTO price_problems (line, code, message, fix) VALUES (?, ?, ?, ?)');
	for (const p of problems) if (p.severity === 'error') insP.run(p.line, p.code, p.message, p.fix ?? null);
	setMeta(db, 'prices_hash', hash);
	return { rows: rows.length, changed: true, skipped: problems.filter((p) => p.severity === 'error').length };
}

interface PriceDbRow {
	line: number;
	date: string;
	ingredient: string;
	amount: number;
	currency: string;
	pack_qty: number;
	pack_unit: string;
	shop: string;
	note: string;
}

export const toPriceRow = (r: PriceDbRow): PriceRow => ({
	line: r.line,
	date: r.date,
	ingredient: r.ingredient,
	amount: r.amount,
	currency: r.currency,
	packQty: r.pack_qty,
	packUnit: r.pack_unit as Unit,
	shop: r.shop,
	note: r.note
});

/** The current price of each of these ingredients (the latest usable row). */
export function currentPricesOf(db: DB, slugs: readonly string[]): Map<string, PriceRow> {
	const out = new Map<string, PriceRow>();
	if (!slugs.length) return out;
	const q = db.prepare('SELECT * FROM current_price WHERE ingredient = ?');
	for (const s of new Set(slugs)) {
		const r = q.get(s) as PriceDbRow | undefined;
		if (r) out.set(s, toPriceRow(r));
	}
	return out;
}

/**
 * Every problem of prices.csv, by line: lines that do not read (stored at
 * load), rows naming no registry entry, rows in another currency. The last two
 * are derived at query time, so creating the entry clears its W814.
 */
export function priceProblems(db: DB, currency: string): PriceProblem[] {
	const stored = (db.prepare('SELECT line, code, message, fix FROM price_problems').all() as { line: number; code: string; message: string; fix: string | null }[]).map(
		(p): PriceProblem => ({ code: p.code as PriceProblem['code'], severity: 'error', line: p.line, message: p.message, ...(p.fix ? { fix: p.fix } : {}) })
	);
	const unknown = (db.prepare('SELECT line, ingredient FROM prices WHERE ingredient NOT IN (SELECT slug FROM registry)').all() as { line: number; ingredient: string }[]).map((r) =>
		unknownSlug(r.line, r.ingredient)
	);
	const foreign = (db.prepare('SELECT line, currency FROM prices WHERE usable = 0').all() as { line: number; currency: string }[]).map((r) =>
		foreignCurrency(r.line, r.currency, currency)
	);
	return [...stored, ...unknown, ...foreign].sort((a, b) => a.line - b.line || a.code.localeCompare(b.code));
}

/** Shop names for the autocomplete: those in prices.csv, most used first, then the config's. */
export function knownShops(db: DB, configured: readonly string[] = []): string[] {
	const used = db.prepare(`SELECT shop FROM prices WHERE shop <> '' GROUP BY shop ORDER BY count(*) DESC, max(date) DESC, shop`).pluck().all() as string[];
	return [...new Set([...used, ...configured])];
}

export class PriceError extends Error {}

export interface NewPrice {
	ingredient: string;
	amount: number;
	packQty: number;
	packUnit: string;
	shop?: string;
	note?: string;
	/** YYYY-MM-DD; today when absent. */
	date?: string;
}

/**
 * Append one row to prices.csv and commit it as `price: <slug> <amount> /
 * <pack>` (plan 03, Q9: one commit per row). A failed write or commit puts the
 * file back as it was. Returns the row as written.
 */
export function appendPrice(ctx: VaultContext, input: NewPrice): Promise<{ commit?: string; row: PriceRow }> {
	return ctx.lock.run(async () => {
		const slug = input.ingredient.trim();
		if (!SLUG_RE.test(slug) || !ctx.db.prepare('SELECT 1 FROM registry WHERE slug = ?').get(slug)) throw new PriceError(`l’ingrédient ${slug} n’existe pas.`);
		if (!Number.isFinite(input.amount) || input.amount <= 0) throw new PriceError('le montant doit être un nombre plus grand que zéro.');
		if (!Number.isFinite(input.packQty) || input.packQty <= 0) throw new PriceError('le format doit être un nombre plus grand que zéro.');
		if (!(UNITS as readonly string[]).includes(input.packUnit)) throw new PriceError('choisissez l’unité du format.');
		const date = input.date?.trim() || today();
		const clean = (s = '') => s.replace(/[\r\n]+/g, ' ').trim();
		if (!validDate(date)) throw new PriceError('la date doit s’écrire AAAA-MM-JJ.');
		const row: Omit<PriceRow, 'line'> = {
			date,
			ingredient: slug,
			amount: input.amount,
			currency: ctx.currency,
			packQty: input.packQty,
			packUnit: input.packUnit as Unit,
			shop: clean(input.shop),
			note: clean(input.note)
		};
		const file = readVaultFile(ctx, PRICES_FILE);
		let text: string;
		try {
			text = appendPriceLine(file.text, row);
		} catch (e) {
			if (!(e instanceof PriceFileError)) throw e;
			throw new PriceError(
				e.reason === 'header'
					? `la première ligne de prices.csv n’est pas un en-tête lisible (il manque ${e.columns.join(', ')}) ; corrigez-la d’abord. Rien n’a été écrit.`
					: e.reason === 'column'
						? `prices.csv n’a pas de colonne ${e.columns.join(' ni ')} : ajoutez-la à l’en-tête, ou laissez ce champ vide. Rien n’a été écrit.`
						: `la ligne ne se relirait pas telle que saisie avec l’en-tête de prices.csv ; vérifiez le fichier. Rien n’a été écrit.`
			);
		}
		let commit: string | undefined;
		try {
			commit = await writeAndCommit(ctx, [{ rel: PRICES_FILE, text }], `price: ${slug} ${csvNumber(row.amount)} / ${csvNumber(row.packQty)} ${row.packUnit}`);
		} catch (e) {
			if (!(e instanceof FileWriteError)) throw e;
			throw new PriceError(
				e.stage === 'write'
					? `prices.csv n’a pas pu être écrit ; rien n’a changé : ${e.message}`
					: `le prix n’a pas pu être enregistré (git) ; rien n’a changé : ${e.message}`
			);
		}
		try {
			ctx.db.transaction(() => syncPrices(ctx.db, ctx.paths, ctx.currency))();
		} catch (e) {
			ctx.log(`recipevault: index update failed after commit (vault sync will recover): ${(e as Error).message}`);
		}
		ctx.pusher.schedule();
		const line = text.replace(/\n$/, '').split('\n').length;
		return { commit, row: { ...row, line } };
	});
}
