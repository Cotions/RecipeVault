// Values derived from the index, kept until the index changes: what a check
// reads from every row (the vault's slugs, titles and sub-recipe links) is
// built once per index state, not on every keystroke's check.

import type { DB } from './db';

const memos = new WeakMap<DB, Map<string, { sig: string; value: unknown }>>();

/**
 * The index state: `total_changes()` counts every write made through this
 * connection (the app, the watcher, a sync in this process); `data_version`
 * changes when another connection commits (a `vault sync` from the CLI).
 */
function indexSig(db: DB): string {
	return `${db.pragma('data_version', { simple: true })}/${db.prepare('SELECT total_changes()').pluck().get()}`;
}

/** `build()`'s value for the index as it is now: rebuilt after any write to it. The value is shared: callers only read it. */
export function indexMemo<T>(db: DB, key: string, build: () => T): T {
	const sig = indexSig(db);
	let byKey = memos.get(db);
	if (!byKey) memos.set(db, (byKey = new Map()));
	const hit = byKey.get(key);
	if (hit && hit.sig === sig) return hit.value as T;
	const value = build();
	byKey.set(key, { sig, value });
	return value;
}
