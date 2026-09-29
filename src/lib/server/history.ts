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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { t } from '../i18n/fr';
import { checkBatch, checkFile, hasErrors } from '../vault/check';
import type { VaultContext } from './context';
import { checkOptions } from './checkopts';
import { FAMILIES_FILE } from './families';
import { FileWriteError, writeAndCommit, type FileWrite } from './files';
import { git, GitError } from './git';
import { refreshFamilies, sha256 } from './index/build';
import { indexText, recipePath } from './index/sync';
import { currentFile, vaultEntries } from './save';
import { remove, restore, TrashError } from './trash';
import { RECIPES, TRASH } from './vault';
import { loadVocab } from './vocab';
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

const SEP_RECORD = '\x1e';
const SEP_FIELD = '\x1f';

/**
 * Every commit that touched the recipe's file, newest first, following
 * renames (`_trash/` and back, a slug renamed by hand), each with a summary of
 * what it changed. `limit` caps the commits read (the page shows them all:
 * 50 versions is a long-lived recipe).
 */
export async function recipeHistory(ctx: VaultContext, slug: string, opts: { limit?: number } = {}): Promise<RecipeHistory> {
	const root = ctx.paths.root;
	const live = currentFile(ctx, slug);
	const inTrash = !live && existsSync(join(root, trashPath(slug)));
	const where = live ? 'live' : inTrash ? 'trash' : 'none';
	const path = where === 'trash' ? trashPath(slug) : recipePath(slug);
	const args = ['log', '--follow', '-M', `--format=${SEP_RECORD}%H${SEP_FIELD}%an${SEP_FIELD}%aI${SEP_FIELD}%s`, '--name-status'];
	if (opts.limit) args.push(`--max-count=${opts.limit}`);
	let out = '';
	try {
		out = await git(root, [...args, '--', path]);
	} catch {
		out = ''; // no commit yet
	}
	const entries = out
		.split(SEP_RECORD)
		.filter((r) => r.trim())
		.map((rec) => {
			const [head, ...rest] = rec.split('\n');
			const [commit, author, date, message] = head.split(SEP_FIELD);
			// With --follow, the name-status lines are the followed file's alone.
			const change = parseNameStatus(rest.filter((l) => l.includes('\t')))[0] ?? { status: 'M', from: path, path };
			return { commit, author, date, message, change };
		});
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
	const opts2 = live ? checkOptions(ctx) : {};

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
			summary: describeChanges(changes),
			current: text !== null && text === onDisk,
			restorable: false,
			toCurrent: []
		};
		if (where !== 'live') v.blocked = 'trash';
		else if (text === null) v.blocked = 'missing';
		else if (v.current) v.blocked = 'current';
		else {
			const f = checkFile(text, opts2);
			if (!f.recipe || hasErrors(f.diagnostics)) v.blocked = 'invalid';
			else if (f.recipe.slug !== slug) v.blocked = 'other-slug';
			else {
				v.restorable = true;
				v.toCurrent = describeChanges(diffVersions(nowParsed, parse(text)));
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
	/** The recipe's slug, for recipe files. */
	slug?: string;
}

/**
 * Check the recipe texts together with the vault (their own slugs left out),
 * write every file, commit once, index, push. Caller holds the lock and has
 * checked the guards.
 */
async function writeBack(ctx: VaultContext, reverts: Revert[], message: string): Promise<string | undefined> {
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
	try {
		commit = await writeAndCommit(
			ctx,
			reverts.map((r): FileWrite => ({ rel: r.rel, text: r.text })),
			message
		);
	} catch (e) {
		if (!(e instanceof FileWriteError)) throw e;
		ctx.log(`recipevault: ${message}: ${e.stage} failed, nothing changed: ${e.message}`);
		throw new HistoryError('failed');
	}
	try {
		if (ctx.faults?.index) throw new Error('index write failed (injected)');
		const vocab = loadVocab(ctx.paths.vocab);
		ctx.db.transaction(() => {
			for (const r of recipes) indexText(ctx.db, vocab, r.rel, r.text!);
			refreshFamilies(ctx.db, vocab);
		})();
	} catch (e) {
		ctx.log(`recipevault: index update failed after commit (vault sync will recover): ${(e as Error).message}`);
	}
	ctx.pusher.schedule();
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
	const full = await resolveCommit(root, commit);
	if (!full) throw new HistoryError('unknown');
	const parents = (await git(root, ['rev-list', '--parents', '-n', '1', full])).trim().split(' ').slice(1);
	if (parents.length > 1) throw new HistoryError('unsupported');
	const parent = parents[0];
	const changes = parseNameStatus(
		(await git(root, ['diff-tree', '-r', '-M', '--no-commit-id', '--name-status', '--root', full])).split('\n')
	);
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
	if (!trashed.length && !untrashed.length && !added.length && !edited.length) throw new HistoryError('unsupported');

	// A trash move is undone by the trash's own operation (it moves the media folder too).
	if (trashed.length || untrashed.length) {
		if (added.length || edited.length || families) throw new HistoryError('unsupported');
		let last: string | undefined;
		try {
			for (const slug of trashed) last = (await restore(ctx, slug)).commit ?? last;
			for (const slug of untrashed) {
				const b = await blob(root, full, recipePath(slug));
				last = (await remove(ctx, slug, b ? sha256(b) : '')).commit ?? last;
			}
		} catch (e) {
			if (e instanceof TrashError) throw new HistoryError(/changé depuis/.test(e.message) ? 'stale' : 'gone', e.message);
			throw e;
		}
		return { action: trashed.length ? 'untrashed' : 'trashed', commit: last, slugs: [...trashed, ...untrashed], kept: [] };
	}

	const kept: string[] = [];
	const commitNew = await ctx.lock.run(async () => {
		const reverts: Revert[] = [];
		for (const slug of edited) {
			const rel = recipePath(slug);
			const [after, before] = await readBlobs(root, [`${full}:${rel}`, `${parent}:${rel}`]);
			if (!sameBytes(onDisk(ctx, rel), after)) throw new HistoryError(onDisk(ctx, rel) ? 'stale' : 'gone');
			if (!before) throw new HistoryError('unsupported');
			reverts.push({ rel, slug, text: before.toString('utf8') });
		}
		for (const slug of added) {
			const rel = recipePath(slug);
			if (!sameBytes(onDisk(ctx, rel), await blob(root, full, rel))) throw new HistoryError(onDisk(ctx, rel) ? 'stale' : 'gone');
		}
		if (families && !edited.length) kept.push(FAMILIES_FILE); // a new recipe's label stays: harmless, and one commit fewer
		else if (families) {
			const [after, before] = await readBlobs(root, [`${full}:${FAMILIES_FILE}`, parent ? `${parent}:${FAMILIES_FILE}` : '']);
			if (sameBytes(onDisk(ctx, FAMILIES_FILE), after)) reverts.push({ rel: FAMILIES_FILE, text: before ? before.toString('utf8') : null });
			else kept.push(FAMILIES_FILE);
		}
		if (!reverts.some((r) => r.slug)) return undefined;
		const titles = reverts.filter((r) => r.slug).map((r) => titleOfText(r.text!) ?? r.slug!);
		return writeBack(ctx, reverts, subject('undo', titles));
	});

	// A recipe the commit created leaves through the trash, after the lock is released.
	let last = commitNew;
	for (const slug of added) {
		try {
			const b = await blob(root, full, recipePath(slug));
			last = (await remove(ctx, slug, b ? sha256(b) : '')).commit ?? last;
		} catch (e) {
			if (e instanceof TrashError) throw new HistoryError(/changé depuis/.test(e.message) ? 'stale' : 'gone', e.message);
			throw e;
		}
	}
	return { action: added.length && !edited.length ? 'trashed' : 'undone', commit: last, slugs: [...edited, ...added], kept };
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
	const full = await resolveCommit(ctx.paths.root, commit);
	if (!full) throw new HistoryError('unknown');
	const history = await recipeHistory(ctx, slug);
	if (history.where !== 'live') throw new HistoryError('gone');
	const version = history.versions.find((v) => v.commit === full);
	if (!version) throw new HistoryError('unknown');
	if (version.text === null) throw new HistoryError('unsupported');
	const text = version.text;
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
