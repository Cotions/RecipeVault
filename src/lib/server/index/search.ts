// The full-text search behind the home page (docs/DATA-FLOW.md, "Full-text
// search"): the query's words, each with the registry's other names for the
// ingredient it names (« pomme » also finds « Apple Crisp »), or for the
// ingredients whose names it heads (« poivron » finds « piment vert »), and
// the search's own words that stand for each other (searchwords.ts: « tante »
// finds « Matante Rollande », « cake » « Gâteau »); a compound name of another
// ingredient kept whole (« pomme » is not « pommes de terre »), the little
// words dropped (« ma » is not « maigre »), a close spelling when a word finds
// nothing (« tourtire » → « tourtière »), each word alone when together they
// find nothing, and each hit's section: the title, else where the words are.

import { queryTerms } from '../../render/hits';
import { stripMarkers } from '../../vault/markers';
import { editDistance, fold } from '../../vault/normalize';
import { getMeta } from './build';
import type { DB } from './db';
import { groupOf, NOT_THEIR_HEAD, STOP_WORDS } from './searchwords';

/**
 * Where a result's words are: its title, else the field that holds most of
 * them (in this order on ties). `body` is the method and any text before the
 * first heading; `notes` the other sections (Notes, Variantes, Alternatives).
 */
export const SECTIONS = ['title', 'ingredients', 'tags', 'author', 'body', 'notes'] as const;
export type Section = (typeof SECTIONS)[number];

/** A run of folded words. */
type Seq = string[];

/**
 * One way a unit is written: its words, the last one a prefix (`prefix`, as
 * typed: « pommes de t ») or a whole word, alone or with a final s or x
 * (`word`: « tarte » finds « tartes », not « tartelette »).
 */
export interface Alt {
	seq: Seq;
	end: 'prefix' | 'word';
}

/** One unit of a query: a word, or a run of words that names one thing. */
export interface SearchUnit {
	/** As typed, folded. */
	words: Seq;
	/** Where in the query's words it starts (queryTerms). */
	at: number;
	/** What finds it: the words, and the other names of what they name. */
	alts: Alt[];
	/** The registry entry the unit names, when exactly one. */
	entry: string | null;
	/** The entries whose resolved lines count as a hit: the one it names, or those whose names it heads. */
	items: string[];
	/** Other entries' compound names that hold the word without meaning it (« pommes de terre » for « pomme »). */
	exclude: Seq[];
	/** Names the word heads without naming a kind of it (searchwords.ts NOT_THEIR_HEAD), as the registry writes them: offered apart (« Aussi »). */
	apart?: string[];
}

export interface SearchHit {
	id: number;
	/** How many of the units the title holds. */
	titleUnits: number;
	/** The weakest place a unit is found in, by SECTIONS order (each unit at its best): a word only a note mentions ranks the hit lower. */
	weakest: number;
	section: Section;
	/** bm25, lower is better. */
	rank: number;
	title_sort: string;
}

/** A word of the query alone, when together they find nothing: how many recipes it finds. */
export interface PartialHit {
	/** The word (or run) as typed. */
	q: string;
	count: number;
}

/** Another name the search also looked under (« piment vert » for « poivron »), and how many recipes it finds alone. */
export interface AlsoHit {
	q: string;
	count: number;
	/** Not among the results: a name the word heads without meaning it (« piment de la Jamaïque » for « piment »), offered as its own search. */
	apart?: boolean;
}

export interface SearchOutcome {
	/** The query searched: the one typed, or its correction when the typed one finds nothing. */
	q: string;
	units: SearchUnit[];
	/** Folded prefixes to mark in the results (render/hits.ts): the words and the single-word names they stand for. */
	terms: string[];
	/** Per unit, its prefixes (explain() reads a field's hits per unit). */
	groups: string[][];
	/** Every hit, best first (sections in SECTIONS order). */
	hits: SearchHit[];
	/** A close spelling with more results; `applied` when the typed query found nothing and these are its results. */
	suggestion: { q: string; applied: boolean } | null;
	/** Nothing found with every word: each word alone, with its count (« carrot » seul : 27). */
	partial: PartialHit[] | null;
	/** One word that stands for several ingredients (« poivron »): each by its most written name, with its count. */
	also: AlsoHit[] | null;
}

const words = (s: string): string[] => fold(stripMarkers(s)).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// ---------------------------------------------------------------- registry

interface Alias {
	slug: string;
	lang: string;
	seq: Seq;
	/** As the registry writes it (« huile d’olive »). */
	name: string;
}

interface Names {
	/** Joined folded words → the entries with that name. */
	byKey: Map<string, Set<string>>;
	/** The same, by the name's singular (`ingredient_names.skey`): « pommes » finds an entry that lists only « pomme ». */
	bySkey: Map<string, Set<string>>;
	/** Every multi-word name, for prefix runs while typing. */
	multi: Alias[];
	bySlug: Map<string, Alias[]>;
	category: Map<string, string>;
	/** Compound names per entry, computed on first use. */
	compounds: Map<string, Seq[]>;
	/** A word (and its singular) → the entries with a several-word name it heads (French: first word, English: last): « poivron » → poivron-vert, poivron-rouge. */
	heads: Map<string, Set<string>>;
}

const namesCache = new WeakMap<DB, { hash: string; names: Names }>();

/** The registry's names, rebuilt when `meta.registry_hash` changes. */
function registryNames(db: DB): Names {
	const hash = getMeta(db, 'registry_hash') ?? '';
	const hit = namesCache.get(db);
	if (hit && hit.hash === hash) return hit.names;
	const names: Names = { byKey: new Map(), bySkey: new Map(), multi: [], bySlug: new Map(), category: new Map(), compounds: new Map(), heads: new Map() };
	for (const r of db.prepare('SELECT slug, category FROM registry').all() as { slug: string; category: string }[]) names.category.set(r.slug, r.category);
	for (const r of db.prepare('SELECT slug, lang, name, skey FROM ingredient_names').all() as { slug: string; lang: string; name: string; skey: string }[]) {
		const seq = words(r.name);
		if (!seq.length) continue;
		const a = { slug: r.slug, lang: r.lang, seq, name: stripMarkers(r.name) };
		const k = seq.join(' ');
		(names.byKey.get(k) ?? names.byKey.set(k, new Set()).get(k)!).add(r.slug);
		const sk = words(r.skey).join(' ');
		(names.bySkey.get(sk) ?? names.bySkey.set(sk, new Set()).get(sk)!).add(r.slug);
		(names.bySlug.get(r.slug) ?? names.bySlug.set(r.slug, []).get(r.slug)!).push(a);
		if (seq.length > 1) {
			names.multi.push(a);
			const head = r.lang === 'en' ? seq[seq.length - 1] : seq[0];
			for (const h of new Set([head, head.replace(/[sx]$/, '')])) (names.heads.get(h) ?? names.heads.set(h, new Set()).get(h)!).add(r.slug);
		}
	}
	namesCache.set(db, { hash, names });
	return names;
}

/**
 * The compound names that hold one of `slug`'s single-word names as their
 * head (French: the first word, « pommes de terre »; English: the last,
 * « apple juice » is juice) and belong to an entry of another category: a
 * search for that word does not count them. Same category stays a hit
 * (« sucre » finds « sucre à glacer », « oignon » « oignons verts »).
 */
function compoundsOf(n: Names, slug: string): Seq[] {
	const known = n.compounds.get(slug);
	if (known) return known;
	// Singular or plural alike (« pommes de terre » for an entry that lists « pomme »).
	const one = (w: string) => w.replace(/[sx]$/, '');
	const heads = new Set((n.bySlug.get(slug) ?? []).filter((a) => a.seq.length === 1).map((a) => one(a.seq[0])));
	const cat = n.category.get(slug);
	const out = n.multi
		.filter((a) => a.slug !== slug && n.category.get(a.slug) !== cat && heads.has(one(a.lang === 'en' ? a.seq[a.seq.length - 1] : a.seq[0])))
		.map((a) => a.seq);
	n.compounds.set(slug, out);
	return out;
}

const only = (s: Set<string> | undefined) => (s && s.size === 1 ? [...s][0] : null);

/**
 * The one entry a run of words names: by its name, else by its singular
 * (the run, or the run less a final s or x: the plural rules of
 * vocab/normalize.yaml strip more, this is enough to find the name).
 */
function entryOf(n: Names, run: Seq): string | null {
	const k = run.join(' ');
	const exact = n.byKey.get(k);
	if (exact) return only(exact);
	return only(n.bySkey.get(k)) ?? only(n.bySkey.get(k.replace(/[sx]$/, '')));
}

/** How many entries a word may head and still stand for them all (« huile » for the oils; a word that heads more says too little). */
const MAX_HEADED = 12;

/**
 * The query's words cut into units: a run that names an ingredient, or a
 * name of the search's word groups (« ma tante »), or begins an ingredient's
 * name while typing, is one. The little words (STOP_WORDS) are dropped next
 * to others; alone, each matches only itself.
 */
export function planQuery(db: DB, q: string): SearchUnit[] {
	const n = registryNames(db);
	const toks = queryTerms(q);
	const out: SearchUnit[] = [];
	const little = new Set<SearchUnit>();
	const plain = (run: Seq, at: number, end: Alt['end'] = 'prefix'): SearchUnit => ({ words: run, at, alts: [{ seq: run, end }], entry: null, items: [], exclude: [] });
	for (let i = 0; i < toks.length; ) {
		let unit: SearchUnit | null = null;
		for (let len = Math.min(5, toks.length - i); len >= 2 && !unit; len--) {
			const run = toks.slice(i, i + len);
			const slug = entryOf(n, run);
			if (slug) unit = named(n, run, i, slug);
			else if (groupOf(run)) unit = grouped(run, i);
			// The last word typed so far begins a compound name: the run as typed, nothing left out.
			else if (i + len === toks.length && n.multi.some((a) => a.seq.length >= len && run.every((w, k) => (k < len - 1 ? a.seq[k] === w : a.seq[k].startsWith(w)))))
				unit = plain(run, i);
			if (unit) i += len;
		}
		if (!unit) {
			const w = toks[i];
			if (STOP_WORDS.has(w)) little.add((unit = plain([w], i, 'word')));
			else {
				const slug = w.length > 2 ? entryOf(n, [w]) : null;
				const headed = !slug && w.length > 2 ? kindsOf(n, w, headedBy(n, w)) : [];
				unit = slug ? named(n, [w], i, slug) : groupOf([w]) ? grouped([w], i) : headed.length ? heading(n, [w], i, headed) : plain([w], i);
			}
			i++;
		}
		out.push(unit);
	}
	for (const u of out) if (u.words.length === 1) holdApart(n, u);
	// The little words count only alone.
	const kept = out.filter((u) => !little.has(u));
	return kept.length ? kept : out;
}

/** The NOT_THEIR_HEAD names a word heads (as itself or its singular), folded. */
function notKinds(w: string): Seq[] {
	const one = (x: string) => x.replace(/[sx]$/, '');
	return NOT_THEIR_HEAD.map((x) => x.split(' ')).filter((x) => x[0] === w || one(x[0]) === one(w));
}

/**
 * The entries a word heads that are kinds of it: not those it heads only by a
 * name of NOT_THEIR_HEAD (« piment » heads allspice's « piment de la
 * Jamaïque », which is no « piment »).
 */
function kindsOf(n: Names, w: string, slugs: string[]): string[] {
	const off = new Set(notKinds(w).map((x) => x.join(' ')));
	if (!off.size) return slugs;
	const one = (x: string) => x.replace(/[sx]$/, '');
	return slugs.filter((slug) => {
		const named = (n.bySlug.get(slug) ?? []).filter((a) => a.seq.length > 1 && one(a.seq[0]) === one(w));
		return !named.length || named.some((a) => !off.has(a.seq.join(' ')));
	});
}

/**
 * A one-word unit leaves out the names it heads without naming a kind of it
 * (« piment de la Jamaïque » is allspice, not a « piment »): they never count
 * as a hit, and those the registry writes are kept to be offered apart
 * (« Aussi : piment de la Jamaïque (2) »).
 */
function holdApart(n: Names, u: SearchUnit): void {
	const seqs = notKinds(u.words[0]);
	if (!seqs.length) return;
	u.exclude = [...u.exclude, ...seqs];
	const apart: string[] = [];
	for (const x of seqs) {
		const a = n.multi.find((m) => m.seq.join(' ') === x.join(' ') && m.slug !== u.entry);
		if (a && !apart.includes(a.name)) apart.push(a.name);
	}
	if (apart.length) u.apart = apart;
}

/** The entries whose several-word names a word heads, when it is not too common a head. */
function headedBy(n: Names, w: string): string[] {
	const got = n.heads.get(w) ?? n.heads.get(w.replace(/[sx]$/, ''));
	return got && got.size <= MAX_HEADED ? [...got] : [];
}

function named(n: Names, run: Seq, at: number, slug: string): SearchUnit {
	const alts = new Map<string, Alt>([[run.join(' '), { seq: run, end: 'prefix' }]]);
	for (const a of n.bySlug.get(slug) ?? []) if (!alts.has(a.seq.join(' '))) alts.set(a.seq.join(' '), { seq: a.seq, end: 'prefix' });
	return { words: run, at, alts: [...alts.values()], entry: slug, items: [slug], exclude: run.length === 1 ? compoundsOf(n, slug) : [] };
}

/**
 * A word that heads other entries' names (« poivron »): itself, and every
 * name of those entries — except where a longer name of another entry holds
 * one (« red pepper » in « crushed red pepper », the flakes).
 */
function heading(n: Names, run: Seq, at: number, slugs: string[]): SearchUnit {
	const alts = new Map<string, Alt>([[run.join(' '), { seq: run, end: 'prefix' }]]);
	for (const slug of slugs) for (const a of n.bySlug.get(slug) ?? []) if (!alts.has(a.seq.join(' '))) alts.set(a.seq.join(' '), { seq: a.seq, end: 'prefix' });
	const mine = new Set(slugs);
	const inside = (big: Seq, small: Seq) => big.length > small.length && big.some((_, i) => small.every((w, k) => big[i + k] === w));
	const exclude = n.multi.filter((m) => !mine.has(m.slug) && [...alts.values()].some((a) => a.seq.length > 1 && inside(m.seq, a.seq))).map((m) => m.seq);
	return { words: run, at, alts: [...alts.values()], entry: null, items: slugs, exclude };
}

/** A name of the search's word groups (searchwords.ts): itself as typed, and the group's other names. */
function grouped(run: Seq, at: number): SearchUnit {
	const g = groupOf(run)!;
	const alts = new Map<string, Alt>([[run.join(' '), { seq: run, end: 'prefix' }]]);
	for (const name of g.names) if (!alts.has(name)) alts.set(name, { seq: name.split(' '), end: g.end });
	return { words: run, at, alts: [...alts.values()], entry: null, items: [], exclude: [] };
}

// ---------------------------------------------------------------- matching

const ftsAlt = (a: Alt) => {
	const p = a.seq.join(' ');
	// A whole word: as written, or with a final s or x (FTS5 has no « this word or its plural »).
	return a.end === 'prefix' ? `"${p}"*` : `"${p}" OR "${p}s" OR "${p}x"`;
};
const ftsOf = (u: SearchUnit) => `(${u.alts.map(ftsAlt).join(' OR ')})`;

/**
 * Whether the words hold `alt` at a place no excluded compound covers: its
 * last word as a prefix (`prefix`), or whole, alone or with a final s or x
 * (`word`).
 */
export function holds(text: Seq, alt: Seq, exclude: Seq[] = [], end: Alt['end'] = 'prefix'): boolean {
	const covered = new Set<number>();
	for (const c of exclude)
		for (let i = 0; i + c.length <= text.length; i++) if (c.every((w, k) => text[i + k] === w)) for (let k = 0; k < c.length; k++) covered.add(i + k);
	const last = (t: string, w: string) => (end === 'prefix' ? t.startsWith(w) : t === w || t === `${w}s` || t === `${w}x`);
	for (let i = 0; i + alt.length <= text.length; i++) {
		if (covered.has(i)) continue;
		if (alt.every((w, k) => (k === alt.length - 1 ? last(text[i + k], w) : text[i + k] === w))) return true;
	}
	return false;
}

/** The unit's names the words hold. */
export const altsIn = (text: Seq, u: SearchUnit): Alt[] => u.alts.filter((a) => holds(text, a.seq, u.exclude, a.end));
const unitIn = (text: Seq, u: SearchUnit) => u.alts.some((a) => holds(text, a.seq, u.exclude, a.end));

/** The method's headings (docs/RECIPE-SCHEMA.md, "Body"), folded: the other sections are notes. */
const METHOD = new Set(['preparation', 'instructions', 'methode', 'method']);

/**
 * The body's indexed text (folded: one line, its `##` headings kept) cut in
 * two: the method (and what comes before the first heading), and the other
 * sections — Notes, Variantes, Alternatives — which only mention a word
 * (« Se sert avec la tourtière »). A section is the method when its heading's
 * first word is one of the method's.
 */
export function bodyParts(text: string): { body: string; notes: string } {
	const body: string[] = [];
	const notes: string[] = [];
	text.split(/(?:^|\s)##(?!#)\s*/).forEach((chunk, i) => {
		if (i === 0) body.push(chunk);
		else (METHOD.has(words(chunk)[0] ?? '') ? body : notes).push(chunk);
	});
	return { body: body.join(' '), notes: notes.join(' ') };
}

interface Row {
	id: number;
	title: string;
	body: string;
	ingredients: string;
	author: string;
	tags: string;
	title_sort: string;
}

/** The recipes with an ingredient line (or `or` choice) resolved to one of the unit's entries. */
function itemIds(db: DB, u: SearchUnit): Set<number> {
	if (!u.items.length) return new Set();
	const list = JSON.stringify(u.items);
	return new Set(
		db
			.prepare(
				`SELECT r.id FROM recipes r WHERE r.slug IN (SELECT slug FROM ingredients WHERE item IN (SELECT value FROM json_each(?))
				 UNION SELECT slug FROM ingredient_or WHERE item IN (SELECT value FROM json_each(?)))`
			)
			.pluck()
			.all(list, list) as number[]
	);
}

/** Every recipe the units find together, each with its section and rank. */
function run(db: DB, units: SearchUnit[]): SearchHit[] {
	if (!units.length) return [];
	const items = units.map((u) => itemIds(db, u));
	let ids = undefined as Set<number> | undefined;
	for (const [i, u] of units.entries()) {
		// Its FTS match, plus the recipes with an ingredient resolved to its entry.
		const got = new Set(db.prepare('SELECT rowid FROM recipes_fts WHERE recipes_fts MATCH ?').pluck().all(ftsOf(u)) as number[]);
		for (const id of items[i]) got.add(id);
		const prev: Set<number> | undefined = ids;
		ids = prev ? new Set([...prev].filter((id) => got.has(id))) : got;
		if (!ids.size) return [];
	}
	const list = [...ids!];
	const rows = db
		.prepare(
			`SELECT f.rowid AS id, f.title, f.body, f.ingredients, f.author, f.tags, r.title_sort FROM recipes_fts f JOIN recipes r ON r.id = f.rowid
			 WHERE f.rowid IN (SELECT value FROM json_each(?))`
		)
		.all(JSON.stringify(list)) as Row[];
	const ranks = new Map(
		(
			db
				.prepare('SELECT rowid AS id, bm25(recipes_fts, 10.0, 1.0, 4.0, 2.0, 2.0) AS rank FROM recipes_fts WHERE recipes_fts MATCH ?')
				.all(units.map(ftsOf).join(' OR ')) as { id: number; rank: number }[]
		).map((r) => [r.id, r.rank])
	);
	const hits: SearchHit[] = [];
	const split = (x: string) => x.split(/[^\p{L}\p{N}]+/u);
	for (const r of rows) {
		const parts = bodyParts(r.body);
		const f = { title: split(r.title), ingredients: split(r.ingredients), tags: split(r.tags), author: split(r.author), body: split(parts.body), notes: split(parts.notes) };
		// A unit counts where one of its names stands outside a compound of another ingredient (or an ingredient resolved to it).
		const inIng = units.map((u, i) => items[i].has(r.id) || unitIn(f.ingredients, u));
		const where = units.map((u, i) => ({
			title: unitIn(f.title, u),
			ingredients: inIng[i],
			tags: unitIn(f.tags, u),
			author: unitIn(f.author, u),
			body: unitIn(f.body, u),
			notes: unitIn(f.notes, u)
		}));
		if (where.some((w) => !SECTIONS.some((s) => w[s]))) continue;
		const titleUnits = where.filter((w) => w.title).length;
		let section: Section = 'notes';
		if (titleUnits) section = 'title';
		else {
			// The field holding the most units; ties to the earlier (a note that only mentions the word comes last).
			let best = 0;
			for (const s of ['ingredients', 'tags', 'author', 'body', 'notes'] as const) {
				const k = where.filter((w) => w[s]).length;
				if (k > best) (best = k), (section = s);
			}
		}
		const weakest = Math.max(...where.map((w) => SECTIONS.findIndex((s) => w[s])));
		hits.push({ id: r.id, titleUnits, weakest, section, rank: ranks.get(r.id) ?? 0, title_sort: r.title_sort });
	}
	const order = (s: Section) => SECTIONS.indexOf(s);
	return hits.sort(
		(a, b) => order(a.section) - order(b.section) || b.titleUnits - a.titleUnits || a.weakest - b.weakest || a.rank - b.rank || (a.title_sort < b.title_sort ? -1 : a.title_sort > b.title_sort ? 1 : 0)
	);
}

// ---------------------------------------------------------------- spelling

interface Word {
	/** As it is most often written (« tourtière »). */
	display: string;
	/** How many titles and ingredient lines use it. */
	n: number;
}

const wordsCache = new WeakMap<DB, { key: string; words: Map<string, Word> }>();

/** The words of the titles, the ingredient lines and the registry's names: what a misspelled word is matched against. */
function vocabulary(db: DB): Map<string, Word> {
	const key = `${db.prepare('SELECT total_changes()').pluck().get()}:${db.pragma('data_version', { simple: true })}`;
	const hit = wordsCache.get(db);
	if (hit && hit.key === key) return hit.words;
	const forms = new Map<string, Map<string, number>>();
	const add = (text: string) => {
		for (const w of stripMarkers(text).normalize('NFC').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
			if (w.length < 3 || /\d/.test(w)) continue;
			const f = fold(w);
			const m = forms.get(f) ?? forms.set(f, new Map()).get(f)!;
			m.set(w, (m.get(w) ?? 0) + 1);
		}
	};
	for (const t of db.prepare('SELECT title FROM recipes').pluck().all() as string[]) add(t);
	for (const t of db.prepare('SELECT name FROM ingredients').pluck().all() as string[]) add(t);
	for (const t of db.prepare('SELECT name FROM ingredient_names').pluck().all() as string[]) add(t);
	const out = new Map<string, Word>();
	for (const [f, m] of forms) {
		let display = f;
		let n = 0;
		let top = 0;
		for (const [w, k] of m) {
			n += k;
			if (k > top) (top = k), (display = w);
		}
		out.set(f, { display, n });
	}
	wordsCache.set(db, { key, words: out });
	return out;
}

/** Edits allowed for a word of this length: one up to 5 letters (4 at least), two from 7. */
export const maxEdits = (len: number) => (len < 4 ? 0 : len <= 6 ? 1 : 2);

/** The closest known word, or null: fewest edits, then the most used. */
export function closest(word: string, vocab: Map<string, Word>): Word | null {
	const max = maxEdits(word.length);
	if (!max) return null;
	let best: { w: Word; d: number } | null = null;
	for (const [f, w] of vocab) {
		if (Math.abs(f.length - word.length) > max) continue;
		const d = editDistance(word, f);
		if (d === 0 || d > max) continue;
		if (!best || d < best.d || (d === best.d && w.n > best.w.n)) best = { w, d };
	}
	return best?.w ?? null;
}

/**
 * The query with each word that finds nothing alone replaced by its closest
 * known word; null when no word needed it or none was close. The typed words
 * keep their spelling otherwise.
 */
function respell(db: DB, q: string): string | null {
	const toks = queryTerms(q);
	const typed = stripMarkers(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, toks.length);
	const vocab = vocabulary(db);
	let changed = false;
	const out = toks.map((w, i) => {
		const finds = db.prepare('SELECT 1 FROM recipes_fts WHERE recipes_fts MATCH ? LIMIT 1').get(`"${w}"*`);
		if (finds) return typed.length === toks.length ? typed[i] : w;
		const c = closest(w, vocab);
		if (!c) return typed.length === toks.length ? typed[i] : w;
		changed = true;
		return c.display;
	});
	return changed ? out.join(' ') : null;
}

// ---------------------------------------------------------------- search

/** Fewer results than this, a close spelling is offered. */
const FEW = 3;

/**
 * A word that heads several entries' names (« poivron »: the green and the
 * red), searched as all of them: each entry by the name the box writes most
 * (« piment vert »), with what a search for it alone finds — the two that
 * find most, and only those that narrow the list.
 */
function alsoNames(db: DB, unit: SearchUnit, total: number): AlsoHit[] {
	const n = registryNames(db);
	const count = db.prepare('SELECT count(*) FROM recipes_fts WHERE recipes_fts MATCH ?').pluck();
	const out: AlsoHit[] = [];
	for (const slug of unit.items.length > 1 ? unit.items : []) {
		let best: { name: string; k: number } | null = null;
		for (const a of n.bySlug.get(slug) ?? []) {
			const k = count.get(`"${a.seq.join(' ')}"`) as number;
			if (!best || k > best.k) best = { name: a.name, k };
		}
		if (!best?.k) continue;
		const q = best.name;
		const found = run(db, planQuery(db, q)).length;
		if (found > 0 && found < total) out.push({ q, count: found });
	}
	out.sort((a, b) => b.count - a.count).splice(2);
	// Then each name held apart (« piment de la Jamaïque »), with what it finds alone.
	for (const q of unit.apart ?? []) {
		const found = run(db, planQuery(db, q)).length;
		if (found > 0) out.push({ q, count: found, apart: true });
	}
	return out;
}

/**
 * Search the box. With no words, null (the whole box). `exact`: the words as
 * typed even when they find nothing (« Chercher exactement »): the close
 * spelling is offered, never searched in their place.
 */
export function search(db: DB, q: string | undefined, exact = false): SearchOutcome | null {
	if (!q || !queryTerms(q).length) return null;
	let units = planQuery(db, q);
	let hits = run(db, units);
	let used = q;
	let suggestion: SearchOutcome['suggestion'] = null;
	if (hits.length < FEW) {
		const alt = respell(db, q);
		if (alt) {
			const altUnits = planQuery(db, alt);
			const altHits = run(db, altUnits);
			if (altHits.length > hits.length) {
				suggestion = { q: alt, applied: !exact && hits.length === 0 };
				if (suggestion.applied) [units, hits, used] = [altUnits, altHits, alt];
			}
		}
	}
	// Nothing with every word: each word alone, as typed (« carrot » seul : 27).
	let partial: PartialHit[] | null = null;
	if (!hits.length && units.length > 1) {
		const toks = queryTerms(used);
		const typed = stripMarkers(used).split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, toks.length);
		const as = (u: SearchUnit) => (typed.length === toks.length ? typed.slice(u.at, u.at + u.words.length) : u.words).join(' ');
		partial = units.map((u) => ({ q: as(u), count: run(db, [u]).length }));
	}
	const also = units.length === 1 && (units[0].items.length > 1 || units[0].apart) ? alsoNames(db, units[0], hits.length) : [];
	const groups = units.map((u) => [...new Set([...u.words, ...u.alts.filter((a) => a.seq.length === 1).map((a) => a.seq[0])])]);
	return { q: used, units, terms: [...new Set(groups.flat())], groups, hits, suggestion, partial, also: also.length ? also : null };
}
