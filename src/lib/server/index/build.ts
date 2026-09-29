// One recipe → its index rows. Every write here is idempotent: upsert
// replaces whatever rows the slug had.

import { createHash } from 'node:crypto';
import { stripMarkers } from '../../vault/markers';
import { fold } from '../../vault/normalize';
import type { Diagnostic, Duration, Recipe } from '../../vault/types';
import { seasonFor } from '../../vault/vocab';
import { canonicalTag, type VaultVocab } from '../vocab';
import { getResolver } from './resolve';
import type { DB } from './db';

export const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

export { bodyText as bodyOf } from '../../vault/parse';

/** Folded text for search: no accents, œ → oe, markers stripped. */
export const searchText = (s: string) => fold(stripMarkers(s));

const secs = (d?: Duration) => (d ? (d.maxSeconds ?? d.seconds) : null);

export function totalSeconds(r: Recipe): number | null {
	const t = r.times;
	if (!t) return null;
	if (t.total) return secs(t.total);
	const parts = [t.prep, t.cook, t.rest].filter((d): d is Duration => !!d);
	return parts.length ? parts.reduce((n, d) => n + secs(d)!, 0) : null;
}

/** A season as the index stores it: canonical when known, else folded. */
export const canonicalSeason = (s: string) => seasonFor(s) ?? fold(s);

export interface IndexInput {
	recipe: Recipe;
	/** The raw body Markdown. */
	body: string;
	filePath: string;
	hash: string;
}

export function deleteRecipeRows(db: DB, slug: string): void {
	const row = db.prepare('SELECT id FROM recipes WHERE slug = ?').get(slug) as { id: number } | undefined;
	if (row) db.prepare('DELETE FROM recipes_fts WHERE rowid = ?').run(row.id);
	db.prepare('DELETE FROM recipes WHERE slug = ?').run(slug);
	for (const t of ['tags', 'seasons', 'ingredients', 'ingredient_or', 'media']) db.prepare(`DELETE FROM ${t} WHERE slug = ?`).run(slug);
}

/** Replace every row of one recipe. Call inside a transaction when batching. */
export function upsertRecipe(db: DB, vocab: VaultVocab, { recipe: r, body, filePath, hash }: IndexInput): void {
	const existing = db.prepare('SELECT id FROM recipes WHERE slug = ?').get(r.slug) as { id: number } | undefined;
	deleteRecipeRows(db, r.slug);
	const s = r.source;
	const values = {
		slug: r.slug,
		title: r.title,
		title_sort: searchText(r.title),
		lang: r.lang,
		family: r.family ?? null,
		variant: r.variant ?? null,
		source_type: s?.type ?? null,
		author: s?.author ? stripMarkers(s.author) : null,
		source_url: s?.url ?? null,
		source_title: s?.title ?? null,
		source_page: s?.page !== undefined ? String(s.page) : null,
		prep_s: secs(r.times?.prep),
		cook_s: secs(r.times?.cook),
		rest_s: secs(r.times?.rest),
		total_s: totalSeconds(r),
		servings: r.servings ?? null,
		servings_max: r.servingsMax ?? null,
		difficulty: r.difficulty ?? null,
		rating: r.rating ?? null,
		status: r.status ?? null,
		added: r.added ?? null,
		updated: r.updated ?? null,
		extracted_by: r.extractedBy ?? null,
		photo: r.media?.final ?? null,
		uncertain: r.markers.filter((m) => m.kind !== 'added').length,
		file_path: filePath,
		file_hash: hash,
		body_md: body,
		data_json: JSON.stringify(r)
	};
	const cols = Object.keys(values);
	const info = db
		.prepare(
			`INSERT INTO recipes (${existing ? 'id, ' : ''}${cols.join(', ')}) VALUES (${existing ? '@id, ' : ''}${cols.map((c) => '@' + c).join(', ')})`
		)
		.run(existing ? { id: existing.id, ...values } : values);
	const id = existing?.id ?? Number(info.lastInsertRowid);

	const tagRows = insertTags(db, vocab, r);

	const insSeason = db.prepare('INSERT OR IGNORE INTO seasons (slug, season) VALUES (?, ?)');
	for (const season of r.season) insSeason.run(r.slug, canonicalSeason(season));

	const insIng = db.prepare(
		`INSERT INTO ingredients (slug, position, group_idx, group_name, group_optional, qty, qty_max, qty_s, unit, name, optional, to_taste, recipe, buy_instead, key, item, resolution)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	const insOr = db.prepare(
		`INSERT OR REPLACE INTO ingredient_or (slug, position, alt_idx, name, recipe, key, item, resolution) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
	);
	const resolver = getResolver(db, vocab);
	let position = 0;
	const names: string[] = [];
	r.ingredients.forEach((g, gi) => {
		for (const it of g.items) {
			names.push(it.name, ...(it.or ?? []).map((o) => o.name));
			const res = resolver.resolve(it, r.lang);
			insIng.run(
				r.slug,
				position,
				gi,
				g.group ?? null,
				g.optional ? 1 : 0,
				it.qty?.value ?? null,
				it.qtyMax?.value ?? null,
				it.qty ? String(it.qty.raw) : null,
				it.unit ?? null,
				it.name,
				it.optional ? 1 : 0,
				it.toTaste ? 1 : 0,
				it.recipe ?? null,
				it.buyInstead ? 1 : 0,
				res.key,
				res.item,
				res.resolution
			);
			(it.or ?? []).forEach((o, j) => {
				const ro = resolver.resolve(o, r.lang);
				insOr.run(r.slug, position, j, o.name, o.recipe ?? null, ro.key, ro.item, ro.resolution);
			});
			position++;
		}
	});

	const insMedia = db.prepare('INSERT OR IGNORE INTO media (slug, kind, path) VALUES (?, ?, ?)');
	for (const [kind, path] of Object.entries(r.media ?? {})) insMedia.run(r.slug, kind, path);

	db.prepare('INSERT INTO recipes_fts (rowid, title, body, ingredients, author, tags) VALUES (?, ?, ?, ?, ?, ?)').run(
		id,
		searchText(r.title),
		searchText(body),
		searchText(names.join(' · ')),
		searchText(s?.author ?? ''),
		ftsTags(r, tagRows)
	);
	db.prepare('DELETE FROM problems WHERE file_path = ?').run(filePath);
}

/** Tag rows for a recipe: canonical per the vault vocabulary, else pending. */
function insertTags(db: DB, vocab: VaultVocab, r: Recipe): Map<string, boolean> {
	const tagRows = new Map<string, boolean>();
	for (const t of r.tags) {
		const c = canonicalTag(vocab, stripMarkers(t));
		if (c.tag) tagRows.set(c.tag, (tagRows.get(c.tag) ?? true) && c.pending);
	}
	const insTag = db.prepare('INSERT OR REPLACE INTO tags (slug, tag, pending) VALUES (?, ?, ?)');
	for (const [tag, pending] of tagRows) insTag.run(r.slug, tag, pending ? 1 : 0);
	return tagRows;
}

/**
 * Recompute every recipe's tag rows, and the FTS `tags` column, after the
 * vocabulary changed. No file is read. `hash` (of vocab/tags.yaml) is stored
 * so startup sync can tell whether the vocabulary changed while the app was down.
 */
export function retag(db: DB, vocab: VaultVocab, hash?: string): void {
	// One transaction: row-by-row autocommit made this ~7× slower on a 5000-recipe vault.
	db.transaction(() => {
		db.prepare('DELETE FROM tags').run();
		const fts = db.prepare('UPDATE recipes_fts SET tags = ? WHERE rowid = ?');
		for (const { id, data_json } of db.prepare('SELECT id, data_json FROM recipes').all() as { id: number; data_json: string }[]) {
			const r = JSON.parse(data_json) as Recipe;
			const tagRows = insertTags(db, vocab, r);
			fts.run(ftsTags(r, tagRows), id);
		}
		if (hash !== undefined) setMeta(db, 'tags_hash', hash);
	})();
}

const ftsTags = (r: Recipe, tagRows: Map<string, boolean>) => searchText([...r.tags, ...tagRows.keys()].join(' '));

export function getMeta(db: DB, key: string): string | undefined {
	return db.prepare('SELECT value FROM meta WHERE key = ?').pluck().get(key) as string | undefined;
}

export function setMeta(db: DB, key: string, value: string): void {
	db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

/** Record a file that fails the checker; its last good rows (if any) are kept and flagged. */
export function recordProblem(db: DB, filePath: string, hash: string, slug: string | null, diagnostics: Diagnostic[]): void {
	const slim = diagnostics
		.filter((d) => d.severity === 'error')
		.map((d) => ({ code: d.code, path: d.path, message: d.message, ...(d.fix ? { fix: d.fix } : {}) }));
	const json = JSON.stringify(slim);
	db.prepare(
		`INSERT INTO problems (file_path, slug, file_hash, diagnostics) VALUES (?, ?, ?, ?)
		 ON CONFLICT(file_path) DO UPDATE SET slug = excluded.slug, file_hash = excluded.file_hash, diagnostics = excluded.diagnostics`
	).run(filePath, slug, hash, json);
	db.prepare('UPDATE recipes SET broken_json = ? WHERE file_path = ?').run(json, filePath);
}

/** Refresh the families table: every family in use, with labels from vocab/families.yaml. */
export function refreshFamilies(db: DB, vocab: VaultVocab): void {
	const used = db.prepare('SELECT DISTINCT family FROM recipes WHERE family IS NOT NULL').pluck().all() as string[];
	db.prepare('DELETE FROM families').run();
	const ins = db.prepare('INSERT INTO families (slug, label_fr, label_en) VALUES (?, ?, ?)');
	for (const slug of new Set([...used, ...vocab.families.keys()])) {
		const l = vocab.families.get(slug);
		ins.run(slug, l?.fr ?? null, l?.en ?? null);
	}
}
