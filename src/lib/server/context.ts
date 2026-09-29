// Everything a write needs, opened once per process (or per test).

import { DEFAULT_CURRENCY, type GitAuthor } from './config';
import { Pusher } from './git';
import { scheduleCatchUp } from './index/commits';
import { openIndex, type DB } from './index/db';
import { Mutex } from './lock';
import { vaultPaths, type VaultPaths } from './vault';

export interface VaultContext {
	paths: VaultPaths;
	db: DB;
	/** Who commits: the config's `git_author`, or the signed-in person through `withAuthor`. */
	author: GitAuthor;
	/** The config's currency: prices in another one are shown, never costed. */
	currency: string;
	pusher: Pusher;
	lock: Mutex;
	/** Relative path → hash of the last write the app made, so the watcher ignores its own echo. */
	ownWrites: Map<string, string>;
	log: (msg: string) => void;
	/** Failure injection for tests: make the index write throw after the commit. */
	faults?: { index?: boolean };
}

export interface OpenOptions {
	root: string;
	author: GitAuthor;
	push?: boolean;
	currency?: string;
	log?: (msg: string) => void;
}

/**
 * The same vault, committing as `author` — the person signed in to the app
 * (plan 04, Phase 0). Every write function commits as its context's author,
 * so a route passes `withAuthor(ctx, user)` and the author reaches every
 * commit the call makes, however deep. Lock, index, push queue and own-write
 * map are shared with `ctx`. Absent author: `ctx` itself, whose author is the
 * config's `git_author` (the CLI and the watcher's `edit (external)` commits).
 */
export function withAuthor(ctx: VaultContext, author?: GitAuthor): VaultContext {
	return author ? { ...ctx, author } : ctx;
}

export function openVault({ root, author, push = false, currency = DEFAULT_CURRENCY, log = (m) => console.warn(m) }: OpenOptions): VaultContext & { fresh: boolean } {
	const paths = vaultPaths(root);
	const { db, fresh } = openIndex(paths.index);
	return {
		paths,
		db,
		author,
		currency,
		pusher: new Pusher(root, push, log),
		lock: new Mutex(),
		ownWrites: new Map(),
		log,
		fresh
	};
}

/**
 * After a commit the app made: push it in the background, and read it into
 * the commit index (`index/commits.ts`) in the background too — a history
 * read catches up anyway, so neither delays the write.
 */
export function committed(ctx: VaultContext): void {
	ctx.pusher.schedule();
	scheduleCatchUp(ctx);
}
