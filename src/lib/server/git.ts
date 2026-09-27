// git through `git` itself (execFile), no library. Every commit in the vault
// goes through here, attributed to the configured author.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GitAuthor } from './config';

export class GitError extends Error {
	constructor(
		message: string,
		readonly stderr: string
	) {
		super(message);
	}
}

export function git(cwd: string, args: string[], author?: GitAuthor): Promise<string> {
	const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
	if (author) {
		Object.assign(env, {
			GIT_AUTHOR_NAME: author.name,
			GIT_AUTHOR_EMAIL: author.email,
			GIT_COMMITTER_NAME: author.name,
			GIT_COMMITTER_EMAIL: author.email
		});
	}
	return new Promise((resolve, reject) => {
		execFile('git', args, { cwd, env, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
			if (err) reject(new GitError(`git ${args[0]} failed: ${stderr.trim() || err.message}`, stderr));
			else resolve(stdout);
		});
	});
}

/**
 * The paths git can stage: those on disk, and those it tracks (a deletion).
 * A path that is neither — a file moved away before it was ever committed —
 * would make `git add` and `git commit` fail with "pathspec did not match".
 */
async function stageable(cwd: string, paths: string[]): Promise<string[]> {
	const missing = paths.filter((p) => !existsSync(join(cwd, p)));
	if (!missing.length) return paths;
	const inHead = await git(cwd, ['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', ...missing]).catch(() => '');
	const tracked = (await git(cwd, ['ls-files', '-z', '--', ...missing]) + inHead).split('\0').filter(Boolean);
	const known = (p: string) => tracked.some((t) => t === p || t.startsWith(p.replace(/\/$/, '') + '/'));
	return paths.filter((p) => existsSync(join(cwd, p)) || known(p));
}

/**
 * Stage exactly these paths (additions, changes and deletions) and commit only
 * them. Returns the new commit hash, or undefined when nothing changed.
 */
export async function commitPaths(cwd: string, all: string[], message: string, author: GitAuthor): Promise<string | undefined> {
	const paths = await stageable(cwd, all);
	if (!paths.length) return undefined;
	await git(cwd, ['add', '-A', '--', ...paths]);
	const staged = await git(cwd, ['diff', '--cached', '--name-only', '--', ...paths]);
	if (!staged.trim()) return undefined;
	await git(cwd, ['commit', '--quiet', '--no-verify', '-m', message, '--', ...paths], author);
	return (await git(cwd, ['rev-parse', 'HEAD'])).trim();
}

/**
 * Undo `git add` for these paths after a failed commit whose files were put
 * back. Best effort: the next commit of the same paths restages them anyway.
 */
export async function unstage(cwd: string, all: string[]): Promise<void> {
	try {
		const paths = await stageable(cwd, all);
		if (paths.length) await git(cwd, ['reset', '-q', '--', ...paths]);
	} catch {
		// the lock that failed the commit may still be there
	}
}

/** True when the path has uncommitted changes (or is untracked). */
export async function isDirty(cwd: string, path: string): Promise<boolean> {
	const out = await git(cwd, ['status', '--porcelain', '--untracked-files=all', '--', path]);
	return out.trim() !== '';
}

/**
 * Background push. Never blocks or fails a save: a failure is logged and the
 * push is retried on the next save (or the next `schedule()` call).
 */
export class Pusher {
	private running: Promise<void> | null = null;
	private again = false;
	lastError: string | null = null;

	constructor(
		private cwd: string,
		private enabled: boolean,
		private log: (msg: string) => void = (m) => console.warn(m)
	) {}

	schedule(): void {
		if (!this.enabled) return;
		if (this.running) {
			this.again = true;
			return;
		}
		this.running = this.push().finally(() => {
			this.running = null;
			if (this.again) {
				this.again = false;
				this.schedule();
			}
		});
	}

	/** Resolves when no push is in flight — for tests and shutdown. */
	async idle(): Promise<void> {
		while (this.running) await this.running;
	}

	private async push(): Promise<void> {
		try {
			const remotes = (await git(this.cwd, ['remote'])).trim();
			if (!remotes) return;
			const remote = remotes.split('\n').includes('origin') ? 'origin' : remotes.split('\n')[0];
			await git(this.cwd, ['push', '--quiet', remote, 'HEAD']);
			this.lastError = null;
		} catch (e) {
			this.lastError = (e as Error).message;
			this.log(`recipevault: push failed, will retry on the next save: ${this.lastError}`);
		}
	}
}
