// The one save path (docs/DATA-FLOW.md, "SAVE, in order"): check with the
// vault's entries → refuse on any error → set status/added/updated →
// serialize → write atomically → one git commit → index → push in background.
// Order matters: a failed write or commit is rolled back and indexes nothing;
// a failed index write leaves the file and commit in place for `vault sync`.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { checkBatch, checkFile, hasErrors } from '../vault/check';
import { stripMarkers } from '../vault/markers';
import { normalizeText } from '../vault/normalize';
import { serialize } from '../vault/serialize';
import { SLUG_RE } from '../vault/slug';
import type { Diagnostic, Recipe } from '../vault/types';
import type { VaultEntry } from '../vault/rules/batch';
import { committed, type VaultContext } from './context';
import { FileWriteError, writeAndCommit, type FileWrite } from './files';
import { refreshFamilies, sha256 } from './index/build';
import { toTasteWarnings, unresolvedDiagnostics } from './index/resolve';
import { checkOptions } from './checkopts';
import { closeRecipes, duplicateWarnings } from './duplicates';
import { indexText, isRecipeFile, recipePath } from './index/sync';
import { indexMemo } from './index/memo';
import { loadVocab } from './vocab';

export interface SaveFile {
	/** One recipe file as pasted. */
	text: string;
	/** Save under this slug instead of the file's own (the suffixed slug offered on a collision). */
	slug?: string;
	/** Replace the vault recipe with this slug: the hash of the file the person saw (stale-write guard). */
	overwrite?: string;
	/** W608: make this recipe a member of a family (the existing one is untouched in P1). */
	family?: { family: string; variant: string };
	/** An edit keeps the recipe's status (plan 04, Q14 A: the form): see `statusFor`. */
	keepStatus?: boolean;
}

export type FileResult =
	| { status: 'saved'; slug: string; title: string; recipeStatus: string; created: boolean; diagnostics: Diagnostic[] }
	| { status: 'rejected'; diagnostics: Diagnostic[] }
	| {
			status: 'collision';
			slug: string;
			/** The free suffixed slug to offer. */
			suggested: string;
			/** The recipe already there, absent when the clash is inside the paste or in the trash. */
			existing?: { title: string; hash: string };
			inTrash: boolean;
			diagnostics: Diagnostic[];
	  }
	| { status: 'stale'; slug: string; diagnostics: Diagnostic[] };

export interface SaveResult {
	files: FileResult[];
	commit?: string;
	/** The index write failed after the commit; the file is safe and `vault sync` recovers. */
	indexError?: string;
}

export class SaveError extends Error {}

export interface SaveOptions {
	/** For tests: the date written into `added` / `updated`. */
	today?: string;
	/**
	 * Written in the same commit as the saved files, only when at least one is
	 * saved (plan 04, Q10 A): a family label (`vocab/families.yaml`), the other
	 * recipe of a W608 pair (an edit, indexed with the rest).
	 */
	extra?: { files?: FileWrite[]; recipes?: { slug: string; title: string; text: string }[] };
}

/** Local date as YYYY-MM-DD. */
export const localDate = (d = new Date()) =>
	`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Set top-level frontmatter keys in a file's text, keeping the rest as written. */
export function setFrontmatter(text: string, changes: Record<string, string>): string {
	const lines = normalizeText(text).split('\n');
	if (lines[0]?.trimEnd() !== '---') return text;
	const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---');
	if (end === -1) return text;
	// Unresolved or self-referencing aliases throw on toString(): leave the text
	// as written, and the checker reports E002 for it.
	try {
		const doc = parseDocument(lines.slice(1, end).join('\n'), { version: '1.2' });
		if (doc.errors.length) return text;
		for (const [k, v] of Object.entries(changes)) doc.set(k, v);
		return ['---', doc.toString().replace(/\n$/, ''), ...lines.slice(end)].join('\n');
	} catch {
		return text;
	}
}

/** Slugs taken in the vault, with what batch rules need: live recipes, files that fail to parse, the trash. */
export function vaultEntries(ctx: VaultContext): { entries: VaultEntry[]; trash: Set<string> } {
	const { db } = ctx;
	// From the index: built once per index state (the form's live check runs this on every pause).
	const indexed = indexMemo(db, 'vaultEntries', () => {
		const refs = new Map<string, string[]>();
		for (const r of db.prepare('SELECT slug, recipe FROM ingredients WHERE recipe IS NOT NULL').all() as { slug: string; recipe: string }[])
			refs.set(r.slug, [...(refs.get(r.slug) ?? []), r.recipe]);
		const list: VaultEntry[] = (db.prepare('SELECT slug, title FROM recipes').all() as { slug: string; title: string }[]).map((r) => ({
			slug: r.slug,
			title: r.title,
			refs: refs.get(r.slug) ?? []
		}));
		const known = new Set(list.map((e) => e.slug));
		for (const slug of db.prepare('SELECT slug FROM problems WHERE slug IS NOT NULL').pluck().all() as string[])
			if (!known.has(slug)) list.push({ slug, refs: [] });
		return { list, known };
	});
	const entries = [...indexed.list];
	const { known } = indexed;
	const trash = new Set(
		existsSync(ctx.paths.trash) ? readdirSync(ctx.paths.trash).filter(isRecipeFile).map((f) => f.slice(0, -3)) : []
	);
	for (const slug of trash) if (!known.has(slug)) entries.push({ slug, refs: [] });
	return { entries, trash };
}

/**
 * The file currently in the vault for a slug: text and hash, or undefined.
 * A slug that is not one (`../x`, from a URL) names no file: it never reaches
 * the file system.
 */
export function currentFile(ctx: VaultContext, slug: string): { text: string; hash: string } | undefined {
	if (!SLUG_RE.test(slug)) return undefined;
	const abs = join(ctx.paths.root, recipePath(slug));
	if (!existsSync(abs)) return undefined;
	const buf = readFileSync(abs);
	return { text: buf.toString('utf8'), hash: sha256(buf) };
}

/**
 * `needs-review` while an uncertain marker remains (W605), else `draft`. Never
 * `verified` on its own: only `kept`, the status of the recipe an edit
 * replaces, carries it over (plan 04, Q14 A — a form edit keeps the status,
 * except that a remaining marker means `needs-review`, and `needs-review`
 * with no marker left is `draft`). A paste passes no `kept`.
 */
export function statusFor(recipe: Recipe, kept?: string): 'needs-review' | 'draft' | 'verified' {
	if (recipe.markers.some((m) => m.kind !== 'added')) return 'needs-review';
	return kept === 'verified' ? 'verified' : 'draft';
}

interface Ready {
	slug: string;
	title: string;
	text: string;
	created: boolean;
	verb: string;
}

const plainTitle = (t: string) => stripMarkers(t);

function commitMessage(ready: Ready[]): string {
	const lines = ready.map((r) => `${r.verb}: ${plainTitle(r.title)}`);
	if (lines.length === 1) return lines[0];
	const joined = lines.join('; ');
	return joined.length <= 72 ? joined : `save: ${ready.length} recipes\n\n${lines.join('\n')}`;
}

/**
 * Write the files, commit them together, index them, push in the background.
 * Caller holds the lock. A failed write or commit puts every file back as it
 * was (removed if new) and throws: a file the app wrote but git never
 * recorded would be ignored by the watcher and never committed.
 */
async function writeCommitIndex(
	ctx: VaultContext,
	ready: Ready[],
	message = commitMessage(ready),
	extraFiles: FileWrite[] = []
): Promise<{ commit?: string; indexError?: string }> {
	const plural = ready.length + extraFiles.length > 1;
	let commit: string | undefined;
	try {
		commit = await writeAndCommit(
			ctx,
			[...ready.map((r) => ({ rel: recipePath(r.slug), text: r.text })), ...extraFiles],
			message
		);
	} catch (e) {
		if (!(e instanceof FileWriteError)) throw e;
		throw new SaveError(
			e.stage === 'write'
				? `could not write the file${plural ? 's' : ''}, nothing was saved: ${e.message}`
				: `the git commit failed, nothing was saved: ${e.message}`
		);
	}
	let indexError: string | undefined;
	try {
		if (ctx.faults?.index) throw new Error('index write failed (injected)');
		const vocab = loadVocab(ctx.paths.vocab);
		ctx.db.transaction(() => {
			for (const r of ready) indexText(ctx.db, vocab, recipePath(r.slug), r.text);
			refreshFamilies(ctx.db, vocab);
		})();
	} catch (e) {
		indexError = (e as Error).message;
		ctx.log(`recipevault: index update failed after commit (vault sync will recover): ${indexError}`);
	}
	committed(ctx);
	return { commit, indexError };
}

/** The first free `<slug>-N`. */
function suffixed(slug: string, taken: Set<string>): string {
	let n = 2;
	while (taken.has(`${slug}-${n}`)) n++;
	return `${slug}-${n}`;
}

/**
 * Save pasted files. Every file that passes and has no unresolved collision is
 * saved, all in one commit; the others come back with their diagnostics, a
 * collision to resolve (`overwrite` or `slug`), or a stale-write refusal.
 */
export function save(ctx: VaultContext, files: SaveFile[], opts: SaveOptions = {}): Promise<SaveResult> {
	return ctx.lock.run(() => saveLocked(ctx, files, opts));
}

/** `save` for a caller that already holds `ctx.lock` (the form's save reads the vault and saves in one critical section). */
export async function saveLocked(ctx: VaultContext, files: SaveFile[], opts: SaveOptions = {}): Promise<SaveResult> {
	const today = opts.today ?? localDate();
	const texts = files.map((f) => {
		const changes: Record<string, string> = {};
		if (f.slug) changes.slug = f.slug;
		if (f.family) Object.assign(changes, f.family);
		return Object.keys(changes).length ? setFrontmatter(f.text, changes) : normalizeText(f.text);
	});
	const { entries, trash } = vaultEntries(ctx);
	const overwriting = new Set(files.map((f, i) => (f.overwrite !== undefined ? fileSlugOf(texts[i]) : undefined)).filter(Boolean));
	const checked = checkBatch(
		texts.map((text, i) => ({ name: `recipe ${i + 1}`, text })),
		{ vault: entries.filter((e) => !overwriting.has(e.slug) || trash.has(e.slug)), ...checkOptions(ctx) }
	);
	const taken = new Set([...entries.map((e) => e.slug), ...checked.files.map((f) => f.recipe?.slug ?? '')]);

	const results: FileResult[] = [];
	const ready: Ready[] = [];
	const claimed = new Set<string>();
	checked.files.forEach((f, i) => {
		const diagnostics = f.diagnostics;
		const errors = diagnostics.filter((d) => d.severity === 'error');
		const collision = errors.find((d) => d.code === 'E103');
		const other = errors.filter((d) => d.code !== 'E103');
		const slug = fileSlugOf(texts[i]);
		if (other.length || !slug) {
			results.push({ status: 'rejected', diagnostics });
			return;
		}
		// Two files with one slug in the same paste, neither in the vault: the
		// first takes the slug, only the later ones wait for a choice.
		const batchOnly = collision && !entries.some((e) => e.slug === slug) && !claimed.has(slug);
		if (collision && !batchOnly) {
			const cur = currentFile(ctx, slug);
			const existing = cur ? { title: entries.find((e) => e.slug === slug)?.title ?? slug, hash: cur.hash } : undefined;
			results.push({ status: 'collision', slug, suggested: suffixed(slug, taken), existing, inTrash: trash.has(slug), diagnostics });
			return;
		}
		const file = checkFile(texts[i]);
		const recipe = file.recipe!;
		const cur = currentFile(ctx, slug);
		if (cur && files[i].overwrite === undefined) {
			// A file on disk the index did not know (written while the app ran, not yet synced).
			results.push({ status: 'collision', slug, suggested: suffixed(slug, taken), existing: { title: slug, hash: cur.hash }, inTrash: false, diagnostics });
			return;
		}
		if (files[i].overwrite !== undefined && cur?.hash !== files[i].overwrite) {
			results.push({ status: 'stale', slug, diagnostics });
			return;
		}
		claimed.add(slug);
		const previous = cur ? checkFile(cur.text).recipe : undefined;
		const final: Recipe = {
			...recipe,
			slug,
			status: statusFor(recipe, files[i].keepStatus ? previous?.status : undefined),
			added: previous?.added ?? today,
			updated: today,
			extractedBy: recipe.extractedBy ?? 'hand'
		};
		ready.push({ slug, title: recipe.title, text: serialize(final, file.body!), created: !cur, verb: cur ? 'edit' : 'add' });
		const unresolved = [
			...unresolvedDiagnostics(ctx.db, ctx.paths.vocab, recipe),
			...toTasteWarnings(ctx.db, ctx.paths.vocab, recipe),
			// W505 against the vault before this save: the recipe itself is left out (an edit, a replace).
			...duplicateWarnings(closeRecipes(ctx, recipe, slug))
		];
		results.push({ status: 'saved', slug, title: recipe.title, recipeStatus: final.status!, created: !cur, diagnostics: [...diagnostics, ...unresolved] });
	});
	if (!ready.length) return { files: results };
	for (const r of opts.extra?.recipes ?? []) ready.push({ ...r, created: false, verb: 'edit' });
	const { commit, indexError } = await writeCommitIndex(ctx, ready, undefined, opts.extra?.files);
	return { files: results, commit, indexError };
}

function fileSlugOf(text: string): string | undefined {
	const r = checkFile(text);
	if (r.recipe) return r.recipe.slug;
	const s = r.frontmatter?.slug;
	return typeof s === 'string' ? s : undefined;
}

export class EditError extends Error {
	constructor(
		readonly reason: 'gone' | 'stale' | 'invalid',
		message: string
	) {
		super(message);
	}
}

/**
 * A one-recipe edit made by the app, not typed text: the file on disk, if it
 * still has `hash`, parsed, changed by `change`, serialized, committed as
 * `edit: <title>` and indexed. The status is kept (an app-made edit such as a
 * photo neither verifies nor un-verifies, plan 04 Q14 A); `updated` is set.
 * A file with errors is not edited (plan 04, Q3 A). The caller holds
 * `ctx.lock`, so it can do its own work (a photo written into `media/`) in the
 * same critical section, and undo it when this throws.
 */
export async function editRecipeLocked(
	ctx: VaultContext,
	slug: string,
	hash: string,
	change: (recipe: Recipe) => Recipe,
	opts: SaveOptions = {}
): Promise<{ commit?: string; indexError?: string }> {
	const cur = currentFile(ctx, slug);
	if (!cur) throw new EditError('gone', 'cette recette n’existe plus.');
	if (cur.hash !== hash) throw new EditError('stale', 'le fichier a changé depuis l’ouverture de la page ; rechargez-la.');
	const file = checkFile(cur.text);
	if (!file.recipe || hasErrors(file.diagnostics)) throw new EditError('invalid', 'le fichier ne passe pas la validation.');
	const final: Recipe = { ...change({ ...file.recipe }), slug, updated: opts.today ?? localDate() };
	return writeCommitIndex(ctx, [{ slug, title: final.title, text: serialize(final, file.body!), created: false, verb: 'edit' }]);
}

/**
 * Several recipes edited together, one commit (the pair list's "Deux versions",
 * plan 05 Phase 7): each hash-guarded, each result checked, all or nothing;
 * `files` (a family label) written in the same commit, only when a recipe
 * is. Holds no lock: the caller holds `ctx.lock`. A recipe the change leaves
 * as it was is not written; none changed, nothing is committed.
 */
export async function editRecipesLocked(
	ctx: VaultContext,
	edits: { slug: string; hash: string; change: (recipe: Recipe) => Recipe }[],
	opts: SaveOptions & { files?: FileWrite[] } = {}
): Promise<{ commit?: string; indexError?: string; slugs?: string[] }> {
	const ready: Ready[] = [];
	for (const e of edits) {
		const cur = currentFile(ctx, e.slug);
		if (!cur) throw new EditError('gone', 'cette recette n’existe plus.');
		if (cur.hash !== e.hash) throw new EditError('stale', 'le fichier a changé depuis l’ouverture de la page ; rechargez-la.');
		const file = checkFile(cur.text);
		if (!file.recipe || hasErrors(file.diagnostics)) throw new EditError('invalid', 'le fichier ne passe pas la validation.');
		const changed = e.change({ ...file.recipe });
		const text = serialize({ ...changed, slug: e.slug, updated: file.recipe.updated }, file.body!);
		if (text === serialize({ ...file.recipe, slug: e.slug }, file.body!)) continue;
		const final: Recipe = { ...changed, slug: e.slug, updated: opts.today ?? localDate() };
		const out = serialize(final, file.body!);
		if (hasErrors(checkFile(out).diagnostics)) throw new EditError('invalid', 'la modification ne passe pas la validation.');
		ready.push({ slug: e.slug, title: final.title, text: out, created: false, verb: 'edit' });
	}
	if (!ready.length) return {};
	// `slugs`: the recipes actually rewritten (one left unchanged is not in the commit).
	return { ...(await writeCommitIndex(ctx, ready, commitMessage(ready), opts.files ?? [])), slugs: ready.map((r) => r.slug) };
}

export class VerifyError extends Error {}

/**
 * The "Vérifié" button: a one-field edit through the same path — stale-write
 * guard, serialize, commit `verify: <title>`, index. Refused while an
 * uncertain marker remains: those need a person to settle them first.
 */
export function verify(ctx: VaultContext, slug: string, hash: string, opts: SaveOptions = {}): Promise<{ commit?: string }> {
	return ctx.lock.run(async () => {
		const cur = currentFile(ctx, slug);
		if (!cur) throw new VerifyError('cette recette n’existe plus.');
		if (cur.hash !== hash) throw new VerifyError('le fichier a changé depuis l’ouverture de la page ; rechargez-la.');
		const file = checkFile(cur.text);
		if (!file.recipe || hasErrors(file.diagnostics)) throw new VerifyError('le fichier ne passe pas la validation.');
		if (statusFor(file.recipe) === 'needs-review') throw new VerifyError('des marqueurs [?] ou [illisible] restent à régler.');
		const final: Recipe = { ...file.recipe, status: 'verified', updated: opts.today ?? localDate() };
		const ready: Ready = { slug, title: final.title, text: serialize(final, file.body!), created: false, verb: 'verify' };
		return writeCommitIndex(ctx, [ready]);
	});
}
