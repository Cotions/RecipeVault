// Versions of one recipe from the vault's git history, undo of a save, and
// restore of an older version (plan 04, Phase 7; Q16 A). Both write the old
// text back as a NEW commit — `undo: <title>`, `restore: <title> (version du
// <date>)` — through the save path's steps (checker with the vault's entries,
// hash guard, one commit by the signed-in person, index, push). History is
// never rewritten: no `git revert`, no reset.
//
// The text written back is the old file byte for byte (status, `updated`
// included): undo means "as it was". A version today's checker refuses is not
// written; the owner can take it back by hand.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { t } from '../i18n/fr';
import { checkBatch } from '../vault/check';
import { committed, type VaultContext } from './context';
import { checkOptions } from './checkopts';
import { FAMILIES_FILE } from './families';
import { FileWriteError, writeAndCommit, type FileWrite } from './files';
import { git, GitError } from './git';
import { catchUpCommits, commitChanges, followPath, indexedCommit } from './index/commits';
import { deleteRecipeRows, refreshFamilies, sha256 } from './index/build';
import { indexText, recipePath } from './index/sync';
import { currentFile, vaultEntries } from './save';
import { dropDerived } from './photos';
import { remove, restore, TrashError } from './trash';
import { RECIPES, TRASH } from './vault';
import { SLUG_RE } from '../vault/slug';
import { loadVocab } from './vocab';
import { tagNamer } from './tags';
import { describeChanges, diffVersions, parseVersion, titleOfText, type Change, type Parsed } from './history-diff';

export type HistoryErrorReason = 'unknown' | 'stale' | 'invalid' | 'unsupported' | 'gone' | 'failed';

/** A refused undo or restore. `message` is the plain French sentence she sees. */
export class HistoryError extends Error {
	constructor(
		readonly reason: HistoryErrorReason,
		message = t.history.errors[reason]
	) {
		super(message);
	}
}

const trashPath = (slug: string) => `${TRASH}/${slug}.md`;
const RECIPE_RE = new RegExp(`^${RECIPES}/([^/]+)\\.md$`);
const TRASH_RE = new RegExp(`^${TRASH}/([^/]+)\\.md$`);
const COMMIT_RE = /^[0-9a-f]{7,64}$/;

// ---------------------------------------------------------------------------
// git reads

/** Blobs `<rev>:<path>` in one `git cat-file --batch`; null for a missing one. */
function readBlobs(cwd: string, specs: string[]): Promise<(Buffer | null)[]> {
	if (!specs.length) return Promise.resolve([]);
	return new Promise((resolve, reject) => {
		const p = spawn('git', ['cat-file', '--batch'], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
		const chunks: Buffer[] = [];
		let stderr = '';
		p.stdout.on('data', (c: Buffer) => chunks.push(c));
		p.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
		p.on('error', reject);
		p.on('close', (code) => {
			if (code !== 0) return reject(new GitError(`git cat-file failed: ${stderr.trim()}`, stderr));
			const out = Buffer.concat(chunks);
			const blobs: (Buffer | null)[] = [];
			let at = 0;
			for (let i = 0; i < specs.length; i++) {
				const nl = out.indexOf(0x0a, at);
				const header = out.subarray(at, nl).toString();
				at = nl + 1;
				const m = /^\S+ (\S+) (\d+)$/.exec(header);
				if (!m) {
					blobs.push(null); // "<spec> missing" / "ambiguous"
					continue;
				}
				const size = Number(m[2]);
				blobs.push(m[1] === 'blob' ? out.subarray(at, at + size) : null);
				at += size + 1;
			}
			resolve(blobs);
		});
		// A path with a newline cannot be asked for; slugs never hold one.
		p.stdin.end(specs.map((s) => s.replace(/\n/g, '')).join('\n') + '\n');
	});
}

async function blob(cwd: string, rev: string, path: string): Promise<Buffer | null> {
	return (await readBlobs(cwd, [`${rev}:${path}`]))[0];
}

/** Full hash of a commit, or null. */
async function resolveCommit(cwd: string, commit: string): Promise<string | null> {
	if (!COMMIT_RE.test(commit)) return null;
	try {
		return (await git(cwd, ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`])).trim() || null;
	} catch {
		return null;
	}
}

/** A commit of the commit index (caught up first), by full hash or unique prefix. */
async function indexed(ctx: VaultContext, commit: string): Promise<{ seq: number; hash: string } | undefined> {
	if (!COMMIT_RE.test(commit)) return undefined;
	try {
		await catchUpCommits(ctx.db, ctx.paths.root);
	} catch (e) {
		ctx.log(`recipevault: commit index not caught up: ${(e as Error).message}`);
		return undefined;
	}
	return indexedCommit(ctx.db, commit);
}

interface PathChange {
	status: string;
	/** Path before (renames), else the path. */
	from: string;
	/** Path after. */
	path: string;
}

function parseNameStatus(lines: string[]): PathChange[] {
	return lines
		.filter(Boolean)
		.map((l) => {
			const [status, a, b] = l.split('\t');
			return { status: status[0], from: a, path: b ?? a };
		});
}

// ---------------------------------------------------------------------------
// Versions

export interface Version {
	commit: string;
	/** Author date, ISO with the author's offset. */
	date: string;
	author: string;
	/** The commit subject: `edit: Tarte …`. */
	message: string;
	/** The subject's verb: `add`, `edit`, `undo`, `restore`, `delete`, `photo`, … */
	verb: string;
	/** Where the file was after this commit; null when the commit removed it. */
	path: string | null;
	/** The recipe's text after this commit; null when removed or unreadable from git. */
	text: string | null;
	changes: Change[];
	/** `changes` in plain French, one line each. */
	summary: string[];
	/** Same text as the file on disk now. */
	current: boolean;
	/** "Revenir à cette version" is offered. */
	restorable: boolean;
	/** Why not, when it is not: `current`, `trash`, `invalid`, `other-slug`, `missing`. */
	blocked?: 'current' | 'trash' | 'invalid' | 'other-slug' | 'missing';
	/** What going back to it would change, from the current version (restorable versions only). */
	toCurrent: string[];
}

export interface RecipeHistory {
	slug: string;
	/** Where the recipe is now. */
	where: 'live' | 'trash' | 'none';
	title?: string;
	/** Hash of the file on disk (live recipes): the guard of a restore. */
	hash?: string;
	/** Newest first. */
	versions: Version[];
}

/**
 * The commits of a recipe's file, newest first, from the commit index
 * (`index/commits.ts`, caught up to HEAD first): what `git log --follow -M
 * -- <path>` lists for its live or `_trash/` path, cut where the recipe began.
 */
async function recipeCommits(ctx: VaultContext, slug: string, limit?: number) {
	const root = ctx.paths.root;
	const live = currentFile(ctx, slug);
	const inTrash = !live && existsSync(join(root, trashPath(slug)));
	const where: RecipeHistory['where'] = live ? 'live' : inTrash ? 'trash' : 'none';
	const path = where === 'trash' ? trashPath(slug) : recipePath(slug);
	try {
		await catchUpCommits(ctx.db, root);
	} catch (e) {
		ctx.log(`recipevault: commit index not caught up, history may miss the latest commits: ${(e as Error).message}`);
	}
	// `--follow` walks on past the file's creation into an earlier file that had
	// the same path (a slug freed by hand and taken again): that is another
	// recipe. Stop at the creation (`A`, kept), or before a removal (`D`) — but
	// keep the newest entry when it is the removal of this recipe itself.
	const entries = followPath(ctx.db, path, {
		limit,
		stop: (e, i) => (e.change.status === 'A' ? 'keep' : i > 0 && e.change.status === 'D' ? 'drop' : undefined)
	});
	return { live, inTrash, where, path, entries };
}

/**
 * Every commit that touched the recipe's file, newest first, following
 * renames (`_trash/` and back, a slug renamed by hand), each with a summary of
 * what it changed. `limit` caps the commits read (the page shows them all:
 * 50 versions is a long-lived recipe).
 */
export async function recipeHistory(ctx: VaultContext, slug: string, opts: { limit?: number } = {}): Promise<RecipeHistory> {
	const root = ctx.paths.root;
	// A slug from the URL that is not one (`../x`) names no file in the vault.
	if (!SLUG_RE.test(slug)) return { slug, where: 'none', versions: [] };
	const { live, inTrash, where, path, entries } = await recipeCommits(ctx, slug, opts.limit);
	const blobs = await readBlobs(
		root,
		entries.map((e) => (e.change.status === 'D' ? '' : `${e.commit}:${e.change.path}`))
	);
	const texts = entries.map((e, i) => (e.change.status === 'D' ? null : (blobs[i]?.toString('utf8') ?? null)));
	const parsed = new Map<string, Parsed | null>();
	const parse = (text: string) => {
		if (!parsed.has(text)) parsed.set(text, parseVersion(text));
		return parsed.get(text)!;
	};
	const onDisk = live?.text ?? (inTrash ? readFileSync(join(root, path), 'utf8') : null);
	const nowParsed = live ? parse(live.text) : null;
	const namer = tagNamer(ctx);
	const tagName = (tag: string) => namer(tag).label;

	const versions: Version[] = entries.map((e, i) => {
		const text = texts[i];
		const older = texts[i + 1] ?? null;
		const { status, from, path: to } = e.change;
		const changes: Change[] = [];
		const fromTrash = TRASH_RE.test(from);
		const toTrash = TRASH_RE.test(to);
		if (status === 'A') changes.push({ kind: 'created' });
		else if (status === 'D') changes.push({ kind: 'deleted' });
		else {
			if (status === 'R' && toTrash && !fromTrash) changes.push({ kind: 'trashed' });
			else if (status === 'R' && fromTrash && !toTrash) changes.push({ kind: 'untrashed' });
			else if (status === 'R') changes.push({ kind: 'renamed', from: (RECIPE_RE.exec(from) ?? TRASH_RE.exec(from))?.[1] ?? from });
			if (text !== null && older !== null && text !== older) changes.push(...diffVersions(parse(older), parse(text)));
		}
		const v: Version = {
			commit: e.commit,
			date: e.date,
			author: e.author,
			message: e.message,
			verb: /^([a-z-]+)(?: \([^)]*\))?:/.exec(e.message)?.[1] ?? '',
			path: status === 'D' ? null : to,
			text,
			changes,
			summary: describeChanges(changes, tagName),
			current: text !== null && text === onDisk,
			restorable: false,
			toCurrent: []
		};
		if (where !== 'live') v.blocked = 'trash';
		else if (text === null) v.blocked = 'missing';
		else if (v.current) v.blocked = 'current';
		else {
			// Today's checker, once per text: the vault's word lists and vocabulary
			// only add warnings, so the check without them decides the same.
			const f = parse(text);
			if (!f) v.blocked = 'invalid';
			else if (f.recipe.slug !== slug) v.blocked = 'other-slug';
			else {
				v.restorable = true;
				v.toCurrent = describeChanges(diffVersions(nowParsed, parse(text)), tagName);
			}
		}
		return v;
	});
	const title = onDisk !== null ? titleOfText(onDisk) : undefined;
	return { slug, where, title, hash: live?.hash, versions };
}

// ---------------------------------------------------------------------------
// Writing an old text back

interface Revert {
	/** Vault-relative path. */
	rel: string;
	/** The text to write; null removes the file. */
	text: string | null;
	/** The recipe's slug, for recipe files checked and indexed (not a file going to the trash). */
	slug?: string;
	/** The title for the commit subject, for a recipe going to the trash. */
	title?: string;
}

/** A recipe's move to or from the trash inside a write-back: its media folder follows, its index rows and derived copies go. */
interface TrashMove {
	slug: string;
	toTrash: boolean;
}

function moveMedia(ctx: VaultContext, m: TrashMove, back = false): boolean {
	const media = join(ctx.paths.media, m.slug);
	const inTrash = join(ctx.paths.trash, m.slug);
	const [from, to] = m.toTrash !== back ? [media, inTrash] : [inTrash, media];
	if (!existsSync(from)) return false;
	mkdirSync(dirname(to), { recursive: true });
	renameSync(from, to);
	return true;
}

/**
 * Check the recipe texts together with the vault (their own slugs left out),
 * write every file, commit once, index, push. Caller holds the lock and has
 * checked the guards.
 */
async function writeBack(ctx: VaultContext, reverts: Revert[], message: string, moves: TrashMove[] = []): Promise<string | undefined> {
	const recipes = reverts.filter((r) => r.slug && r.text !== null);
	const own = new Set(recipes.map((r) => r.slug!));
	const { entries } = vaultEntries(ctx);
	const checked = checkBatch(
		recipes.map((r) => ({ name: r.rel, text: r.text! })),
		{ vault: entries.filter((e) => !own.has(e.slug)), ...checkOptions(ctx) }
	);
	for (const [i, f] of checked.files.entries()) {
		const errors = f.diagnostics.filter((d) => d.severity === 'error');
		if (errors.length || !f.recipe) {
			ctx.log(`recipevault: ${recipes[i].rel}: the old version fails today's checker (${errors.map((d) => d.code).join(', ')}); not written`);
			throw new HistoryError('invalid');
		}
		if (f.recipe.slug !== recipes[i].slug) throw new HistoryError('invalid', t.history.otherSlug);
	}
	let commit: string | undefined;
	if (moves.length) mkdirSync(ctx.paths.trash, { recursive: true });
	const moved = moves.filter((m) => moveMedia(ctx, m));
	try {
		commit = await writeAndCommit(
			ctx,
			reverts.map((r): FileWrite => ({ rel: r.rel, text: r.text })),
			message
		);
	} catch (e) {
		for (const m of moved) moveMedia(ctx, m, true);
		if (!(e instanceof FileWriteError)) throw e;
		ctx.log(`recipevault: ${message}: ${e.stage} failed, nothing changed: ${e.message}`);
		throw new HistoryError('failed');
	}
	for (const m of moves) if (m.toTrash) dropDerived(ctx.paths, m.slug);
	try {
		if (ctx.faults?.index) throw new Error('index write failed (injected)');
		const vocab = loadVocab(ctx.paths.vocab);
		ctx.db.transaction(() => {
			for (const m of moves.filter((m) => m.toTrash)) {
				deleteRecipeRows(ctx.db, m.slug);
				ctx.db.prepare('DELETE FROM problems WHERE file_path = ?').run(recipePath(m.slug));
			}
			for (const r of recipes) indexText(ctx.db, vocab, r.rel, r.text!);
			refreshFamilies(ctx.db, vocab);
		})();
	} catch (e) {
		ctx.log(`recipevault: index update failed after commit (vault sync will recover): ${(e as Error).message}`);
	}
	committed(ctx);
	return commit;
}

const onDisk = (ctx: VaultContext, rel: string): Buffer | null => {
	const abs = join(ctx.paths.root, rel);
	return existsSync(abs) ? readFileSync(abs) : null;
};
const sameBytes = (a: Buffer | null, b: Buffer | null) => (a === null || b === null ? a === b : a.equals(b));

function subject(verb: string, titles: string[], suffix = ''): string {
	const lines = titles.map((x) => `${verb}: ${x}${suffix}`);
	if (lines.length === 1) return lines[0];
	const joined = lines.join('; ');
	return joined.length <= 72 ? joined : `${verb}: ${titles.length} recipes\n\n${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Undo

export interface UndoResult {
	/** What undoing did: files written back (`undone`), a new recipe sent to the trash (`trashed`), a trashed one brought back (`untrashed`). */
	action: 'undone' | 'trashed' | 'untrashed';
	/** The new commit (the last one when undoing took two). Undo it to redo. */
	commit?: string;
	/** The recipes it touched. */
	slugs: string[];
	/** Files the commit changed that were left as they are now, because they changed since (a family label). */
	kept: string[];
}

/**
 * Undo one commit: the "Annuler" of the toast after a save, and of an undo or
 * a restore (undo of an undo is a redo). Per file the commit touched:
 *
 * - a recipe it changed goes back to its text before the commit — refused
 *   (`stale`) unless the file is still exactly as the commit left it;
 * - a recipe it created goes to the trash (`delete:` commit: the trash is how
 *   a recipe leaves, and it can come back from there);
 * - a recipe it sent to the trash comes back (`restore:`), one it brought back
 *   goes again (`delete:`);
 * - `vocab/families.yaml` (a label written with the recipe) goes back too when
 *   unchanged since, else it is kept as it is (listed in `kept`).
 *
 * Anything else (prices, the registry, a merge) is `unsupported`. `slug`
 * restricts the undo to commits that touched that recipe (the route's guard).
 * The texts written back pass today's checker or nothing is written
 * (`invalid`). One commit `undo: <title>` by `ctx.author`.
 */
export async function undoCommit(ctx: VaultContext, commit: string, opts: { slug?: string } = {}): Promise<UndoResult> {
	const root = ctx.paths.root;
	// The commit and what it changed: from the commit index when it holds it
	// (every non-merge commit on HEAD's line), else from git.
	const known = await indexed(ctx, commit);
	const full = known?.hash ?? (await resolveCommit(root, commit));
	if (!full) throw new HistoryError('unknown');
	let changes: PathChange[];
	if (known) changes = commitChanges(ctx.db, known.seq);
	else {
		const parents = (await git(root, ['rev-list', '--parents', '-n', '1', full])).trim().split(' ').slice(1);
		if (parents.length > 1) throw new HistoryError('unsupported');
		changes = parseNameStatus((await git(root, ['diff-tree', '-r', '-M', '--no-commit-id', '--name-status', '--root', full])).split('\n'));
	}
	// Its parent's version of a file (none for the first commit: a missing blob).
	const parent = `${full}^`;
	const slugOf = (p: string) => RECIPE_RE.exec(p)?.[1] ?? TRASH_RE.exec(p)?.[1];
	if (opts.slug && !changes.some((c) => slugOf(c.from) === opts.slug || slugOf(c.path) === opts.slug)) throw new HistoryError('unknown');

	const trashed: string[] = [];
	const untrashed: string[] = [];
	const added: string[] = [];
	const edited: string[] = [];
	let families: PathChange | undefined;
	for (const c of changes) {
		if (c.status === 'R' && RECIPE_RE.test(c.from) && TRASH_RE.test(c.path) && slugOf(c.from) === slugOf(c.path)) trashed.push(slugOf(c.path)!);
		else if (c.status === 'R' && TRASH_RE.test(c.from) && RECIPE_RE.test(c.path) && slugOf(c.from) === slugOf(c.path)) untrashed.push(slugOf(c.path)!);
		else if (c.status === 'A' && RECIPE_RE.test(c.path)) added.push(slugOf(c.path)!);
		else if (c.status === 'M' && RECIPE_RE.test(c.path)) edited.push(slugOf(c.path)!);
		else if ((c.status === 'M' || c.status === 'A') && c.path === FAMILIES_FILE) families = c;
		else throw new HistoryError('unsupported');
	}
	const recipes = trashed.length + untrashed.length + added.length + edited.length;
	if (!recipes) throw new HistoryError('unsupported');

	// One recipe moved to or from the trash, or one recipe created: the trash's
	// own operation (its `delete:` / `restore:` commit, the media folder with it).
	if (recipes === 1 && !edited.length) {
		try {
			if (trashed.length) return { action: 'untrashed', commit: (await restore(ctx, trashed[0])).commit, slugs: trashed, kept: [] };
			const slug = untrashed[0] ?? added[0];
			const b = await blob(root, full, recipePath(slug));
			const commit = (await remove(ctx, slug, b ? sha256(b) : '')).commit;
			return { action: 'trashed', commit, slugs: [slug], kept: families ? [FAMILIES_FILE] : [] };
		} catch (e) {
			throw fromTrashError(ctx, e);
		}
	}

	// Anything else — a W608 pair, a new recipe saved with an edit of another,
	// several recipes — reverts together: one commit, all or nothing. A recipe
	// the commit created (or brought back) goes to the trash inside that same
	// commit; one it sent to the trash comes back.
	const kept: string[] = [];
	const commitNew = await ctx.lock.run(async () => {
		const reverts: Revert[] = [];
		const moves: TrashMove[] = [];
		const stillAsLeft = async (rel: string) => {
			const now = onDisk(ctx, rel);
			if (!sameBytes(now, await blob(root, full, rel))) throw new HistoryError(now ? 'stale' : 'gone');
			return now!;
		};
		for (const slug of edited) {
			const rel = recipePath(slug);
			const [after, before] = await readBlobs(root, [`${full}:${rel}`, `${parent}:${rel}`]);
			if (!sameBytes(onDisk(ctx, rel), after)) throw new HistoryError(onDisk(ctx, rel) ? 'stale' : 'gone');
			if (!before) throw new HistoryError('unsupported');
			reverts.push({ rel, slug, text: before.toString('utf8') });
		}
		for (const slug of [...added, ...untrashed]) {
			const text = (await stillAsLeft(recipePath(slug))).toString('utf8');
			if (onDisk(ctx, trashPath(slug)) || (existsSync(join(ctx.paths.trash, slug)) && existsSync(join(ctx.paths.media, slug))))
				throw new HistoryError('unsupported');
			reverts.push({ rel: recipePath(slug), text: null }, { rel: trashPath(slug), text, title: titleOfText(text) ?? slug });
			moves.push({ slug, toTrash: true });
		}
		for (const slug of trashed) {
			const text = (await stillAsLeft(trashPath(slug))).toString('utf8');
			if (onDisk(ctx, recipePath(slug)) || ctx.db.prepare('SELECT 1 FROM recipes WHERE slug = ?').get(slug)) throw new HistoryError('unsupported');
			if (existsSync(join(ctx.paths.trash, slug)) && existsSync(join(ctx.paths.media, slug))) throw new HistoryError('unsupported');
			reverts.push({ rel: trashPath(slug), text: null }, { rel: recipePath(slug), slug, text });
			moves.push({ slug, toTrash: false });
		}
		if (families && !edited.length) kept.push(FAMILIES_FILE); // a new recipe's label stays: harmless
		else if (families) {
			const [after, before] = await readBlobs(root, [`${full}:${FAMILIES_FILE}`, `${parent}:${FAMILIES_FILE}`]);
			if (sameBytes(onDisk(ctx, FAMILIES_FILE), after)) reverts.push({ rel: FAMILIES_FILE, text: before ? before.toString('utf8') : null });
			else kept.push(FAMILIES_FILE);
		}
		const titles = reverts.filter((r) => r.title || (r.slug && r.text !== null)).map((r) => r.title ?? titleOfText(r.text!) ?? r.slug!);
		return writeBack(ctx, reverts, subject('undo', titles), moves);
	});
	const action = added.length || untrashed.length ? 'trashed' : trashed.length ? 'untrashed' : 'undone';
	return { action, commit: commitNew, slugs: [...edited, ...added, ...untrashed, ...trashed], kept };
}

/**
 * A refused trash move as she reads it: the history's own French sentence for
 * the reason, the trash's text (English, paths, git output) to the log only.
 */
function fromTrashError(ctx: VaultContext, e: unknown): unknown {
	if (!(e instanceof TrashError)) return e;
	ctx.log(`recipevault: undo through the trash refused: ${e.message}`);
	return new HistoryError(e.reason === 'taken' ? 'unsupported' : e.reason);
}

// ---------------------------------------------------------------------------
// Restore a version

/** The local date of an ISO date with offset, as written: `2026-09-28`. */
const dateOf = (iso: string) => iso.slice(0, 10);

/**
 * "Revenir à cette version": write the recipe's text as it was after `commit`
 * back as a new commit `restore: <title> (version du <date>)`. `hash` is the
 * hash of the file the person saw (stale guard). The commit must be one of
 * this recipe's versions. Writing the text already on disk commits nothing.
 */
export async function restoreVersion(ctx: VaultContext, slug: string, commit: string, hash: string): Promise<{ commit?: string }> {
	const full = (await indexed(ctx, commit))?.hash ?? (await resolveCommit(ctx.paths.root, commit));
	if (!full) throw new HistoryError('unknown');
	if (!SLUG_RE.test(slug)) throw new HistoryError('gone');
	// The one version: its commit from the index, its text from git (not the whole history).
	const { where, entries } = await recipeCommits(ctx, slug);
	if (where !== 'live') throw new HistoryError('gone');
	const version = entries.find((e) => e.commit === full);
	if (!version) throw new HistoryError('unknown');
	const b = version.change.status === 'D' ? null : await blob(ctx.paths.root, full, version.change.path);
	if (!b) throw new HistoryError('unsupported');
	const text = b.toString('utf8');
	return ctx.lock.run(async () => {
		const cur = currentFile(ctx, slug);
		if (!cur) throw new HistoryError('gone');
		if (cur.hash !== hash) throw new HistoryError('stale');
		if (cur.text === text) return {};
		const title = titleOfText(text) ?? slug;
		const c = await writeBack(ctx, [{ rel: recipePath(slug), slug, text }], subject('restore', [title], ` (version du ${dateOf(version.date)})`));
		return { commit: c };
	});
}
