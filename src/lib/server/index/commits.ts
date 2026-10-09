// The vault's git history in the index (issue #10): every non-merge commit
// reachable from HEAD, in `git log` order, with the paths it changed (renames
// detected over the whole tree, `-M`). A recipe's history is then a walk over
// these rows that does what `git log --follow -M -- <path>` does — without
// git reading ~20 000 commits on every history page.
//
// A cache like the rest of the index: rebuilt from git when missing, when
// HEAD no longer descends from the last commit read (a rewrite, a reset, a
// branch switch) or when the new commits hold a merge (git's date order
// could then interleave them with older ones). Otherwise only the commits
// since the last one read are walked (`git log <last>..HEAD`). Caught up
// after each app commit (in the background) and before every read.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { git } from '../git';
import type { DB } from './db';
import { getMeta, setMeta } from './build';

const HEAD_KEY = 'commits_head';
const REC = '\x1e';
const FIELD = '\x1f';
/** `git log` for the index: whole-tree renames, NUL-separated paths (no quoting), no merge diffs. */
const LOG = ['-c', 'core.quotePath=false', 'log', '-M', '--name-status', '-z', '--no-show-signature', `--format=${REC}%H${FIELD}%P${FIELD}%an${FIELD}%aI${FIELD}%s`];

interface LoggedCommit {
	hash: string;
	parents: string[];
	merge: boolean;
	author: string;
	date: string;
	subject: string;
	files: { status: string; path: string; from: string | null }[];
}

function parseLog(out: string): LoggedCommit[] {
	const commits: LoggedCommit[] = [];
	for (const rec of out.split(REC)) {
		if (!rec) continue;
		const end = rec.indexOf('\0');
		const header = end < 0 ? rec : rec.slice(0, end);
		const [hash, parents, author, date, ...subject] = header.split(FIELD);
		const tokens = end < 0 ? [] : rec.slice(end + 1).replace(/^\n/, '').split('\0');
		const files: LoggedCommit['files'] = [];
		for (let i = 0; i < tokens.length; i++) {
			const status = tokens[i].trim();
			if (!status) continue;
			if (status[0] === 'R' || status[0] === 'C') {
				files.push({ status: status[0], from: tokens[i + 1], path: tokens[i + 2] });
				i += 2;
			} else {
				files.push({ status: status[0], from: null, path: tokens[i + 1] });
				i += 1;
			}
		}
		const ps = parents.trim() ? parents.trim().split(' ') : [];
		commits.push({ hash, parents: ps, merge: ps.length > 1, author, date, subject: subject.join(FIELD), files });
	}
	return commits;
}

const HASH_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/**
 * HEAD read from `.git` without running git (a spawn from a large server
 * process costs tens of ms; this is every history read): `.git/HEAD`, then the
 * loose ref or `packed-refs`. '' for a branch with no commit yet; null when the
 * layout is not the plain one (a worktree's `.git` file, reftable, a symbolic
 * ref), for git to answer.
 */
function readHead(root: string): string | null {
	try {
		const dir = join(root, '.git');
		if (!statSync(dir).isDirectory() || existsSync(join(dir, 'reftable'))) return null;
		const head = readFileSync(join(dir, 'HEAD'), 'utf8').trim();
		if (HASH_RE.test(head)) return head;
		const ref = /^ref: (refs\/\S+)$/.exec(head)?.[1];
		if (!ref) return null;
		const loose = join(dir, ref);
		if (existsSync(loose)) {
			const hash = readFileSync(loose, 'utf8').trim();
			return HASH_RE.test(hash) ? hash : null;
		}
		const packed = join(dir, 'packed-refs');
		if (existsSync(packed))
			for (const line of readFileSync(packed, 'utf8').split('\n')) {
				const [hash, name] = line.split(' ');
				if (name === ref && HASH_RE.test(hash)) return hash;
			}
		return '';
	} catch {
		return null;
	}
}

async function headOf(root: string): Promise<string> {
	const fast = readHead(root);
	if (fast !== null) return fast;
	try {
		return (await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])).trim();
	} catch {
		return ''; // no commit yet
	}
}

function store(db: DB, commits: LoggedCommit[], head: string, rebuild: boolean): void {
	db.transaction(() => {
		if (rebuild) {
			db.prepare('DELETE FROM commits').run();
			db.prepare('DELETE FROM commit_files').run();
		}
		let seq = ((db.prepare('SELECT max(seq) FROM commits').pluck().get() as number | null) ?? 0) + 1;
		const commit = db.prepare('INSERT INTO commits (seq, hash, author, date, subject) VALUES (?, ?, ?, ?, ?)');
		const file = db.prepare('INSERT OR REPLACE INTO commit_files (seq, pos, status, path, from_path) VALUES (?, ?, ?, ?, ?)');
		// `git log` lists newest first; seq grows with time.
		for (const c of [...commits].reverse()) {
			if (c.merge) continue; // `git log --follow` never shows a merge
			commit.run(seq, c.hash, c.author, c.date, c.subject);
			c.files.forEach((f, i) => file.run(seq, i, f.status, f.path, f.from));
			seq++;
		}
		setMeta(db, HEAD_KEY, head);
	})();
}

export interface CatchUp {
	/** `none`: already at HEAD; `append`: the new commits walked; `rebuild`: the whole history read again. */
	mode: 'none' | 'append' | 'rebuild';
	/** Commits read from git. */
	commits: number;
}

async function catchUpNow(db: DB, root: string): Promise<CatchUp> {
	const head = await headOf(root);
	const last = getMeta(db, HEAD_KEY);
	if (last !== undefined && last === head) return { mode: 'none', commits: 0 };
	if (!head) {
		store(db, [], '', true);
		return { mode: 'rebuild', commits: 0 };
	}
	if (last) {
		// The new commits, when they descend from the last one read in a line:
		// the oldest one's parent is it. Anything else (HEAD moved back or
		// elsewhere, a merge, `last` gone) reads everything again.
		const commits = await git(root, [...LOG, `${last}..${head}`]).then(parseLog, () => null);
		if (commits?.length && !commits.some((c) => c.merge) && commits.at(-1)!.parents[0] === last) {
			store(db, commits, head, false);
			return { mode: 'append', commits: commits.length };
		}
	}
	const commits = parseLog(await git(root, [...LOG, head]));
	store(db, commits, head, true);
	return { mode: 'rebuild', commits: commits.length };
}

const running = new WeakMap<DB, Promise<unknown>>();

/**
 * Bring the commit index up to HEAD. Calls on one database run one after the
 * other, so two never read the same commits twice.
 */
export function catchUpCommits(db: DB, root: string): Promise<CatchUp> {
	const before = running.get(db) ?? Promise.resolve();
	const next = before.catch(() => undefined).then(() => catchUpNow(db, root));
	running.set(db, next);
	return next;
}

/** Resolves when no catch-up is running on this database — before closing it. */
export async function commitsIdle(db: DB): Promise<void> {
	await running.get(db)?.catch(() => undefined);
}

/** After an app commit: catch up in the background (a read catches up anyway). */
export function scheduleCatchUp(ctx: { db: DB; paths: { root: string }; log: (msg: string) => void }): void {
	catchUpCommits(ctx.db, ctx.paths.root).catch((e) => ctx.log(`recipevault: commit index not updated (the next read retries): ${(e as Error).message}`));
}

/** The indexed commit a full hash or unique prefix names, or undefined (not indexed, ambiguous). Call `catchUpCommits` first. */
export function indexedCommit(db: DB, prefix: string): { seq: number; hash: string } | undefined {
	if (!/^[0-9a-f]{7,64}$/.test(prefix)) return undefined;
	const rows = db.prepare('SELECT seq, hash FROM commits WHERE hash >= ? AND hash < ? LIMIT 2').all(prefix, prefix + 'g') as { seq: number; hash: string }[];
	return rows.length === 1 ? rows[0] : undefined;
}

/** The paths an indexed commit changed, as `git diff-tree -r -M --name-status` against its parent lists them. */
export function commitChanges(db: DB, seq: number): { status: string; from: string; path: string }[] {
	return (db.prepare('SELECT status, path, from_path FROM commit_files WHERE seq = ? ORDER BY pos').all(seq) as { status: string; path: string; from_path: string | null }[]).map(
		(r) => ({ status: r.status, from: r.from_path ?? r.path, path: r.path })
	);
}

// ---------------------------------------------------------------------------
// One file's history

export interface FollowedChange {
	/** `A`, `M`, `D`, `R` (renamed to `path` from `from`), `T`. */
	status: string;
	/** Path before (renames), else the path. */
	from: string;
	/** Path after. */
	path: string;
}

export interface FollowedCommit {
	commit: string;
	author: string;
	/** Author date, ISO with the author's offset. */
	date: string;
	/** The commit subject. */
	message: string;
	change: FollowedChange;
}

/**
 * The commits that changed `path`, newest first, following renames the way
 * `git log --follow -M --name-status -- <path>` does: a commit shows the path
 * as it would with that path alone (a file renamed away reads as deleted);
 * when the path was created by a rename, the walk goes on under the old name.
 * `stop(entry, i)` ends the walk: `'keep'` after this entry, `'drop'` before it.
 * Call `catchUpCommits` first.
 */
export function followPath(
	db: DB,
	path: string,
	opts: { limit?: number; stop?: (e: FollowedCommit, i: number) => 'keep' | 'drop' | undefined } = {}
): FollowedCommit[] {
	const asDest = db.prepare('SELECT max(seq) FROM commit_files WHERE path = ? AND seq < ?').pluck();
	const asSource = db.prepare('SELECT max(seq) FROM commit_files WHERE from_path = ? AND seq < ?').pluck();
	const files = db.prepare('SELECT status, path, from_path AS "from" FROM commit_files WHERE seq = ?');
	const commit = db.prepare('SELECT hash, author, date, subject FROM commits WHERE seq = ?');
	const out: FollowedCommit[] = [];
	let f = path;
	let below = Number.MAX_SAFE_INTEGER;
	while (!opts.limit || out.length < opts.limit) {
		const seq = Math.max((asDest.get(f, below) as number | null) ?? 0, (asSource.get(f, below) as number | null) ?? 0);
		if (!seq) break;
		below = seq;
		const rows = files.all(seq) as { status: string; path: string; from: string | null }[];
		const dest = rows.find((r) => r.path === f);
		const renamedAway = rows.some((r) => r.from === f && r.path !== f);
		// The path alone: was it there before this commit, and after?
		const before = renamedAway || (!!dest && dest.status !== 'A' && dest.status !== 'R');
		const after = !!dest && dest.status !== 'D';
		let change: FollowedChange;
		if (before && after) change = { status: dest!.status === 'T' ? 'T' : 'M', from: f, path: f };
		else if (after && dest!.status === 'R') change = { status: 'R', from: dest!.from!, path: f };
		else if (after) change = { status: 'A', from: f, path: f };
		else change = { status: 'D', from: f, path: f };
		const c = commit.get(seq) as { hash: string; author: string; date: string; subject: string };
		const entry: FollowedCommit = { commit: c.hash, author: c.author, date: c.date, message: c.subject, change };
		const s = opts.stop?.(entry, out.length);
		if (s === 'drop') break;
		out.push(entry);
		if (s === 'keep') break;
		if (change.status === 'R') f = change.from;
	}
	return out;
}
