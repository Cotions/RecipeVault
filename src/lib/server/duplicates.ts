// Possible duplicates (plan 05, Phases 6–7; docs/INGREDIENTS.md, "Duplicates"):
// W505 on the paste box, the form and the save result; the pair list
// (/doublons) and its three actions, each one commit by the signed-in person
// (Q13 B):
//
// - "Deux versions de la même recette": both recipes in one family, one
//   commit editing both (the W608 pair, from the list), hash-guarded on both;
// - "C'est la même recette": the one she picks to the trash (`delete:`, the
//   trash's own writer; undone from the toast or /corbeille);
// - "Recettes différentes": the pair written to `vocab/distinct.yaml` (Q14 A;
//   docs/VOCAB.md, "Distinct recipes"): one line per pair, `- [a, b]`, the two
//   slugs sorted, the lines sorted, edited as text (comments kept); commit
//   `duplicate: <a> ≠ <b>`, hash-guarded on the file. A pair naming a slug no
//   longer in the vault is ignored.

import { parse } from 'yaml';
import { DUPLICATE_THRESHOLD, weightedJaccard, weightOf, type SimPair } from '../ingredients/similar';
import { slugify } from '../vault/slug';
import { stripMarkers } from '../vault/markers';
import { normTitle } from '../vault/rules/batch';
import { withinDistance } from '../vault/normalize';
import type { Diagnostic, Recipe } from '../vault/types';
import { t } from '../i18n';
import { provenanceLine } from '../render/provenance';
import { committed, type VaultContext } from './context';
import { cleanLabel, FAMILIES_FILE, familiesFile, FamilyLabelError, LABEL_MAX, withLabel } from './families';
import { FileWriteError, readVaultFile, writeAndCommit, type FileWrite } from './files';
import { familyNames, usedBy } from './index/query';
import { STOP_WORDS } from './index/searchwords';
import { allPairs, batchPairsFor, duplicateModel, pairDetail, pairKey, pairsFor } from './index/similar';
import { EditError, editRecipesLocked, SaveError } from './save';
import { remove, TrashError } from './trash';
import { VOCAB } from './vault';
import { loadVocab } from './vocab';

export const DISTINCT_FILE = `${VOCAB}/distinct.yaml`;

/** One entry of the file as a pair of two different slugs, sorted; null when it is not one. */
function asPair(e: unknown): [string, string] | null {
	if (!Array.isArray(e) || e.length !== 2 || typeof e[0] !== 'string' || typeof e[1] !== 'string' || e[0] === e[1]) return null;
	return e[0] < e[1] ? [e[0], e[1]] : [e[1], e[0]];
}

/**
 * vocab/distinct.yaml as it reads: its well-formed pairs, and `problem` when
 * the file as a whole does not read (bad YAML, or not a list) — then no pair
 * of it counts, and the app refuses to rewrite it.
 */
export function readDistinct(text: string): { pairs: [string, string][]; problem?: 'yaml' | 'not-a-list' } {
	let data: unknown;
	try {
		data = parse(text, { version: '1.2' });
	} catch {
		return { pairs: [], problem: 'yaml' };
	}
	if (data === null || data === undefined) return { pairs: [] };
	if (!Array.isArray(data)) return { pairs: [], problem: 'not-a-list' };
	return { pairs: data.map(asPair).filter((p): p is [string, string] => !!p) };
}

/** The pairs of vocab/distinct.yaml, as they read: well-formed lines only. */
export function parseDistinct(text: string): [string, string][] {
	return readDistinct(text).pairs;
}

/** The settled pairs, as `pairKey`s. */
export function dismissedPairs(ctx: VaultContext): Set<string> {
	return new Set(parseDistinct(readVaultFile(ctx, DISTINCT_FILE).text).map(([a, b]) => pairKey(a, b)));
}

export interface CloseRecipe {
	slug: string;
	title: string;
	family: string | null;
	/** The file's hash, for "En faire deux versions" (the W608 pair offer). */
	hash: string;
	/** Weighted Jaccard, 0–1. */
	score: number;
	/** The two methods are the same text: flagged even below the threshold. */
	method?: true;
}

/** At most this many other recipes named by one W505. */
const MAX_CLOSE = 3;

/**
 * The vault recipes whose ingredients are close to `recipe` (not saved yet),
 * pairs already settled left out. `own`: the slug it will be saved under (an
 * edit, a paste over itself): never paired with itself. `exclude`: a recipe
 * left out without taking its settled pairs (a paste whose slug is taken,
 * which may yet be saved under another slug). `body`: its Markdown body, for
 * the second signal (the same method).
 */
export function closeRecipes(
	ctx: VaultContext,
	recipe: Pick<Recipe, 'ingredients' | 'lang' | 'family'>,
	own?: string,
	opts: { exclude?: string; body?: string } = {}
): CloseRecipe[] {
	const found = pairsFor(ctx.db, () => loadVocab(ctx.paths.vocab), recipe, { own, dismissed: dismissedPairs(ctx), body: opts.body })
		.filter((f) => f.slug !== opts.exclude)
		.slice(0, MAX_CLOSE);
	if (!found.length) return [];
	const hash = ctx.db.prepare('SELECT file_hash FROM recipes WHERE slug = ?').pluck();
	return found.map((f) => ({ ...f, hash: (hash.get(f.slug) as string | undefined) ?? '' }));
}

/** An earlier file of the same batch (a paste, `vault add`) with nearly the same ingredients: not saved yet, so named by its place. */
export interface BatchClose {
	/** Its index in the batch, 0-based. */
	index: number;
	/** How the batch names it (`recipe 1`, a path for `vault add`). */
	name: string;
	/** Weighted Jaccard, 0–1. */
	score: number;
	method?: true;
}

/**
 * W505 inside one batch: for each file, the earlier files of the batch with
 * nearly the same ingredients (the second copy names the first, which is not
 * saved yet). `recipes[i]` null for a file with no recipe; `slugs` the slug
 * each is saved under, for the settled pairs.
 */
export function batchCloseRecipes(
	ctx: VaultContext,
	recipes: (Pick<Recipe, 'ingredients' | 'lang' | 'family'> | null | undefined)[],
	slugs: (string | undefined)[],
	names: string[] = recipes.map((_, i) => `recipe ${i + 1}`),
	bodies?: (string | undefined)[]
): BatchClose[][] {
	if (recipes.filter(Boolean).length < 2) return recipes.map(() => []);
	return batchPairsFor(ctx.db, () => loadVocab(ctx.paths.vocab), recipes, { slugs, dismissed: dismissedPairs(ctx), bodies }).map((list) =>
		list.slice(0, MAX_CLOSE).map((x) => ({ ...x, name: names[x.index] }))
	);
}

const pct = (x: number) => `${Math.round(100 * x)} %`;

/**
 * W505 (`app`): computed with the vault in the server check, the form's check
 * and the save result; never the fix-request block. `batch`: earlier files of
 * the same paste, named by their place (not saved yet).
 */
export function duplicateWarnings(close: CloseRecipe[], batch: BatchClose[] = []): Diagnostic[] {
	if (!close.length && !batch.length) return [];
	// The method named where it is why the pair is flagged (below the ingredients' threshold).
	const share = (x: { score: number; method?: true }) => `${pct(x.score)} in common, weighted${x.method && x.score < DUPLICATE_THRESHOLD ? '; the same method' : ''}`;
	const named = [...close.map((c) => `${c.slug} (${share(c)})`), ...batch.map((b) => `${b.name} of this batch (${share(b)})`)];
	return [
		{
			code: 'W505',
			severity: 'warning',
			path: 'ingredients',
			message: `nearly the same ingredients as ${named.join(', ')} — possible duplicate.`,
			fix: 'The same card: do not save it twice. Versions of one dish: make both members of a family. Different recipes: settle the pair on /doublons.'
		}
	];
}

// ---------------------------------------------------------------- the pair list

export class DuplicateError extends Error {}

/** One recipe of a pair, as the list shows it. */
export interface PairSide {
	slug: string;
	title: string;
	family: string | null;
	familyLabel: string | null;
	/** The variant as read (markers stripped), for display. */
	variant: string | null;
	/** The variant as written in the file (markers kept), for the "Deux versions" prefill. */
	variantText: string | null;
	status: string | null;
	/** Author, book or site, as one short line ('' when none). */
	source: string;
	/** Who it is from, as written ('' when not said): what « Ce qui distingue » starts with. */
	author: string;
	sourceType: string | null;
	/**
	 * Where it is from, as a list line says it (render/provenance.ts: « de
	 * Tante Aline », « Tiré du Tablier bleu, p. 12 », « Magazine »), with a
	 * year the source's note gives (« carte, 1998 »): what tells two fiches of
	 * one title apart on a card. '' when the file says nothing.
	 */
	from: string;
	/** The fields the variant's label is read from (lib/form/family.ts variantShown, variantPrefill). */
	origin: { author: string | null; source_type: string | null; source_title: string | null; title: string };
	hash: string;
	/** The recipes that use this one as a sub-recipe: it cannot go to the trash while any does. */
	usedBy: { slug: string; title: string }[];
}

export interface PairView {
	a: PairSide;
	b: PairSide;
	/** Weighted Jaccard, 0–1. */
	score: number;
	shared: string[];
	onlyA: string[];
	onlyB: string[];
	/** The titles too: `same` (W608), `near` (W503), or null. */
	titles: 'same' | 'near' | null;
	/** The two methods are the same text (the second signal, issue #13). */
	method: boolean;
}

/** Pairs per page. */
export const PAIRS_PAGE = 20;

/** Number of unsettled cards (pairs linked into one card count once): « Plus »'s « Doublons — N à décider ». */
export function duplicateCount(ctx: VaultContext): number {
	return duplicateGroups(ctx).length;
}

interface SideRow {
	slug: string;
	title: string;
	family: string | null;
	variant: string | null;
	status: string | null;
	source_type: string | null;
	author: string | null;
	source_title: string | null;
	source_url: string | null;
	source_page: string | null;
	note: string | null;
	file_hash: string;
}

/** A year a source's note gives (« fiche de 1998 » → 1998), else null. */
export function noteYear(note: string | null | undefined): string | null {
	return /\b(1[89]\d\d|20\d\d)\b/.exec(note ?? '')?.[1] ?? null;
}

const hostOf = (url: string) => {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
};

const withYear = (line: string, year: string | null) => (!year || line.includes(year) ? line : line ? `${line}, ${year}` : year);

/** Reads one recipe of a card or a pair, as the page shows it. */
export function sideReader(ctx: VaultContext): (slug: string) => PairSide {
	const labels = loadVocab(ctx.paths.vocab).families;
	// A family with no label: its name as its recipes write it (« Sucre à la crème »), never the slug's words.
	const names = familyNames(ctx.db);
	const row = ctx.db.prepare(
		`SELECT slug, title, family, variant, status, source_type, author, source_title, source_url, source_page, json_extract(data_json, '$.source.note') AS note, file_hash FROM recipes WHERE slug = ?`
	);
	return (slug) => {
		const r = row.get(slug) as SideRow;
		return {
			slug,
			title: stripMarkers(r.title),
			family: r.family,
			familyLabel: r.family ? (labels.get(r.family)?.fr ?? names[r.family] ?? null) : null,
			variant: r.variant ? stripMarkers(r.variant) : null,
			variantText: r.variant,
			status: r.status,
			source: [r.author, r.source_title, r.source_url && hostOf(r.source_url)].filter(Boolean).map((x) => stripMarkers(x!)).join(', '),
			sourceType: r.source_type,
			author: r.author ? stripMarkers(r.author).trim() : '',
			from: withYear(provenanceLine({ ...r, variant: null }), noteYear(r.note)),
			origin: { author: r.author, source_type: r.source_type, source_title: r.source_title, title: stripMarkers(r.title) },
			hash: r.file_hash,
			usedBy: usedBy(ctx.db, slug).map((u) => ({ slug: u.slug, title: stripMarkers(u.title) }))
		};
	};
}

/** The unsettled pairs, most similar first, `PAIRS_PAGE` from `page` (1-based). */
export function duplicatePage(ctx: VaultContext, page = 1): { pairs: PairView[]; total: number; page: number; pages: number; distinctHash: string } {
	const distinct = readVaultFile(ctx, DISTINCT_FILE);
	const dismissed = new Set(parseDistinct(distinct.text).map(([a, b]) => pairKey(a, b)));
	const all = allPairs(ctx.db, dismissed);
	const pages = Math.max(1, Math.ceil(all.length / PAIRS_PAGE));
	const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
	const slice = all.slice((p - 1) * PAIRS_PAGE, p * PAIRS_PAGE);
	const m = duplicateModel(ctx.db);
	const side = sideReader(ctx);
	const pairs = slice.map((x): PairView => {
		const d = pairDetail(m, x);
		const [a, b] = [side(x.a), side(x.b)];
		const [ta, tb] = [normTitle(a.title), normTitle(b.title)];
		return {
			a,
			b,
			score: x.score,
			shared: d.shared,
			onlyA: d.onlyA,
			onlyB: d.onlyB,
			titles: ta === tb ? 'same' : withinDistance(ta, tb, 2) ? 'near' : null,
			method: !!x.method
		};
	});
	return { pairs, total: all.length, page: p, pages, distinctHash: distinct.hash };
}

// ---------------------------------------------------------------- the cards

/**
 * The pairs as /doublons shows them: one card per set of recipes linked by
 * pairs (three cards of one dish are one card, « 3 fiches semblables », not
 * three pairs), most similar first. `pairs`: the card's listed pairs, the
 * decisions act on them; `score`: its closest pair.
 */
export interface DuplicateGroup {
	/** The card's key: its slugs, sorted, joined by a space. */
	key: string;
	slugs: string[];
	pairs: SimPair[];
	score: number;
}

/** A card at or above this score reads « très semblables » in the page's head; a pair this close joins a card whatever its titles. */
export const VERY_CLOSE = 0.9;

/**
 * A title's head: its first word that says something, folded, a plural's
 * final s or x off (« Pouding chômeur à l'érable » → `pouding`,
 * « Grands-pères » → `grand`, « Muffins » → `muffin`). '' for a title of
 * little words only.
 */
export function titleHead(title: string): string {
	const w = normTitle(title).split(/[^\p{L}\p{N}]+/u).find((x) => x && !STOP_WORDS.has(x)) ?? '';
	return w.length > 3 ? w.replace(/[sx]$/, '') : w;
}

/**
 * Whether a pair joins the others of its recipes on one card: the same head
 * word in both titles (two « Pouding chômeur »), or nearly the same
 * ingredients (VERY_CLOSE: « Poor Man's Pudding » and « Pouding chômeur »).
 * Otherwise the pair is a card of its own (usability round 2: « Grands-pères »
 * and « Pouding chômeur », linked by one 68 % pair, made an 11-fiche card).
 */
export function joinsCard(score: number, a: string, b: string): boolean {
	if (score >= VERY_CLOSE) return true;
	const h = titleHead(a);
	return !!h && h === titleHead(b);
}

/**
 * The cards over `pairs`, closest first (then by key). Without `titleOf`,
 * one card per connected set. With it, the sets are linked only by pairs
 * that join a card (`joinsCard`); the pairs between two sets that stay apart
 * make one card of two of their own: the closest such pair's recipes, and
 * all those pairs to settle (« Recettes différentes » says the two dishes
 * differ).
 */
export function groupPairs(pairs: readonly SimPair[], titleOf?: (slug: string) => string): DuplicateGroup[] {
	const parent = new Map<string, string>();
	const find = (x: string): string => {
		let r = parent.get(x) ?? x;
		while (r !== (parent.get(r) ?? r)) r = parent.get(r)!;
		parent.set(x, r);
		return r;
	};
	const links = (p: SimPair) => !titleOf || joinsCard(p.score, titleOf(p.a), titleOf(p.b));
	for (const p of pairs) {
		if (!links(p)) continue;
		const [ra, rb] = [find(p.a), find(p.b)];
		if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
	}
	const byRoot = new Map<string, SimPair[]>();
	for (const p of pairs) {
		const [ra, rb] = [find(p.a), find(p.b)];
		// Two sets the pair bridges stay apart: their pairs make a card of their own.
		const r = ra === rb ? ra : `${ra < rb ? ra : rb}\u0000${ra < rb ? rb : ra}`;
		byRoot.set(r, [...(byRoot.get(r) ?? []), p]);
	}
	return [...byRoot.entries()]
		.map(([r, ps]) => {
			const sorted = [...ps].sort((x, y) => y.score - x.score || pairKey(x.a, x.b).localeCompare(pairKey(y.a, y.b)));
			const slugs = r.includes('\u0000') ? [sorted[0].a, sorted[0].b].sort() : [...new Set(ps.flatMap((p) => [p.a, p.b]))].sort();
			return { key: slugs.join(' '), slugs, pairs: sorted, score: sorted[0].score };
		})
		.sort((x, y) => y.score - x.score || y.slugs.length - x.slugs.length || x.key.localeCompare(y.key));
}

/**
 * Under this score, a card whose titles and methods all differ reads « peu
 * semblable »: one « Toutes différentes » settles every such card at once
 * (usability round 3; docs/DATA-FLOW.md, "/doublons"). Two fiches of one dish
 * share a title's head word, the method or are one dish translated, so those
 * are never in the batch.
 */
export const LOW_CLOSE = 0.8;

/**
 * At or above this ingredient score, a recipe with another title is offered as
 * a variant of the same dish in /ajouter's « Une autre variante du même plat ? »
 * (usability round 5: a blueberry pouding was offered three muffin recipes at
 * 67 %). Under it, only when the titles say the same dish (`titlesAlike`) or
 * the method is the same text. W505 and /doublons keep DUPLICATE_THRESHOLD:
 * a possible duplicate is worth a look, not worth a pre-filled answer.
 */
export const VARIANT_CLOSE = 0.75;

/** Whether two titles say the same dish: the same, nearly (W503's two edits), or the same head word. */
export function titlesAlike(a: string, b: string): boolean {
	const [x, y] = [normTitle(a), normTitle(b)];
	const h = titleHead(a);
	return x === y || withinDistance(x, y, 2) || (!!h && h === titleHead(b));
}

/**
 * The cards little alike (LOW_CLOSE): every pair under it, with other titles,
 * another method, and both recipes in one language — a pair across languages
 * is often one dish translated (« Apple Pie », « Tarte aux pommes »), so it
 * stays for her to look at.
 */
export function lowGroups(ctx: VaultContext, groups: readonly DuplicateGroup[]): DuplicateGroup[] {
	const titleOf = titleReader(ctx);
	const lang = ctx.db.prepare('SELECT lang FROM recipes WHERE slug = ?').pluck();
	return groups.filter((g) =>
		g.pairs.every((p) => p.score < LOW_CLOSE && !p.method && lang.get(p.a) === lang.get(p.b) && !titlesAlike(titleOf(p.a), titleOf(p.b)))
	);
}

/** How a slug's title reads, for `groupPairs`. */
function titleReader(ctx: VaultContext): (slug: string) => string {
	const row = ctx.db.prepare('SELECT title FROM recipes WHERE slug = ?').pluck();
	return (slug) => stripMarkers((row.get(slug) as string | undefined) ?? '');
}

/** The unsettled cards. */
export function duplicateGroups(ctx: VaultContext): DuplicateGroup[] {
	return groupPairs(allPairs(ctx.db, dismissedPairs(ctx)), titleReader(ctx));
}

/**
 * The index's highest recipe row id: what « Plus » remembers on a device to
 * tell a new card from one already there (a recipe saved later gets a higher
 * id; an edit keeps its id). 0 for an empty vault.
 */
export function recipeMark(ctx: VaultContext): number {
	return (ctx.db.prepare('SELECT coalesce(max(id), 0) FROM recipes').pluck().get() as number) ?? 0;
}

/** The cards holding a recipe saved after `mark` (recipeMark): new, until decided. */
export function freshGroups(ctx: VaultContext, groups: DuplicateGroup[], mark: number): DuplicateGroup[] {
	const id = ctx.db.prepare('SELECT id FROM recipes WHERE slug = ?').pluck();
	return groups.filter((g) => g.slugs.some((s) => ((id.get(s) as number | undefined) ?? 0) > mark));
}

/**
 * How like `slug` each other recipe is, 0–1, for « Grouper avec… »
 * (/familles?grouper=; usability round 4): the better of its title and its
 * ingredients. A title scores as the form's « Ressemble à » reads it
 * (formsave.ts titleMatches): the same 1, two edits off 0.95, one holding the
 * other whole from its start 0.9, the same head word (`titleHead`) 0.7; the
 * ingredients their weighted Jaccard, as on /doublons. Below 0.2: left out.
 */
export function groupingScores(ctx: VaultContext, slug: string): Map<string, number> {
	const out = new Map<string, number>();
	const m = duplicateModel(ctx.db);
	const rows = ctx.db.prepare('SELECT slug, title FROM recipes').all() as { slug: string; title: string }[];
	const own = rows.find((r) => r.slug === slug);
	if (!own) return out;
	const t0 = normTitle(stripMarkers(own.title));
	const h0 = titleHead(stripMarkers(own.title));
	const me = m.recipes.get(slug);
	const weight = (e: string) => weightOf(m.weights, m.recipes.size, e);
	// One title is the other's start, a whole word or more after it (formsave.ts titleMatches).
	const starts = (long: string, short: string) => short.length >= 4 && short.includes(' ') && long.startsWith(short + ' ');
	for (const r of rows) {
		if (r.slug === slug) continue;
		const u = normTitle(stripMarkers(r.title));
		const title = !t0 || !u ? 0 : u === t0 ? 1 : withinDistance(t0, u, 2) ? 0.95 : starts(t0, u) || starts(u, t0) ? 0.9 : h0 && h0 === titleHead(stripMarkers(r.title)) ? 0.7 : 0;
		const other = m.recipes.get(r.slug);
		const ingredients = me && other && me.elements.length && other.elements.length ? weightedJaccard(me.elements, other.elements, weight) : 0;
		const score = Math.max(title, ingredients);
		if (score >= 0.2) out.set(r.slug, Math.round(score * 100) / 100);
	}
	return out;
}

/** One card as the page shows it. */
export interface GroupView {
	key: string;
	/** The closest first: the closest pair, then each by its closest pair with those before it. */
	members: PairSide[];
	/** The ones shown at first (2 or 3, the closest); the others wait behind « + N autres fiches ». */
	core: string[];
	pairs: { a: string; b: string; score: number; titles: 'same' | 'near' | null; method: boolean }[];
	score: number;
	/** Elements every member has, as labels. */
	common: string[];
	/** Per member: its elements no other member of the card has. */
	only: Record<string, string[]>;
	/** Per member: all its elements, as labels (what the card compares among the recipes in view). */
	elements: Record<string, string[]>;
	/** Holds a recipe saved after the device's mark (see freshGroups). */
	fresh: boolean;
}

/** Cards per page (a phone shows 5, then « Voir les 5 suivantes »). */
export const GROUPS_PAGE = 10;

/** Recipes a card shows at first. */
export const CORE_SIZE = 3;

/** A card's slugs, the closest first: the closest pair, then each by its closest pair with those placed before it. */
function closestFirst(g: DuplicateGroup): string[] {
	const order = [g.pairs[0].a, g.pairs[0].b];
	const rest = new Set(g.slugs.filter((s) => !order.includes(s)));
	while (rest.size) {
		let best: [string, number] = ['', -1];
		for (const p of g.pairs) {
			const s = order.includes(p.a) && rest.has(p.b) ? p.b : order.includes(p.b) && rest.has(p.a) ? p.a : '';
			if (s && (p.score > best[1] || (p.score === best[1] && s < best[0]))) best = [s, p.score];
		}
		if (!best[0]) best = [[...rest].sort()[0], 0];
		order.push(best[0]);
		rest.delete(best[0]);
	}
	return order;
}

/**
 * The cards, most similar first, `GROUPS_PAGE` from `page` (1-based), with
 * the head's figures: how many cards, how many very close. `mark`: the
 * device's recipeMark, to flag the new cards (none flagged without it).
 */
export function duplicateGroupPage(
	ctx: VaultContext,
	page = 1,
	mark?: number
): { groups: GroupView[]; total: number; veryClose: number; fresh: number; low: { key: string; titles: string[] }[]; page: number; pages: number; distinctHash: string } {
	const distinct = readVaultFile(ctx, DISTINCT_FILE);
	const dismissed = new Set(parseDistinct(distinct.text).map(([a, b]) => pairKey(a, b)));
	const titleOf = titleReader(ctx);
	const scored = groupPairs(allPairs(ctx.db, dismissed), titleOf);
	const freshKeys = new Set(mark === undefined ? [] : freshGroups(ctx, scored, mark).map((g) => g.key));
	// The new cards first (usability round 4: « 1 nouveau » in the head pointed at a card on page 5), then the closest.
	const all = freshKeys.size ? [...scored.filter((g) => freshKeys.has(g.key)), ...scored.filter((g) => !freshKeys.has(g.key))] : scored;
	const pages = Math.max(1, Math.ceil(all.length / GROUPS_PAGE));
	const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
	const m = duplicateModel(ctx.db);
	const side = sideReader(ctx);
	const labelsOf = (slug: string) => new Set(pairDetail(m, { a: slug, b: slug, score: 1 }).shared);
	const groups = all.slice((p - 1) * GROUPS_PAGE, p * GROUPS_PAGE).map((g): GroupView => {
		const order = closestFirst(g);
		const members = order.map(side);
		const sets = new Map(g.slugs.map((s) => [s, labelsOf(s)]));
		const common = [...sets.get(g.slugs[0])!].filter((e) => g.slugs.every((s) => sets.get(s)!.has(e))).sort((u, v) => u.localeCompare(v, 'fr'));
		const only = Object.fromEntries(
			g.slugs.map((s) => [s, [...sets.get(s)!].filter((e) => g.slugs.every((o) => o === s || !sets.get(o)!.has(e))).sort((u, v) => u.localeCompare(v, 'fr'))])
		);
		const title = (slug: string) => normTitle(titleOf(slug));
		return {
			key: g.key,
			members,
			pairs: g.pairs.map((x) => {
				const [ta, tb] = [title(x.a), title(x.b)];
				return { a: x.a, b: x.b, score: x.score, titles: ta === tb ? 'same' : withinDistance(ta, tb, 2) ? 'near' : null, method: !!x.method };
			}),
			score: g.score,
			core: order.slice(0, CORE_SIZE),
			common,
			only,
			elements: Object.fromEntries(g.slugs.map((s) => [s, [...sets.get(s)!].sort((u, v) => u.localeCompare(v, 'fr'))])),
			fresh: freshKeys.has(g.key)
		};
	});
	return {
		groups,
		total: all.length,
		veryClose: all.filter((g) => g.score >= VERY_CLOSE).length,
		fresh: freshKeys.size,
		low: lowGroups(ctx, all).map((g) => ({ key: g.key, titles: g.slugs.map(titleOf) })),
		page: p,
		pages,
		distinctHash: distinct.hash
	};
}

// ---------------------------------------------------------------- "Recettes différentes"

const HEADER = `# Pairs of recipes settled as different recipes on /doublons (docs/VOCAB.md,
# "Distinct recipes"): never listed as possible duplicates again. One pair per
# line, the two slugs sorted, the lines sorted.
`;

const PAIR_LINE = /^- \[.*\]\s*$/;

/** A pair line that reads as a pair (those are rewritten); any other line is kept as written. */
function isPairLine(l: string): boolean {
	if (!PAIR_LINE.test(l)) return false;
	try {
		const data = parse(l, { version: '1.2' });
		return Array.isArray(data) && data.length === 1 && !!asPair(data[0]);
	} catch {
		return false;
	}
}

/** A slug as a flow scalar: plain when YAML reads it back as that string, else double-quoted (`1905`, `null`, `1e5`). */
function scalar(slug: string): string {
	let back: unknown;
	try {
		back = parse(`[${slug}]`, { version: '1.2' });
	} catch {
		back = null;
	}
	return Array.isArray(back) && back.length === 1 && back[0] === slug ? slug : JSON.stringify(slug);
}

/**
 * `text` with the pair lines replaced by `pairs`, sorted; comments and
 * anything else kept above them — a line that looks like a pair but does not
 * read as one (`- [1905, gateau]` written by hand) is kept as written.
 */
function withPairs(text: string, pairs: [string, string][]): string {
	const keep = text
		.split('\n')
		.filter((l) => !isPairLine(l))
		.join('\n')
		.replace(/\n+$/, '');
	const uniq = [...new Map(pairs.map(([a, b]) => [pairKey(a, b), (a < b ? [a, b] : [b, a]) as [string, string]])).values()].sort((x, y) =>
		x[0] === y[0] ? (x[1] < y[1] ? -1 : 1) : x[0] < y[0] ? -1 : 1
	);
	const head = keep ? keep + '\n' : HEADER;
	return head + uniq.map(([a, b]) => `- [${scalar(a)}, ${scalar(b)}]\n`).join('');
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The file as it will be written, checked: it must read back as exactly `pairs`. */
function distinctText(cur: string, pairs: [string, string][]): string {
	const { problem } = readDistinct(cur);
	if (problem === 'yaml') throw new DuplicateError(t.error.yaml(DISTINCT_FILE));
	if (problem === 'not-a-list') throw new DuplicateError(t.duplicates.refused.notPairs(DISTINCT_FILE));
	const next = withPairs(cur, pairs);
	const back = parseDistinct(next).map(([a, b]) => pairKey(a, b));
	const want = new Set(pairs.map(([a, b]) => pairKey(a, b)));
	if (back.length !== want.size || back.some((k) => !want.has(k))) throw new DuplicateError(t.duplicates.refused.edit(DISTINCT_FILE));
	return next;
}

async function commitDistinct(ctx: VaultContext, text: string | null, message: string): Promise<string | undefined> {
	let commit: string | undefined;
	try {
		commit = await writeAndCommit(ctx, [{ rel: DISTINCT_FILE, text }], message);
	} catch (e) {
		if (!(e instanceof FileWriteError)) throw e;
		throw new DuplicateError(
			e.stage === 'write' ? t.error.write(e.message) : t.duplicates.refused.commit(e.message)
		);
	}
	committed(ctx);
	return commit;
}

const sorted = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);
const pairsMessage = (verb: string, pairs: [string, string][]) =>
	pairs.length === 1 ? `${verb}${pairs[0][0]} ≠ ${pairs[0][1]}` : `${verb}${pairs.length} pairs\n\n${pairs.map(([a, b]) => `${a} ≠ ${b}`).join('\n')}`;

/**
 * "Recettes différentes": the pair written to vocab/distinct.yaml, one commit
 * `duplicate: <a> ≠ <b>`. `expectedHash`: the file's hash when the page was
 * read ('' for no file).
 */
export function dismissPair(ctx: VaultContext, x: string, y: string, expectedHash: string): Promise<{ commit?: string }> {
	return dismissPairs(ctx, [[x, y]], expectedHash);
}

/**
 * "Recettes différentes" for a card: every pair named written to
 * vocab/distinct.yaml in one commit (`duplicate: <a> ≠ <b>` for one pair,
 * `duplicate: <n> pairs` and the list for more). Pairs already there are
 * skipped; none left: nothing written.
 */
export function dismissPairs(ctx: VaultContext, list: [string, string][], expectedHash: string): Promise<{ commit?: string }> {
	return ctx.lock.run(async () => {
		if (!list.length || list.some(([x, y]) => !SLUG_RE.test(x) || !SLUG_RE.test(y) || x === y)) throw new DuplicateError(t.duplicates.refused.pair);
		const cur = readVaultFile(ctx, DISTINCT_FILE);
		if (cur.hash !== expectedHash) throw new DuplicateError(t.duplicates.refused.changed);
		const pairs = parseDistinct(cur.text);
		const have = new Set(pairs.map(([a, b]) => pairKey(a, b)));
		const add = [...new Map(list.map(([x, y]) => [pairKey(x, y), sorted(x, y)])).entries()].filter(([k]) => !have.has(k)).map(([, p]) => p);
		if (!add.length) return {};
		const text = distinctText(cur.text, [...pairs, ...add]);
		return { commit: await commitDistinct(ctx, text, pairsMessage('duplicate: ', add)) };
	});
}

/** "Annuler" after "Recettes différentes": the pair's line taken out, one commit `undo: duplicate <a> ≠ <b>`. */
export function undismissPair(ctx: VaultContext, x: string, y: string): Promise<{ commit?: string }> {
	return undismissPairs(ctx, [[x, y]]);
}

/** "Annuler" after "Recettes différentes" on a card: its pairs' lines taken out, one commit; a file left with only its header is removed. */
export function undismissPairs(ctx: VaultContext, list: [string, string][]): Promise<{ commit?: string }> {
	return ctx.lock.run(async () => {
		const drop = new Set(list.map(([x, y]) => pairKey(x, y)));
		const cur = readVaultFile(ctx, DISTINCT_FILE);
		const pairs = parseDistinct(cur.text);
		const left = pairs.filter(([a, b]) => !drop.has(pairKey(a, b)));
		if (left.length === pairs.length) return {};
		const gone = pairs.filter(([a, b]) => drop.has(pairKey(a, b)));
		// The last pair out and nothing but the app's own header left: the file goes, as before the first « Recettes différentes ».
		const next = distinctText(cur.text, left);
		const text = !left.length && next === HEADER ? null : next;
		return { commit: await commitDistinct(ctx, text, pairsMessage('undo: duplicate ', gone)) };
	});
}

// ---------------------------------------------------------------- "Deux versions"

export interface VersionsRequest {
	a: { slug: string; hash: string; variant: string };
	b: { slug: string; hash: string; variant: string };
	/** The family slug (slugified here). */
	family: string;
	/** The family's French label, written only where the family has none. */
	label?: string;
}

/**
 * "Deux versions de la même recette": both recipes members of `family`, each
 * with its variant, one commit editing both (and the family's label when it
 * has none). Refused when either file changed since the page was read.
 */
export function pairVersions(ctx: VaultContext, req: VersionsRequest, opts: { today?: string } = {}): Promise<{ commit?: string; family: string; edited: string[] }> {
	return groupVersions(ctx, { members: [req.a, req.b], family: req.family, label: req.label }, opts);
}

export interface GroupVersionsRequest {
	/** Two or more recipes, each with what sets it apart. */
	members: { slug: string; hash: string; variant: string }[];
	/** The family slug (slugified here); empty: the slug of `label`. */
	family: string;
	/** The family's French label, written only where the family has none. */
	label?: string;
}

/**
 * "Variantes d'un même plat" for a card of several recipes (the pair being
 * the two-recipe case): all of them members of one family, each with its
 * variant, one commit editing them all (and the family's label when it has
 * none). Refused when any file changed since the page was read.
 */
export function groupVersions(ctx: VaultContext, req: GroupVersionsRequest, opts: { today?: string } = {}): Promise<{ commit?: string; family: string; edited: string[] }> {
	return ctx.lock.run(async () => {
		const family = slugify(req.family || req.label || '');
		if (!family || !SLUG_RE.test(family)) throw new DuplicateError(t.duplicates.refused.family);
		if (req.members.length < 2 || new Set(req.members.map((m) => m.slug)).size !== req.members.length) throw new DuplicateError(t.duplicates.refused.pair);
		// Written as she typed it, markers kept (`de matante [?: Rita]`); compared as read.
		const typed = req.members.map((m) => m.variant.trim());
		const read = typed.map((x) => stripMarkers(x).trim());
		if (read.some((x) => !x)) throw new DuplicateError(t.duplicates.refused.variants);
		if (new Set(read.map((x) => x.toLocaleLowerCase('fr'))).size !== read.length) throw new DuplicateError(t.duplicates.refused.sameVariant);
		const files: FileWrite[] = [];
		const label = cleanLabel(req.label ?? '');
		if (label.length > LABEL_MAX) throw new DuplicateError(t.error.labelTooLong(LABEL_MAX));
		if (label && !loadVocab(ctx.paths.vocab).families.get(family)?.fr) {
			try {
				const fam = familiesFile(ctx);
				const next = withLabel(fam.text, family, label);
				if (next !== fam.text) files.push({ rel: FAMILIES_FILE, text: next });
			} catch (e) {
				if (e instanceof FamilyLabelError) throw new DuplicateError(e.message);
				throw e;
			}
		}
		// The same variant as read as the file's: the file's own text stays, markers and all.
		const set = (variant: string) => (r: Recipe): Recipe => ({
			...r,
			family,
			variant: r.variant && stripMarkers(r.variant).trim() === stripMarkers(variant).trim() ? r.variant : variant
		});
		try {
			const r = await editRecipesLocked(
				ctx,
				req.members.map((m, i) => ({ slug: m.slug, hash: m.hash, change: set(typed[i]) })),
				{ today: opts.today, files }
			);
			return { commit: r.commit, family, edited: r.slugs ?? [] };
		} catch (e) {
			if (e instanceof EditError) throw new DuplicateError(e.message);
			// A failed write or commit: the save path's English reason, after her sentence (as the other refusals).
			if (e instanceof SaveError) throw new DuplicateError(t.duplicates.refused.versions(e.message));
			throw e;
		}
	});
}

/**
 * « Ajouter une recette à ce groupe » (/famille/<slug>) and « Grouper avec… »
 * an existing group (/familles?grouper=): one recipe joins a family that has
 * recipes, with its variant, one commit `edit: <title>`. Refused when the file
 * changed since the page was read, when the variant is empty, or when another
 * member already has that variant.
 */
export function joinFamily(ctx: VaultContext, req: { slug: string; hash: string; variant: string; family: string }, opts: { today?: string } = {}): Promise<{ commit?: string }> {
	return ctx.lock.run(async () => {
		if (!SLUG_RE.test(req.family) || !SLUG_RE.test(req.slug)) throw new DuplicateError(t.duplicates.refused.family);
		const others = ctx.db.prepare('SELECT slug, variant FROM recipes WHERE family = ?').all(req.family) as { slug: string; variant: string | null }[];
		if (!others.length) throw new DuplicateError(t.duplicates.refused.family);
		const variant = req.variant.trim();
		const read = stripMarkers(variant).trim().toLocaleLowerCase('fr');
		if (!read) throw new DuplicateError(t.duplicates.refused.variant);
		if (others.some((o) => o.slug !== req.slug && o.variant && stripMarkers(o.variant).trim().toLocaleLowerCase('fr') === read)) throw new DuplicateError(t.duplicates.refused.variantTaken);
		try {
			const r = await editRecipesLocked(ctx, [{ slug: req.slug, hash: req.hash, change: (x) => ({ ...x, family: req.family, variant }) }], { today: opts.today });
			return { commit: r.commit };
		} catch (e) {
			if (e instanceof EditError) throw new DuplicateError(e.message);
			if (e instanceof SaveError) throw new DuplicateError(t.duplicates.refused.versions(e.message));
			throw e;
		}
	});
}

// ---------------------------------------------------------------- "C'est la même recette"

/**
 * "C'est la même recette": the one she picked to the trash (`delete:`),
 * undoable. Refused while another recipe uses it as a sub-recipe: that line
 * would point at nothing (keep that one instead, or change those recipes first).
 */
export async function sameRecipe(ctx: VaultContext, drop: string, hash: string): Promise<{ commit?: string }> {
	const users = usedBy(ctx.db, drop).filter((u) => u.slug !== drop);
	if (users.length) throw new DuplicateError(t.duplicates.refused.used(users.map((u) => stripMarkers(u.title))));
	try {
		return await remove(ctx, drop, hash);
	} catch (e) {
		if (e instanceof TrashError) throw new DuplicateError(e.reason === 'stale' ? e.message : e.reason === 'gone' ? t.error.recipeGone : t.duplicates.refused.trash);
		throw e;
	}
}

/**
 * "C'est la même fiche" on a card: the ones she ticked to the trash, one
 * `delete:` commit each (the trash's own writer), `keep` staying. Every one is
 * checked first (none used as a sub-recipe, `keep` not among them), so a
 * refusal sends nothing to the trash; a failure halfway leaves the ones
 * already trashed there, each undoable. Returns each commit for "Annuler".
 */
export async function sameRecipes(ctx: VaultContext, keep: string, drop: { slug: string; hash: string }[]): Promise<{ trashed: { slug: string; commit: string }[] }> {
	if (!drop.length) throw new DuplicateError(t.duplicates.pickDrop);
	if (drop.some((d) => d.slug === keep) || new Set(drop.map((d) => d.slug)).size !== drop.length) throw new DuplicateError(t.duplicates.refused.pair);
	for (const d of drop) {
		const users = usedBy(ctx.db, d.slug).filter((u) => u.slug !== d.slug);
		if (users.length) throw new DuplicateError(t.duplicates.refused.used(users.map((u) => stripMarkers(u.title))));
	}
	const trashed: { slug: string; commit: string }[] = [];
	for (const d of drop) {
		const r = await sameRecipe(ctx, d.slug, d.hash);
		if (r.commit) trashed.push({ slug: d.slug, commit: r.commit });
	}
	return { trashed };
}
