// Read queries over the index: browse with facets and full-text search,
// recipe pages, families and the family diff table.

import type { Recipe } from '../../vault/types';
import { searchText } from './build';
import type { DB } from './db';

export const SORTS = ['title', 'added', 'updated', 'time', 'rating', 'relevance'] as const;
export type Sort = (typeof SORTS)[number];

export const TIME_BUCKETS = ['30', '60', '120', 'plus'] as const;
export const SERVING_BUCKETS = ['1-2', '3-4', '5-6', '7+'] as const;

export interface BrowseParams {
	q?: string;
	family?: string;
	tags?: string[];
	season?: string;
	source?: string;
	author?: string;
	status?: string;
	/** Total time up to 30 / 60 / 120 minutes, or more than 2 h. */
	time?: string;
	servings?: string;
	sort?: Sort;
	page?: number;
	pageSize?: number;
}

export interface Card {
	slug: string;
	title: string;
	family: string | null;
	/** The family's label from vocab/families.yaml, if set. */
	family_label: string | null;
	variant: string | null;
	total_s: number | null;
	servings: number | null;
	servings_max: number | null;
	status: string | null;
	photo: string | null;
	uncertain: number;
	broken: boolean;
}

export interface FacetValue {
	value: string;
	count: number;
	/** Tags only: not in the vocabulary. */
	pending?: boolean;
}

export type FacetName = 'family' | 'tags' | 'season' | 'source' | 'author' | 'status' | 'time' | 'servings';

export interface BrowseResult {
	total: number;
	page: number;
	pages: number;
	pageSize: number;
	items: Card[];
	facets: Record<FacetName, FacetValue[]>;
}

/**
 * User text → an FTS5 query: folded like the indexed text, each word a
 * quoted prefix term (`lasag` finds `lasagnes`), all words required.
 */
export function ftsQuery(q: string | undefined): string | undefined {
	if (!q) return undefined;
	const words = searchText(q)
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean)
		.slice(0, 12);
	return words.length ? words.map((w) => `"${w}"*`).join(' ') : undefined;
}

interface Where {
	sql: string;
	args: unknown[];
}

const TIME_SQL: Record<string, string> = {
	'30': 'r.total_s <= 1800',
	'60': 'r.total_s <= 3600',
	'120': 'r.total_s <= 7200',
	plus: 'r.total_s > 7200'
};

const SERVINGS_SQL: Record<string, string> = {
	'1-2': 'r.servings BETWEEN 1 AND 2',
	'3-4': 'r.servings BETWEEN 3 AND 4',
	'5-6': 'r.servings BETWEEN 5 AND 6',
	'7+': 'r.servings >= 7'
};

/** The WHERE clause for the filters, leaving one facet out (for that facet's own counts). */
function where(p: BrowseParams, fts: string | undefined, omit?: FacetName): Where {
	const sql: string[] = [];
	const args: unknown[] = [];
	if (fts) {
		sql.push('r.id IN (SELECT rowid FROM recipes_fts WHERE recipes_fts MATCH ?)');
		args.push(fts);
	}
	const eq = (facet: FacetName, col: string, v: string | undefined) => {
		if (v === undefined || v === '' || omit === facet) return;
		sql.push(`r.${col} = ?`);
		args.push(v);
	};
	eq('family', 'family', p.family);
	eq('source', 'source_type', p.source);
	eq('author', 'author', p.author);
	eq('status', 'status', p.status);
	if (omit !== 'tags')
		for (const t of p.tags ?? []) {
			sql.push('r.slug IN (SELECT slug FROM tags WHERE tag = ?)');
			args.push(t);
		}
	if (p.season && omit !== 'season') {
		sql.push('r.slug IN (SELECT slug FROM seasons WHERE season = ?)');
		args.push(p.season);
	}
	if (p.time && TIME_SQL[p.time] && omit !== 'time') sql.push(TIME_SQL[p.time]);
	if (p.servings && SERVINGS_SQL[p.servings] && omit !== 'servings') sql.push(SERVINGS_SQL[p.servings]);
	return { sql: sql.length ? `WHERE ${sql.join(' AND ')}` : '', args };
}

const ORDER: Record<Exclude<Sort, 'relevance'>, string> = {
	title: 'r.title_sort ASC',
	added: 'r.added DESC, r.title_sort ASC',
	updated: 'r.updated DESC, r.title_sort ASC',
	time: 'r.total_s IS NULL, r.total_s ASC, r.title_sort ASC',
	rating: 'r.rating IS NULL, r.rating DESC, r.title_sort ASC'
};

const CARD_COLS = `r.slug, r.title, r.family, r.variant, r.total_s, r.servings, r.servings_max, r.status, r.photo, r.uncertain, r.broken_json IS NOT NULL AS broken,
  (SELECT f.label_fr FROM families f WHERE f.slug = r.family) AS family_label`;

function facetCounts(db: DB, p: BrowseParams, fts: string | undefined): Record<FacetName, FacetValue[]> {
	const run = (facet: FacetName, select: string, from: string, group: string) => {
		const w = where(p, fts, facet);
		const extra = w.sql ? `${w.sql} AND ${group} IS NOT NULL` : `WHERE ${group} IS NOT NULL`;
		return db.prepare(`SELECT ${select} FROM ${from} ${extra} GROUP BY ${group} ORDER BY count DESC, value ASC`).all(...w.args) as FacetValue[];
	};
	const bucket = (facet: FacetName, sqls: Record<string, string>) => {
		const w = where(p, fts, facet);
		const cases = Object.entries(sqls)
			.map(([k, s]) => `SUM(CASE WHEN ${s} THEN 1 ELSE 0 END) AS "${k}"`)
			.join(', ');
		const row = db.prepare(`SELECT ${cases} FROM recipes r ${w.sql}`).get(...w.args) as Record<string, number | null>;
		return Object.keys(sqls)
			.map((value) => ({ value, count: row[value] ?? 0 }))
			.filter((v) => v.count > 0);
	};
	const tags = run('tags', 't.tag AS value, count(*) AS count, MIN(t.pending) AS pending', 'tags t JOIN recipes r ON r.slug = t.slug', 't.tag').map(
		(t) => ({ ...t, pending: Boolean(t.pending) })
	);
	return {
		family: run('family', 'r.family AS value, count(*) AS count', 'recipes r', 'r.family'),
		tags,
		season: run('season', 's.season AS value, count(*) AS count', 'seasons s JOIN recipes r ON r.slug = s.slug', 's.season'),
		source: run('source', 'r.source_type AS value, count(*) AS count', 'recipes r', 'r.source_type'),
		author: run('author', 'r.author AS value, count(*) AS count', 'recipes r', 'r.author'),
		status: run('status', 'r.status AS value, count(*) AS count', 'recipes r', 'r.status'),
		time: bucket('time', TIME_SQL),
		servings: bucket('servings', SERVINGS_SQL)
	};
}

export function browse(db: DB, p: BrowseParams, { withFacets = true } = {}): BrowseResult {
	const fts = ftsQuery(p.q);
	const pageSize = Math.min(Math.max(p.pageSize ?? 24, 1), 100);
	const w = where(p, fts);
	const total = (db.prepare(`SELECT count(*) AS n FROM recipes r ${w.sql}`).get(...w.args) as { n: number }).n;
	const pages = Math.max(1, Math.ceil(total / pageSize));
	const page = Math.min(Math.max(p.page ?? 1, 1), pages);
	const sort: Sort = p.sort ?? (fts ? 'relevance' : 'title');
	let items: Card[];
	if (sort === 'relevance' && fts) {
		// bm25 weights: title, body, ingredients, author, tags.
		const rest = w.sql.replace(/^WHERE /, 'AND ');
		items = db
			.prepare(
				`SELECT ${CARD_COLS} FROM recipes r
				 JOIN (SELECT rowid, bm25(recipes_fts, 10.0, 1.0, 4.0, 2.0, 2.0) AS rank FROM recipes_fts WHERE recipes_fts MATCH ?) f ON f.rowid = r.id
				 WHERE 1 ${rest} ORDER BY f.rank, r.title_sort LIMIT ? OFFSET ?`
			)
			.all(fts, ...w.args, pageSize, (page - 1) * pageSize) as Card[];
	} else {
		const order = ORDER[sort === 'relevance' ? 'title' : sort];
		items = db
			.prepare(`SELECT ${CARD_COLS} FROM recipes r ${w.sql} ORDER BY ${order} LIMIT ? OFFSET ?`)
			.all(...w.args, pageSize, (page - 1) * pageSize) as Card[];
	}
	items = items.map((c) => ({ ...c, broken: Boolean(c.broken) }));
	const facets = withFacets
		? facetCounts(db, p, fts)
		: { family: [], tags: [], season: [], source: [], author: [], status: [], time: [], servings: [] };
	return { total, page, pages, pageSize, items, facets };
}

export interface RecipeRow {
	slug: string;
	title: string;
	family: string | null;
	variant: string | null;
	status: string | null;
	file_path: string;
	file_hash: string;
	body_md: string;
	photo: string | null;
	uncertain: number;
}

/** A checker error as the index keeps it for a file that fails (`problems`, `broken_json`). */
export interface ProblemDiagnostic {
	code: string;
	path: string | null;
	message: string;
	fix?: string;
}

export interface RecipeDetail {
	row: RecipeRow;
	recipe: Recipe;
	/** Diagnostics while the file on disk fails the checker (watcher / sync). */
	broken: ProblemDiagnostic[] | null;
}

export function getRecipe(db: DB, slug: string): RecipeDetail | undefined {
	const row = db.prepare('SELECT * FROM recipes WHERE slug = ?').get(slug) as (RecipeRow & { data_json: string; broken_json: string | null }) | undefined;
	if (!row) return undefined;
	const { data_json, broken_json, ...rest } = row;
	return { row: rest, recipe: JSON.parse(data_json), broken: broken_json ? JSON.parse(broken_json) : null };
}

/** Titles for a set of slugs; missing slugs are absent from the map. */
export function titles(db: DB, slugs: Iterable<string>): Map<string, string> {
	const list = [...new Set(slugs)];
	const out = new Map<string, string>();
	const stmt = db.prepare('SELECT title FROM recipes WHERE slug = ?').pluck();
	for (const s of list) {
		const t = stmt.get(s) as string | undefined;
		if (t !== undefined) out.set(s, t);
	}
	return out;
}

/** Recipes that use this one as a sub-recipe. */
export function usedBy(db: DB, slug: string): { slug: string; title: string }[] {
	return db
		.prepare(`SELECT DISTINCT r.slug, r.title FROM ingredients i JOIN recipes r ON r.slug = i.slug WHERE i.recipe = ? ORDER BY r.title_sort`)
		.all(slug) as { slug: string; title: string }[];
}

export interface FamilySummary {
	slug: string;
	label: string | null;
	count: number;
}

export function families(db: DB): FamilySummary[] {
	return db
		.prepare(
			`SELECT f.slug, f.label_fr AS label, count(r.slug) AS count FROM families f
			 LEFT JOIN recipes r ON r.family = f.slug GROUP BY f.slug HAVING count > 0 ORDER BY f.slug`
		)
		.all() as FamilySummary[];
}

/** Family slug → French label, for the families that have one in `vocab/families.yaml`. */
export function familyLabels(db: DB): Record<string, string> {
	const rows = db.prepare('SELECT slug, label_fr FROM families WHERE label_fr IS NOT NULL').all() as { slug: string; label_fr: string }[];
	return Object.fromEntries(rows.map((r) => [r.slug, r.label_fr]));
}

export interface Variant {
	slug: string;
	title: string;
	variant: string | null;
	total_s: number | null;
	servings: number | null;
	servings_max: number | null;
	difficulty: number | null;
	rating: number | null;
	status: string | null;
	photo: string | null;
}

export interface FamilyDiff {
	family: string;
	label: string | null;
	variants: Variant[];
	/** Items in every variant, shown once. */
	common: string[];
	/** Items in some variants only: per item, which variants have it. */
	rows: { item: string; label: string; in: string[] }[];
	/** Per variant slug, the items only it has — the differentiator. */
	unique: Record<string, string[]>;
	/** Which of total_s, servings, difficulty, rating differ between variants. */
	differs: { total_s: boolean; servings: boolean; difficulty: boolean; rating: boolean };
}

export function familyDiff(db: DB, family: string): FamilyDiff | undefined {
	const variants = db
		.prepare(
			`SELECT slug, title, variant, total_s, servings, servings_max, difficulty, rating, status, photo FROM recipes WHERE family = ? ORDER BY variant, title_sort`
		)
		.all(family) as Variant[];
	if (!variants.length) return undefined;
	const label = (db.prepare('SELECT label_fr FROM families WHERE slug = ?').pluck().get(family) as string | null) ?? null;
	const rows = db
		.prepare(`SELECT i.slug, i.item, i.name FROM ingredients i JOIN recipes r ON r.slug = i.slug WHERE r.family = ? ORDER BY i.position`)
		.all(family) as { slug: string; item: string; name: string }[];
	const byItem = new Map<string, { label: string; in: Set<string> }>();
	for (const r of rows) {
		const e = byItem.get(r.item) ?? { label: r.name, in: new Set<string>() };
		e.in.add(r.slug);
		byItem.set(r.item, e);
	}
	const n = variants.length;
	const common: string[] = [];
	const partial: FamilyDiff['rows'] = [];
	const unique: Record<string, string[]> = Object.fromEntries(variants.map((v) => [v.slug, []]));
	for (const [item, e] of byItem) {
		if (e.in.size === n && n > 1) common.push(e.label);
		else {
			partial.push({ item, label: e.label, in: variants.filter((v) => e.in.has(v.slug)).map((v) => v.slug) });
			if (e.in.size === 1) unique[[...e.in][0]].push(e.label);
		}
	}
	const differ = (k: keyof FamilyDiff['differs']) => new Set(variants.map((v) => v[k])).size > 1;
	partial.sort((a, b) => b.in.length - a.in.length || a.label.localeCompare(b.label, 'fr'));
	return {
		family,
		label,
		variants,
		common: common.sort((a, b) => a.localeCompare(b, 'fr')),
		rows: partial,
		unique,
		differs: { total_s: differ('total_s'), servings: differ('servings'), difficulty: differ('difficulty'), rating: differ('rating') }
	};
}

/** Files that fail the checker and have no good rows — listed on the home page. */
export function orphanProblems(db: DB): { file_path: string; codes: string[]; diagnostics: ProblemDiagnostic[] }[] {
	return (
		db.prepare(`SELECT p.file_path, p.diagnostics FROM problems p WHERE NOT EXISTS (SELECT 1 FROM recipes r WHERE r.file_path = p.file_path)`).all() as {
			file_path: string;
			diagnostics: string;
		}[]
	).map((p) => {
		const diagnostics = JSON.parse(p.diagnostics) as ProblemDiagnostic[];
		return { file_path: p.file_path, codes: [...new Set(diagnostics.map((d) => d.code))], diagnostics };
	});
}
