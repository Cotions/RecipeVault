// Sessions (plan 04, Phase 1; Q1 A): `cache/sessions.db`, a SQLite file of its
// own, so an index rebuild (index.db dropped on a schema change) signs nobody
// out; deleting `cache/` signs everyone out and loses nothing else
// (docs/STORAGE.md).
//
// The token is 32 random bytes, given to the browser once in the cookie and
// stored only as its sha256: a copy of the database holds no usable token.
// A lookup is by that hash (a primary-key lookup, no string compare on the
// secret). Each session carries a fingerprint of the account's password hash
// at sign-in: a password change ends every older session even when the
// database was not reachable to revoke them.

import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

const DAY = 24 * 3600 * 1000;
/** "Rester connectée" (the default): a year, renewed on use (Q1 A). */
export const PERSISTENT_MS = 365 * DAY;
/** Unchecked: the browser forgets the cookie on close; the server gives it a day, renewed on use. */
export const BROWSER_SESSION_MS = DAY;
/** Renew at most once a day, so a lookup is a read on almost every request. */
const RENEW_AFTER_MS = DAY;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
	token_hash TEXT PRIMARY KEY,
	login TEXT NOT NULL,
	stamp TEXT NOT NULL,
	persistent INTEGER NOT NULL,
	created INTEGER NOT NULL,
	renewed INTEGER NOT NULL,
	expires INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sessions_login ON sessions(login);
`;

export interface Session {
	login: string;
	stamp: string;
	persistent: boolean;
	expires: number;
	/** The expiry was pushed back by this lookup: send the cookie again. */
	renewed: boolean;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export class SessionStore {
	readonly db: Database.Database;

	constructor(file: string) {
		mkdirSync(dirname(file), { recursive: true });
		let db: Database.Database;
		try {
			db = new Database(file);
			db.exec(SCHEMA);
		} catch {
			// Unreadable: a cache — start over, everyone signs in again.
			for (const s of ['', '-wal', '-shm']) rmSync(file + s, { force: true });
			db = new Database(file);
			db.exec(SCHEMA);
		}
		db.pragma('journal_mode = WAL');
		db.pragma('synchronous = NORMAL');
		this.db = db;
	}

	/** A new session; returns the token for the cookie (the only place it exists in clear). */
	create(login: string, stamp: string, persistent: boolean, now = Date.now()): { token: string; expires: number } {
		const token = randomBytes(32).toString('base64url');
		const expires = now + (persistent ? PERSISTENT_MS : BROWSER_SESSION_MS);
		this.db
			.prepare('INSERT INTO sessions (token_hash, login, stamp, persistent, created, renewed, expires) VALUES (?, ?, ?, ?, ?, ?, ?)')
			.run(hashToken(token), login, stamp, persistent ? 1 : 0, now, now, expires);
		// Housekeeping on sign-in, not on every request.
		this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(now);
		return { token, expires };
	}

	/** The live session for a token, renewed when due; undefined when unknown or expired (and then deleted). */
	lookup(token: string | undefined, now = Date.now()): Session | undefined {
		if (!token || !TOKEN_RE.test(token)) return undefined;
		const h = hashToken(token);
		const row = this.db.prepare('SELECT login, stamp, persistent, renewed, expires FROM sessions WHERE token_hash = ?').get(h) as
			| { login: string; stamp: string; persistent: number; renewed: number; expires: number }
			| undefined;
		if (!row) return undefined;
		if (row.expires <= now) {
			this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h);
			return undefined;
		}
		const persistent = row.persistent === 1;
		if (now - row.renewed >= RENEW_AFTER_MS) {
			const expires = now + (persistent ? PERSISTENT_MS : BROWSER_SESSION_MS);
			this.db.prepare('UPDATE sessions SET renewed = ?, expires = ? WHERE token_hash = ?').run(now, expires, h);
			return { login: row.login, stamp: row.stamp, persistent, expires, renewed: true };
		}
		return { login: row.login, stamp: row.stamp, persistent, expires: row.expires, renewed: false };
	}

	/** Sign out this device. */
	revoke(token: string | undefined): void {
		if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
	}

	/** Every session of an account (`vault user remove`, `vault user passwd`). Returns how many ended. */
	revokeLogin(login: string): number {
		return this.db.prepare('DELETE FROM sessions WHERE login = ?').run(login).changes;
	}

	close(): void {
		this.db.close();
	}
}
