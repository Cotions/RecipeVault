// Read queries over the index: browse with facets and full-text search,
// recipe pages, families and the family diff table.

import { guideWords, pageStarts, type Guide } from '../../render/browselist';
import { excerpt, queryTerms, termsIn } from '../../render/hits';
import { stripMarkers } from '../../vault/markers';
import { fold } from '../../vault/normalize';
import type { Recipe } from '../../vault/types';
import type { DB } from './db';
import { altsIn, search, type AlsoHit, type PartialHit, type Section, type SearchUnit } from './search';

export type { AlsoHit, PartialHit, Section } from './search';

export const SORTS = ['title', 'added', 'updated', 'time', 'rating', 'relevance'] as const;
export type Sort = (typeof SORTS)[number];

export const TIME_BUCKETS = ['30', '60', '120', 'plus'] as const;
export const SERVING_BUCKETS = ['1-2', '3-4', '5-6', '7+'] as const;

export interface BrowseParams {
	q?: string;
	/** The words as typed, never replaced by a close spelling (`?exact=1`, « Chercher exactement »). */
	exact?: boolean;
	family?: string;
	tags?: string[];
	season?: string;
	source?: string;
	author?: string;
	status?: string;
	/** Total time up to 30 / 60 / 120 minutes, or more than 2 h. */
	time?: string;
	servings?: string;
	/** 'non': recipes with at least one ingredient not linked to the registry (plan 03, Q3). */
	unresolved?: string;
	sort?: Sort;
	page?: number;
	pageSize?: number;
}

export interface BrowseOptions {
	/** Facet counts too (the home page); off for a plain list. */
	withFacets?: boolean;
	/** Canonical tags in the vocabulary's order (vocab/tags.yaml): the order a card lists its tags in. */
	tagOrder?: string[];
	/** Each card's tags; off for a list that does not show them (the home page's rows): `tags` is then empty. */
	withTags?: boolean;
}

export interface Card {
	slug: string;
	title: string;
	family: string | null;
	/** The family's label from vocab/families.yaml, if set. */
	family_label: string | null;
	/** The family's display name (familyNames): the label, else its shortest recipe title. */
	family_name: string | null;
	/** How many recipes the family has, this one included. */
	family_size: number | null;
	variant: string | null;
	/** Provenance, for the card's second line (render/provenance.ts). */
	author: string | null;
	source_type: string | null;
	source_title: string | null;
	source_url: string | null;
	source_page: string | null;
	total_s: number | null;
	servings: number | null;
	servings_max: number | null;
	/** 1–5, when the file gives one (the rows show it while sorted by note). */
	rating: number | null;
	status: string | null;
	photo: string | null;
	uncertain: number;
	broken: boolean;
	/** The title's first letter as sorted (folded, upper case): its place in the letter index. */
	initial: string;
	/** Its tags, in the vocabulary's order (BrowseOptions.tagOrder), then the others by name. */
	tags: string[];
	/** Its course: the first course tag it has (COURSE_TAGS), for the row's line « Dessert · Automne ». */
	course: string | null;
	/** Its seasons, spring first (the index sends them comma-separated; browse() splits them). */
	seasons: string[];
	/** With a search: the title holds one of its words at least (relevance lists these first). */
	in_title?: boolean;
	/** With a search, sorted by relevance: the section it is listed under (its title, else where most of the words are). */
	section?: Section;
	/** With a search: why the recipe matched, when the title alone does not say (explain()). */
	match?: Match;
}

/**
 * Where a search hit that is not in the title: the ingredient names, tags or
 * author that hold it, or a short excerpt of the body section that does
 * (`section`: its `##` heading as written, null before the first one). Plain
 * text; the page marks the hit words itself (render/hits.ts).
 */
export type Match = (
	| { field: 'ingredients' | 'tags' | 'author'; texts: string[] }
	| { field: 'body'; section: string | null; texts: [string] }
) & {
	/** The words to mark in `texts` when they are another name of a search word (« piment vert » for « poivron »). */
	terms?: string[];
};

/** The recipe-box index of a title-sorted list: per letter, how many recipes and the page its first one is on. */
export interface Letter {
	/** A to Z, or # for a title that starts with anything else. */
	letter: string;
	count: number;
	page: number;
}

export interface FacetValue {
	value: string;
	/** How many recipes the list would hold with it: the current list for a tag (tags add up), else the list with it in place of its facet's value. 0: none (the page greys it). */
	count: number;
	/** Tags only: not in the vocabulary. */
	pending?: boolean;
}

export type FacetName = 'family' | 'tags' | 'season' | 'source' | 'author' | 'status' | 'time' | 'servings' | 'unresolved';

export interface BrowseResult {
	total: number;
	page: number;
	pages: number;
	pageSize: number;
	/** How many results come before this page's first (title order breaks its pages where letters change). */
	offset: number;
	items: Card[];
	facets: Record<FacetName, FacetValue[]>;
	/** Sorted by title only: the letter index (every letter A–Z, count 0 when none). */
	letters: Letter[] | null;
	/** Sorted by title only: each page's guide words, where it starts and ends (« A–Ca », « Ce–G »). */
	guides: Guide[] | null;
	/** The search's folded words, for marking hits (render/hits.ts). */
	terms: string[];
	/** Sorted by relevance with a search: how many results hold a word in their title (they come first). */
	titleHits: number | null;
	/** Sorted by relevance with a search: how many results each section holds, in order (`title` first). */
	sections: { section: Section; count: number }[] | null;
	/** The query searched: the one typed, or its correction when the typed one found nothing (`suggestion.applied`). */
	q: string | null;
	/** A close spelling that finds more (« tourtire » → « tourtière »). */
	suggestion: { q: string; applied: boolean } | null;
	/** The words found nothing together: each alone, with its count (search.ts). */
	partial: PartialHit[] | null;
	/** A one-word search also looked under other names: those names, with their counts (search.ts). */
	also: AlsoHit[] | null;
	/** How many recipes of the whole box have a rating (the « Note » sort is offered only when some do). */
	rated: number;
}

/**
 * User text → an FTS5 query: folded like the indexed text, each word a
 * quoted prefix term (`lasag` finds `lasagnes`), all words required.
 */
export function ftsQuery(q: string | undefined): string | undefined {
	const words = queryTerms(q);
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

/** Recipes with an ingredient line or `or` option that resolved to no registry entry. */
const UNRESOLVED_SQL: Record<string, string> = {
	non: `r.slug IN (SELECT slug FROM ingredients WHERE resolution IN ('none', 'ambiguous')
	      UNION SELECT slug FROM ingredient_or WHERE resolution IN ('none', 'ambiguous'))`
};

/**
 * The WHERE clause for the search (`ids`: the ids it found, as JSON) and the
 * filters, leaving one facet out (for that facet's own counts), or all of
 * them (`omit: 'all'`, the values a facet can offer at all).
 */
function where(p: BrowseParams, ids: string | undefined, omit?: FacetName | 'all'): Where {
	const sql: string[] = [];
	const args: unknown[] = [];
	if (ids !== undefined) {
		sql.push('r.id IN (SELECT value FROM json_each(?))');
		args.push(ids);
	}
	if (omit === 'all') return { sql: sql.length ? `WHERE ${sql.join(' AND ')}` : '', args };
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
	if (p.unresolved && UNRESOLVED_SQL[p.unresolved] && omit !== 'unresolved') sql.push(UNRESOLVED_SQL[p.unresolved]);
	return { sql: sql.length ? `WHERE ${sql.join(' AND ')}` : '', args };
}

const ORDER: Record<Exclude<Sort, 'relevance'>, string> = {
	title: 'r.title_sort ASC',
	added: 'r.added DESC, r.title_sort ASC',
	updated: 'r.updated DESC, r.title_sort ASC',
	time: 'r.total_s IS NULL, r.total_s ASC, r.title_sort ASC',
	rating: 'r.rating IS NULL, r.rating DESC, r.title_sort ASC'
};

/**
 * The course tags of the seed vocabulary (docs/VOCAB.md, "Tags", the first
 * block), in its order: an idea's « main tag » is the first of these it has.
 */
export const COURSE_TAGS = ['plat-principal', 'entree', 'dessert', 'accompagnement', 'soupe', 'salade', 'petit-dejeuner', 'gouter', 'sauce', 'boisson', 'tarte'];

/** A recipe's course: the first of COURSE_TAGS it has (SQL, over `r`). */
const COURSE_SQL = `(SELECT t.tag FROM tags t JOIN json_each('${JSON.stringify(COURSE_TAGS)}') c ON c.value = t.tag WHERE t.slug = r.slug ORDER BY c.key LIMIT 1)`;

/** The seasons in the year's order, from spring (a row lists a recipe's in this order). */
const SEASON_ORDER = ['printemps', 'ete', 'automne', 'hiver'];

const CARD_COLS = `r.slug, r.title, r.family, r.variant, r.total_s, r.servings, r.servings_max, r.rating, r.status, r.photo, r.uncertain, r.broken_json IS NOT NULL AS broken,
  r.author, r.source_type, r.source_title, r.source_url, r.source_page, upper(substr(r.title_sort, 1, 1)) AS initial,
  (SELECT f.label_fr FROM families f WHERE f.slug = r.family) AS family_label,
  (SELECT count(*) FROM recipes m WHERE m.family = r.family) AS family_size,
  ${COURSE_SQL} AS course, (SELECT group_concat(s.season) FROM seasons s WHERE s.slug = r.slug) AS seasons`;

/** Whether any filter is on (else a facet's values and their counts are the same thing). */
const filtered = (p: BrowseParams) =>
	!!(p.family || p.source || p.author || p.status || p.season || p.time || p.servings || p.unresolved || p.tags?.length);

/**
 * Each facet's values with how many recipes the list would hold with each.
 * A tag adds to the tags already on (they are all required), so it counts
 * in the current list; any other facet has one value at a time, so a value
 * counts in the list with it in place of the facet's own. Every value the
 * search (or the box) holds is listed, in the order of that whole list — a
 * value never vanishes and keeps its rank among the others as filters go on;
 * one that would leave nothing counts 0 and goes after the rest (the page
 * greys it).
 */
function facetCounts(db: DB, p: BrowseParams, ids: string | undefined): Record<FacetName, FacetValue[]> {
	const any = filtered(p);
	const merge = (all: FacetValue[], now: FacetValue[]) => {
		if (!any) return all;
		const n = new Map(now.map((v) => [v.value, v.count]));
		const out = all.map((v) => ({ ...v, count: n.get(v.value) ?? 0 }));
		return [...out.filter((v) => v.count > 0), ...out.filter((v) => v.count === 0)];
	};
	const run = (facet: FacetName, select: string, from: string, group: string) => {
		const q = (w: Where) => {
			const extra = w.sql ? `${w.sql} AND ${group} IS NOT NULL` : `WHERE ${group} IS NOT NULL`;
			return db.prepare(`SELECT ${select} FROM ${from} ${extra} GROUP BY ${group} ORDER BY count DESC, value ASC`).all(...w.args) as FacetValue[];
		};
		return merge(q(where(p, ids, 'all')), any ? q(where(p, ids, facet === 'tags' ? undefined : facet)) : []);
	};
	const bucket = (facet: FacetName, sqls: Record<string, string>) => {
		const q = (w: Where) => {
			const cases = Object.entries(sqls)
				.map(([k, s]) => `SUM(CASE WHEN ${s} THEN 1 ELSE 0 END) AS "${k}"`)
				.join(', ');
			const row = db.prepare(`SELECT ${cases} FROM recipes r ${w.sql}`).get(...w.args) as Record<string, number | null>;
			return Object.keys(sqls).map((value) => ({ value, count: row[value] ?? 0 }));
		};
		const all = q(where(p, ids, 'all')).filter((v) => v.count > 0);
		return merge(all, any ? q(where(p, ids, facet)) : []);
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
		servings: bucket('servings', SERVINGS_SQL),
		unresolved: bucket('unresolved', UNRESOLVED_SQL)
	};
}

export function browse(db: DB, p: BrowseParams, { withFacets = true, tagOrder, withTags = true }: BrowseOptions = {}): BrowseResult {
	const found = search(db, p.q, p.exact);
	const ids = found ? JSON.stringify(found.hits.map((h) => h.id)) : undefined;
	const pageSize = Math.min(Math.max(p.pageSize ?? 24, 1), 100);
	const w = where(p, ids);
	const sort: Sort = p.sort ?? (found ? 'relevance' : 'title');
	let total: number;
	let items: Card[];
	let titleHits: number | null = null;
	let sections: BrowseResult['sections'] = null;
	let index: ReturnType<typeof letterIndex> | null = null;
	let page = 1;
	let pages = 1;
	let offset = 0;
	if (sort === 'relevance' && found) {
		// The search's order (search.ts): the title hits first, then by where the words are; bm25 within.
		const keep = new Set(db.prepare(`SELECT r.id FROM recipes r ${w.sql}`).pluck().all(...w.args) as number[]);
		const hits = found.hits.filter((h) => keep.has(h.id));
		total = hits.length;
		pages = Math.max(1, Math.ceil(total / pageSize));
		page = Math.min(Math.max(p.page ?? 1, 1), pages);
		offset = (page - 1) * pageSize;
		const slice = hits.slice(offset, offset + pageSize);
		const rows = db
			.prepare(`SELECT r.id AS _id, ${CARD_COLS} FROM recipes r WHERE r.id IN (SELECT value FROM json_each(?))`)
			.all(JSON.stringify(slice.map((h) => h.id))) as (Card & { _id: number })[];
		const byId = new Map(rows.map(({ _id, ...c }) => [_id, c as Card]));
		items = slice.map((h) => ({ ...byId.get(h.id)!, in_title: h.section === 'title', section: h.section }));
		titleHits = hits.filter((h) => h.section === 'title').length;
		sections = [];
		for (const h of hits) {
			const last = sections[sections.length - 1];
			if (last?.section === h.section) last.count++;
			else sections.push({ section: h.section, count: 1 });
		}
	} else {
		total = (db.prepare(`SELECT count(*) AS n FROM recipes r ${w.sql}`).get(...w.args) as { n: number }).n;
		// Sorted by title, the pages break where a letter changes, near `pageSize` (pageStarts).
		index = sort === 'title' || sort === 'relevance' ? letterIndex(db, w, pageSize) : null;
		pages = index ? index.starts.length : Math.max(1, Math.ceil(total / pageSize));
		page = Math.min(Math.max(p.page ?? 1, 1), pages);
		offset = index ? index.starts[page - 1] : (page - 1) * pageSize;
		const limit = index ? (index.starts[page] ?? total) - offset : pageSize;
		const order = ORDER[sort === 'relevance' ? 'title' : sort];
		items = db
			.prepare(`SELECT ${CARD_COLS} FROM recipes r ${w.sql} ORDER BY ${order} LIMIT ? OFFSET ?`)
			.all(...w.args, limit, offset) as Card[];
	}
	const names = familyNames(db, items.map((c) => c.family));
	const terms = found ? found.terms : [];
	const tags = withTags ? cardTags(db, items, tagOrder) : new Map<string, string[]>();
	items = items.map((c) => ({
		...c,
		broken: Boolean(c.broken),
		family_name: c.family ? (names[c.family] ?? null) : null,
		family_size: c.family ? c.family_size : null,
		tags: tags.get(c.slug) ?? [],
		seasons: seasonList(c.seasons as unknown as string | null)
	}));
	if (found) explain(db, items, found.units);
	const facets = withFacets
		? facetCounts(db, p, ids)
		: { family: [], tags: [], season: [], source: [], author: [], status: [], time: [], servings: [], unresolved: [] };
	return {
		total,
		page,
		pages,
		pageSize,
		offset,
		items,
		facets,
		letters: index?.letters ?? null,
		guides: index?.guides ?? null,
		terms,
		titleHits,
		sections,
		q: found?.q ?? null,
		suggestion: found?.suggestion ?? null,
		partial: found?.partial ?? null,
		also: found?.also ?? null,
		rated: db.prepare('SELECT count(*) FROM recipes WHERE rating IS NOT NULL').pluck().get() as number
	};
}

/** The index's comma-separated seasons → a list, in the year's order. */
function seasonList(csv: string | null): string[] {
	if (!csv) return [];
	const at = (x: string) => (SEASON_ORDER.indexOf(x) + 5) % 5;
	return [...new Set(csv.split(','))].sort((a, b) => at(a) - at(b));
}

/** The cards' tags: vocabulary order first (`order`), then the rest (pending tags) by name. */
function cardTags(db: DB, cards: Card[], order: string[] = []): Map<string, string[]> {
	const out = new Map<string, string[]>();
	if (!cards.length) return out;
	const rank = new Map(order.map((t, i) => [t, i]));
	const rows = db
		.prepare(`SELECT slug, tag FROM tags WHERE slug IN (${cards.map(() => '?').join(', ')}) ORDER BY tag`)
		.all(...cards.map((c) => c.slug)) as { slug: string; tag: string }[];
	for (const r of rows) out.set(r.slug, [...(out.get(r.slug) ?? []), r.tag]);
	const at = (t: string) => rank.get(t) ?? Infinity;
	for (const list of out.values()) list.sort((a, b) => at(a) - at(b) || (a < b ? -1 : a > b ? 1 : 0));
	return out;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/**
 * Per letter, the count and the page of its first recipe, in title order under
 * the same filters; and each page's guide words, from the titles at its edges.
 */
function letterIndex(db: DB, w: Where, pageSize: number): { letters: Letter[]; guides: Guide[]; starts: number[] } {
	const sorted = db.prepare(`SELECT r.title_sort FROM recipes r ${w.sql} ORDER BY r.title_sort`).pluck().all(...w.args) as string[];
	const starts = pageStarts(sorted, pageSize);
	const pageOf = (i: number) => starts.filter((s) => s <= i).length;
	const by = new Map<string, { count: number; first: number }>();
	sorted.forEach((title, i) => {
		const ch = title.charAt(0);
		const l = /^[a-z]$/.test(ch) ? ch.toUpperCase() : '#';
		const e = by.get(l);
		if (e) e.count++;
		else by.set(l, { count: 1, first: i });
	});
	const at = (l: string) => {
		const e = by.get(l);
		return { letter: l, count: e?.count ?? 0, page: e ? pageOf(e.first) : 0 };
	};
	const edges: Guide[] = sorted.length ? starts.map((s, i) => ({ first: sorted[s], last: sorted[(starts[i + 1] ?? sorted.length) - 1] })) : [];
	return { letters: [...(by.has('#') ? [at('#')] : []), ...ALPHABET.map(at)], guides: guideWords(edges), starts };
}

/** A recipe with its photo, for the home page's strip of scans over the list. */
export interface PhotoTile {
	slug: string;
	title: string;
	photo: string;
	variant: string | null;
	author: string | null;
	source_type: string | null;
	source_title: string | null;
	source_url: string | null;
	source_page: string | null;
}

/** The last recipes added that have a photo (a card's scan, mostly), newest first. */
export function photoTiles(db: DB, n = 4): PhotoTile[] {
	return db
		.prepare(
			`SELECT slug, title, photo, variant, author, source_type, source_title, source_url, source_page FROM recipes
			 WHERE photo IS NOT NULL AND photo != '' ORDER BY added IS NULL, added DESC, updated DESC, title_sort LIMIT ?`
		)
		.all(n) as PhotoTile[];
}

/** A recipe offered as an idea over the home page's index (ideas()): its second line says who it is from, its time and its course. */
export type IdeaCard = PhotoTile & { photo: string | null; total_s: number | null; tag: string | null };

export interface Ideas {
	/** A dozen recipes in a random order: the page shows one, ↻ the next. */
	random: IdeaCard[];
	/** This month's season (Québec), a few of its recipes at random, and how many it has. */
	season: { season: string; count: number; cards: IdeaCard[] } | null;
	/** The last recipes added. */
	recent: IdeaCard[];
	/** More ways in, read off the data (RAILS): each with how many it holds and a few at random. */
	rails: IdeaRail[];
}

/**
 * A way into the box for « qu'est-ce qu'on mange dimanche ? », built from
 * what the files say (no cook log exists, so nothing claims « not made in a
 * while »): the long-simmered main dishes, the recipes for a crowd, the best
 * rated. Each one's list is a filter or a sort of the home page (`href`), so
 * the head's link shows exactly the recipes the card draws from — except
 * `liked`, whose list is the whole box sorted by note.
 */
export interface IdeaRail {
	key: 'long' | 'crowd' | 'liked';
	href: string;
	count: number;
	cards: IdeaCard[];
}

const RAILS: { key: IdeaRail['key']; where: string; href: string }[] = [
	{ key: 'long', where: `r.slug IN (SELECT slug FROM tags WHERE tag = 'plat-principal') AND ${TIME_SQL.plus}`, href: '/?tag=plat-principal&temps=plus' },
	{ key: 'crowd', where: SERVINGS_SQL['7+'], href: '/?portions=7%2B' },
	{ key: 'liked', where: 'r.rating >= 4', href: '/?sort=rating' }
];

/** A rail shows when it holds at least this many recipes (fewer is not a way in). */
const RAIL_MIN = 3;

/**
 * The season of a month (1–12), Québec's: winter December to February,
 * spring March to May, summer June to August, autumn September to November.
 */
export function seasonOf(month: number): string {
	return month === 12 || month <= 2 ? 'hiver' : month <= 5 ? 'printemps' : month <= 8 ? 'ete' : 'automne';
}

const IDEA_COLS = `r.slug, r.title, r.photo, r.total_s, r.variant, r.author, r.source_type, r.source_title, r.source_url, r.source_page,
  ${COURSE_SQL} AS tag`;

/** « What should I make Sunday? »: a card at random, the season's, the last added (the home page, the whole box). */
export function ideas(db: DB, now = new Date(), n = 3): Ideas {
	const random = db.prepare(`SELECT ${IDEA_COLS} FROM recipes r ORDER BY random() LIMIT 12`).all() as IdeaCard[];
	const season = seasonOf(now.getMonth() + 1);
	const count = db.prepare('SELECT count(*) FROM seasons WHERE season = ?').pluck().get(season) as number;
	const cards = count
		? (db.prepare(`SELECT ${IDEA_COLS} FROM recipes r JOIN seasons s ON s.slug = r.slug WHERE s.season = ? ORDER BY random() LIMIT ?`).all(season, n) as IdeaCard[])
		: [];
	const recent = db
		.prepare(`SELECT ${IDEA_COLS} FROM recipes r ORDER BY r.added IS NULL, r.added DESC, r.updated DESC, r.title_sort LIMIT ?`)
		.all(n) as IdeaCard[];
	const rails: IdeaRail[] = [];
	for (const x of RAILS) {
		const k = db.prepare(`SELECT count(*) FROM recipes r WHERE ${x.where}`).pluck().get() as number;
		if (k < RAIL_MIN) continue;
		const some = db.prepare(`SELECT ${IDEA_COLS} FROM recipes r WHERE ${x.where} ORDER BY random() LIMIT ?`).all(n) as IdeaCard[];
		rails.push({ key: x.key, href: x.href, count: k, cards: some });
	}
	return { random, season: count ? { season, count, cards } : null, recent, rails };
}

/** Body Markdown → plain reading text: no list marks, emphasis, link targets or markers. */
function plainBody(md: string): string {
	return stripMarkers(
		md
			.replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, '')
			.replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
			.replace(/<[^>\n]*>/g, '')
			.replace(/^\s*#{1,6}\s+/gm, '')
			.replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
			.replace(/^\s*>\s?/gm, '')
			.replace(/[*_`~]+/g, '')
	)
		.replace(/\s+/g, ' ')
		.trim();
}

/** The body cut at its `##` headings. */
function sections(md: string): { section: string | null; text: string }[] {
	const out: { section: string | null; text: string }[] = [];
	let section: string | null = null;
	let buf: string[] = [];
	const flush = () => {
		const text = plainBody(buf.join('\n'));
		if (text) out.push({ section, text });
	};
	for (const line of md.split('\n')) {
		const h = /^##\s+(.+?)\s*#*\s*$/.exec(line);
		if (h) {
			flush();
			section = stripMarkers(h[1]).trim();
			buf = [];
		} else buf.push(line);
	}
	flush();
	return out;
}

/**
 * Sets `match` on the cards whose title does not hold every unit of the
 * search: the field that holds most of the rest — the card's section first
 * when it holds any (search.ts), then ingredients, tags, author, the body.
 * Reads only the cards on the page.
 */
function explain(db: DB, cards: Card[], units: SearchUnit[]): void {
	const ingStmt = db.prepare(
		`SELECT name FROM (SELECT name, position, -1 AS alt FROM ingredients WHERE slug = ? UNION ALL SELECT name, position, alt_idx FROM ingredient_or WHERE slug = ?) ORDER BY position, alt`
	);
	const tagStmt = db.prepare('SELECT tag FROM tags WHERE slug = ? ORDER BY tag').pluck();
	const bodyStmt = db.prepare('SELECT body_md FROM recipes WHERE slug = ?').pluck();
	/** The units (indexes into `units`, among `among`) the text holds, and the words of the names found (to mark). */
	const unitsIn = (text: string, among: number[]) => {
		const found = new Set<number>();
		const terms = new Set<string>();
		const seq = fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
		for (const i of among) {
			const alts = altsIn(seq, units[i]);
			if (alts.length) found.add(i), alts.forEach((a) => a.seq.forEach((w) => terms.add(w)));
		}
		return { units: found, terms };
	};
	const all = units.map((_, i) => i);
	const marked = new Set(units.flatMap((u) => [...u.words, ...u.alts.filter((a) => a.seq.length === 1).map((a) => a.seq[0])]));
	for (const c of cards) {
		const inTitle = unitsIn(stripMarkers(c.title), all).units;
		const rest = all.filter((i) => !inTitle.has(i));
		if (!rest.length) continue;
		const best: { match: Match; n: number; field: string }[] = [];
		const consider = (match: Match, found: Set<number>) => {
			// Words to mark only when another name of several words found it (the page marks the search's own words).
			if (!match.terms?.some((w) => !marked.has(w))) delete match.terms;
			if (found.size) best.push({ match, n: found.size, field: match.field });
		};
		const hitsOf = (texts: string[]) => {
			const found = new Set<number>();
			const terms = new Set<string>();
			const hit: string[] = [];
			const seen = new Set<string>();
			for (const x of texts) {
				const f = unitsIn(x, rest);
				if (!f.units.size || seen.has(fold(x))) continue;
				seen.add(fold(x));
				hit.push(x);
				f.units.forEach((t) => found.add(t));
				f.terms.forEach((t) => terms.add(t));
			}
			return { found, hit, terms: [...terms] };
		};
		const ing = hitsOf((ingStmt.all(c.slug, c.slug) as { name: string }[]).map((r) => stripMarkers(r.name)));
		consider({ field: 'ingredients', texts: ing.hit.slice(0, 3), terms: ing.terms }, ing.found);
		// Tags are slugs (the page shows their labels); `pate-a-tarte` holds the words pate, a, tarte.
		const tags = hitsOf(tagStmt.all(c.slug) as string[]);
		consider({ field: 'tags', texts: tags.hit.slice(0, 3), terms: tags.terms }, tags.found);
		if (c.author) {
			const a = unitsIn(c.author, rest);
			consider({ field: 'author', texts: [c.author], terms: [...a.terms] }, a.units);
		}
		const body = bodyStmt.get(c.slug) as string | undefined;
		if (body) {
			for (const s of sections(body)) {
				const found = unitsIn(s.text, rest);
				// The page puts the excerpt in « »: a note that is itself a quotation loses its own marks.
				const text = found.units.size ? excerpt(s.text, [...found.terms])?.replace(/^(… )?[«“"]\s*/, '$1').replace(/\s*[»”"]( …)?$/, '$1') : undefined;
				if (text) {
					consider({ field: 'body', section: s.section, texts: [text], terms: [...found.terms] }, found.units);
					break;
				}
			}
		}
		// The card's own section first, when it holds any; else most units covered, ties to the earlier field.
		const own = best.find((b) => b.field === (c.section === 'notes' ? 'body' : c.section));
		const top = own ?? best.reduce<(typeof best)[number] | undefined>((a, b) => (!a || b.n > a.n ? b : a), undefined);
		if (top) c.match = top.match;
	}
}

/**
 * Family slug → display name: its French label from vocab/families.yaml, else
 * the shortest title among its recipes (ties: title order) — never the slug.
 * `only`: just these families (the cards of a page); all of them when absent.
 */
export function familyNames(db: DB, only?: Iterable<string | null>): Record<string, string> {
	const want = only ? [...new Set([...only].filter((f): f is string => !!f))] : null;
	if (want && !want.length) return {};
	const filter = want ? `AND r.family IN (${want.map(() => '?').join(', ')})` : '';
	const rows = db
		.prepare(
			`SELECT r.family, r.title, r.title_sort, f.label_fr FROM recipes r LEFT JOIN families f ON f.slug = r.family
			 WHERE r.family IS NOT NULL ${filter}`
		)
		.all(...(want ?? [])) as { family: string; title: string; title_sort: string; label_fr: string | null }[];
	const out: Record<string, string> = {};
	const members = new Map<string, { title: string; title_sort: string }[]>();
	for (const r of rows) {
		if (r.label_fr) out[r.family] = r.label_fr;
		else members.set(r.family, [...(members.get(r.family) ?? []), r]);
	}
	for (const [f, m] of members) out[f] = shortestTitle(m)!;
	return out;
}

/** The shortest of the titles, ties to the first in title order: a family's name when it has no label. */
export function shortestTitle(recipes: { title: string; title_sort: string }[]): string | null {
	let best: { title: string; title_sort: string } | null = null;
	for (const r of recipes)
		if (!best || r.title.length < best.title.length || (r.title.length === best.title.length && r.title_sort < best.title_sort)) best = r;
	// A name, not a reading: the title's markers ([?], [+]) stay on the recipe.
	return best ? stripMarkers(best.title) : null;
}

/** One family's display name (see familyNames), or null when no recipe names it. */
export function familyName(db: DB, family: string): string | null {
	return familyNames(db, [family])[family] ?? null;
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
	/** The display name (familyNames). */
	name: string;
	count: number;
}

/** The families in use, by display name. */
export function families(db: DB): FamilySummary[] {
	const names = familyNames(db);
	return (
		db
			.prepare(
				`SELECT f.slug, f.label_fr AS label, count(r.slug) AS count FROM families f
			 LEFT JOIN recipes r ON r.family = f.slug GROUP BY f.slug HAVING count > 0 ORDER BY f.slug`
			)
			.all() as Omit<FamilySummary, 'name'>[]
	)
		.map((f) => ({ ...f, name: names[f.slug] ?? f.slug }))
		.sort((a, b) => fold(a.name).localeCompare(fold(b.name), 'fr') || a.slug.localeCompare(b.slug));
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
	author: string | null;
	source_type: string | null;
	source_title: string | null;
	source_url: string | null;
	source_page: string | null;
}

export interface FamilyDiff {
	family: string;
	label: string | null;
	/** The display name (familyNames). */
	name: string;
	/** The name without a label: the shortest title among its recipes. */
	fallback: string;
	variants: Variant[];
	/** Items in every variant, shown once. */
	common: string[];
	/**
	 * Items in some variants only: per item, which variants have it. `maybe`:
	 * the variants that have a name not linked yet whose first suggestion is
	 * this item (« casonade » beside « cassonade »), with that name and its
	 * key — compared as the same ingredient, marked « même ingrédient ? ».
	 */
	rows: { item: string; label: string; in: string[]; maybe?: { slug: string; name: string; key: string }[] }[];
	/** Per variant slug, the items only it has — the differentiator. */
	unique: Record<string, string[]>;
	/** Which of total_s, servings, difficulty, rating differ between variants. */
	differs: { total_s: boolean; servings: boolean; difficulty: boolean; rating: boolean };
}

/**
 * `guess`: for a name not linked yet (its lookup key), the registry entry it
 * likely is — /resoudre's first suggestion (docs/INGREDIENTS.md,
 * "Resolution") — or null. Without it, an unlinked name is its own row.
 */
export function familyDiff(db: DB, family: string, guess?: (key: string) => string | null): FamilyDiff | undefined {
	const variants = db
		.prepare(
			`SELECT slug, title, variant, total_s, servings, servings_max, difficulty, rating, status, photo, author, source_type, source_title, source_url, source_page
			 FROM recipes WHERE family = ? ORDER BY variant, title_sort`
		)
		.all(family) as Variant[];
	if (!variants.length) return undefined;
	const label = (db.prepare('SELECT label_fr FROM families WHERE slug = ?').pluck().get(family) as string | null) ?? null;
	const fallback = shortestTitle(db.prepare('SELECT title, title_sort FROM recipes WHERE family = ?').all(family) as { title: string; title_sort: string }[])!;
	const rows = db
		// Unresolved rows group by their lookup key, so the table still works before the queue is worked.
		.prepare(
			`SELECT i.slug, COALESCE(i.item, 'k:' || i.key) AS item, i.name FROM ingredients i JOIN recipes r ON r.slug = i.slug WHERE r.family = ? ORDER BY i.position`
		)
		.all(family) as { slug: string; item: string; name: string }[];
	const byItem = new Map<string, { label: string; in: Set<string>; maybe: Map<string, { slug: string; name: string; key: string }> }>();
	const linked = new Set(rows.filter((r) => !r.item.startsWith('k:')).map((r) => r.item));
	for (const r of rows) {
		// A name not linked yet that is likely an item the others have: on that item's row, as a « maybe ».
		const key = r.item.startsWith('k:') ? r.item.slice(2) : null;
		const likely = key && guess ? guess(key) : null;
		const item = likely && linked.has(likely) ? likely : r.item;
		const e = byItem.get(item) ?? { label: r.name, in: new Set<string>(), maybe: new Map() };
		if (item !== r.item) {
			if (!e.in.has(r.slug)) e.maybe.set(r.slug, { slug: r.slug, name: r.name, key: key! });
		} else {
			if (!e.in.size && e.maybe.size) e.label = r.name;
			e.in.add(r.slug);
			e.maybe.delete(r.slug);
		}
		byItem.set(item, e);
	}
	const n = variants.length;
	const common: string[] = [];
	const partial: FamilyDiff['rows'] = [];
	const unique: Record<string, string[]> = Object.fromEntries(variants.map((v) => [v.slug, []]));
	for (const [item, e] of byItem) {
		if (e.in.size === n && n > 1) common.push(e.label);
		else {
			const maybe = [...e.maybe.values()];
			partial.push({ item, label: e.label, in: variants.filter((v) => e.in.has(v.slug)).map((v) => v.slug), ...(maybe.length ? { maybe } : {}) });
			if (e.in.size === 1 && !maybe.length) unique[[...e.in][0]].push(e.label);
		}
	}
	const differ = (k: keyof FamilyDiff['differs']) => new Set(variants.map((v) => v[k])).size > 1;
	partial.sort((a, b) => b.in.length - a.in.length || a.label.localeCompare(b.label, 'fr'));
	return {
		family,
		label,
		name: label ?? fallback,
		fallback,
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
