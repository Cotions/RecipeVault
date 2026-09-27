// Open the index; drop and rebuild it when the schema version changed.

import Database from 'better-sqlite3';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';

export type DB = Database.Database;

/**
 * Open (or create) the index at `file`. A database from another schema
 * version, or one that cannot be read, is deleted: it is a cache, and
 * `vault sync` rebuilds it. Returns whether it was (re)created empty.
 */
export function openIndex(file: string): { db: DB; fresh: boolean } {
	mkdirSync(dirname(file), { recursive: true });
	let db: DB | undefined;
	try {
		db = new Database(file);
		const version = db.pragma('user_version', { simple: true }) as number;
		if (version === SCHEMA_VERSION) {
			tune(db);
			return { db, fresh: false };
		}
		const empty = (db.prepare(`SELECT count(*) AS n FROM sqlite_master`).get() as { n: number }).n === 0;
		if (empty) return { db: create(db), fresh: true };
		db.close();
	} catch {
		db?.close();
	}
	for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true });
	return { db: create(new Database(file)), fresh: true };
}

function tune(db: DB): void {
	db.pragma('journal_mode = WAL');
	db.pragma('synchronous = NORMAL');
	db.pragma('foreign_keys = OFF');
}

function create(db: DB): DB {
	tune(db);
	db.exec(SCHEMA_SQL);
	db.pragma(`user_version = ${SCHEMA_VERSION}`);
	return db;
}
