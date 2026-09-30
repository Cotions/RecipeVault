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
import { DUPLICATE_THRESHOLD } from '../ingredients/similar';
import { slugify } from '../vault/slug';
import { stripMarkers } from '../vault/markers';
import { normTitle } from '../vault/rules/batch';
import { withinDistance } from '../vault/normalize';
import type { Diagnostic, Recipe } from '../vault/types';
import { committed, type VaultContext } from './context';
import { cleanLabel, FAMILIES_FILE, familiesFile, FamilyLabelError, LABEL_MAX, withLabel } from './families';
import { FileWriteError, readVaultFile, writeAndCommit, type FileWrite } from './files';
import { usedBy } from './index/query';
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
	sourceType: string | null;
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

/** Number of unsettled pairs: the nav's "Doublons (N)". */
export function duplicateCount(ctx: VaultContext): number {
	return allPairs(ctx.db, dismissedPairs(ctx)).length;
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
	file_hash: string;
}

const hostOf = (url: string) => {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
};

/** The unsettled pairs, most similar first, `PAIRS_PAGE` from `page` (1-based). */
export function duplicatePage(ctx: VaultContext, page = 1): { pairs: PairView[]; total: number; page: number; pages: number; distinctHash: string } {
	const distinct = readVaultFile(ctx, DISTINCT_FILE);
	const dismissed = new Set(parseDistinct(distinct.text).map(([a, b]) => pairKey(a, b)));
	const all = allPairs(ctx.db, dismissed);
	const pages = Math.max(1, Math.ceil(all.length / PAIRS_PAGE));
	const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
	const slice = all.slice((p - 1) * PAIRS_PAGE, p * PAIRS_PAGE);
	const m = duplicateModel(ctx.db);
	const labels = loadVocab(ctx.paths.vocab).families;
	const row = ctx.db.prepare('SELECT slug, title, family, variant, status, source_type, author, source_title, source_url, file_hash FROM recipes WHERE slug = ?');
	const side = (slug: string): PairSide => {
		const r = row.get(slug) as SideRow;
		return {
			slug,
			title: stripMarkers(r.title),
			family: r.family,
			familyLabel: r.family ? (labels.get(r.family)?.fr ?? null) : null,
			variant: r.variant ? stripMarkers(r.variant) : null,
			variantText: r.variant,
			status: r.status,
			source: [r.author, r.source_title, r.source_url && hostOf(r.source_url)].filter(Boolean).map((x) => stripMarkers(x!)).join(', '),
			sourceType: r.source_type,
			hash: r.file_hash,
			usedBy: usedBy(ctx.db, slug).map((u) => ({ slug: u.slug, title: stripMarkers(u.title) }))
		};
	};
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
	if (problem === 'yaml') throw new DuplicateError(`${DISTINCT_FILE} ne se lit pas (YAML) ; corrigez-le d’abord.`);
	if (problem === 'not-a-list') throw new DuplicateError(`${DISTINCT_FILE} n’est pas une liste de paires ; corrigez-le d’abord.`);
	const next = withPairs(cur, pairs);
	const back = parseDistinct(next).map(([a, b]) => pairKey(a, b));
	const want = new Set(pairs.map(([a, b]) => pairKey(a, b)));
	if (back.length !== want.size || back.some((k) => !want.has(k))) throw new DuplicateError(`${DISTINCT_FILE} n’a pas pu être modifié sans rien perdre ; corrigez-le à la main.`);
	return next;
}

async function commitDistinct(ctx: VaultContext, text: string, message: string): Promise<string | undefined> {
	let commit: string | undefined;
	try {
		commit = await writeAndCommit(ctx, [{ rel: DISTINCT_FILE, text }], message);
	} catch (e) {
		if (!(e instanceof FileWriteError)) throw e;
		throw new DuplicateError(
			e.stage === 'write' ? `le fichier n’a pas pu être écrit ; rien n’a changé : ${e.message}` : `le choix n’a pas pu être enregistré (git) ; rien n’a changé : ${e.message}`
		);
	}
	committed(ctx);
	return commit;
}

/**
 * "Recettes différentes": the pair written to vocab/distinct.yaml, one commit
 * `duplicate: <a> ≠ <b>`. `expectedHash`: the file's hash when the page was
 * read ('' for no file).
 */
export function dismissPair(ctx: VaultContext, x: string, y: string, expectedHash: string): Promise<{ commit?: string }> {
	return ctx.lock.run(async () => {
		if (!SLUG_RE.test(x) || !SLUG_RE.test(y) || x === y) throw new DuplicateError('paire invalide.');
		const [a, b] = x < y ? [x, y] : [y, x];
		const cur = readVaultFile(ctx, DISTINCT_FILE);
		if (cur.hash !== expectedHash) throw new DuplicateError('la liste a changé depuis l’ouverture de la page ; rechargez-la.');
		const pairs = parseDistinct(cur.text);
		if (pairs.some((p) => p[0] === a && p[1] === b)) return {};
		const text = distinctText(cur.text, [...pairs, [a, b]]);
		return { commit: await commitDistinct(ctx, text, `duplicate: ${a} ≠ ${b}`) };
	});
}

/** "Annuler" after "Recettes différentes": the pair's line taken out, one commit `undo: duplicate <a> ≠ <b>`. */
export function undismissPair(ctx: VaultContext, x: string, y: string): Promise<{ commit?: string }> {
	return ctx.lock.run(async () => {
		const [a, b] = x < y ? [x, y] : [y, x];
		const cur = readVaultFile(ctx, DISTINCT_FILE);
		const pairs = parseDistinct(cur.text);
		const left = pairs.filter((p) => !(p[0] === a && p[1] === b));
		if (left.length === pairs.length) return {};
		const text = distinctText(cur.text, left);
		return { commit: await commitDistinct(ctx, text, `undo: duplicate ${a} ≠ ${b}`) };
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
	return ctx.lock.run(async () => {
		const family = slugify(req.family);
		if (!family || !SLUG_RE.test(family)) throw new DuplicateError('choisissez un nom de famille.');
		// Written as she typed it, markers kept (`de matante [?: Rita]`); compared as read.
		const [va, vb] = [req.a.variant.trim(), req.b.variant.trim()];
		const [ra, rb] = [stripMarkers(va).trim(), stripMarkers(vb).trim()];
		if (!ra || !rb) throw new DuplicateError('nommez chacune des deux versions.');
		if (ra === rb) throw new DuplicateError('donnez deux noms de version différents.');
		if (req.a.slug === req.b.slug) throw new DuplicateError('paire invalide.');
		const files: FileWrite[] = [];
		const label = cleanLabel(req.label ?? '');
		if (label.length > LABEL_MAX) throw new DuplicateError(`le nom est trop long (${LABEL_MAX} caractères au plus).`);
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
				[
					{ slug: req.a.slug, hash: req.a.hash, change: set(va) },
					{ slug: req.b.slug, hash: req.b.hash, change: set(vb) }
				],
				{ today: opts.today, files }
			);
			return { commit: r.commit, family, edited: r.slugs ?? [] };
		} catch (e) {
			if (e instanceof EditError || e instanceof SaveError) throw new DuplicateError(e.message);
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
	if (users.length)
		throw new DuplicateError(
			`cette recette sert de sous-recette dans ${users.map((u) => `« ${stripMarkers(u.title)} »`).join(', ')} ; gardez-la plutôt, ou changez d’abord ces recettes.`
		);
	try {
		return await remove(ctx, drop, hash);
	} catch (e) {
		if (e instanceof TrashError) throw new DuplicateError(e.reason === 'stale' ? e.message : e.reason === 'gone' ? 'cette recette n’existe plus.' : 'la recette n’a pas pu être mise à la corbeille ; rien n’a changé.');
		throw e;
	}
}
