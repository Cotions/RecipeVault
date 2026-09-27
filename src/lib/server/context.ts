// Everything a write needs, opened once per process (or per test).

import type { GitAuthor } from './config';
import { Pusher } from './git';
import { openIndex, type DB } from './index/db';
import { Mutex } from './lock';
import { vaultPaths, type VaultPaths } from './vault';

export interface VaultContext {
	paths: VaultPaths;
	db: DB;
	author: GitAuthor;
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
	log?: (msg: string) => void;
}

export function openVault({ root, author, push = false, log = (m) => console.warn(m) }: OpenOptions): VaultContext & { fresh: boolean } {
	const paths = vaultPaths(root);
	const { db, fresh } = openIndex(paths.index);
	return {
		paths,
		db,
		author,
		pusher: new Pusher(root, push, log),
		lock: new Mutex(),
		ownWrites: new Map(),
		log,
		fresh
	};
}
