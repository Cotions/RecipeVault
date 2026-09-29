// Accounts (plan 04, Phase 1; docs/STORAGE.md, "Accounts are not vault data").
// `users.json` lives next to the config file, never inside the vault: the
// vault is pushed to GitHub and a password hash has no business there.
//
//   { "users": [{ "login", "name", "email"?, "markdown"?, "hash" }] }
//
// `hash` is argon2id through node:crypto (Node ≥ 24.7, no dependency), as a
// PHC string that carries its own parameters, so they can be raised later
// without invalidating the older hashes. `markdown: true` shows the Markdown
// tools (paste box, "Voir le fichier", resolve queue) to that person (Q2 B).

import { argon2, createHash, randomBytes, timingSafeEqual, type Argon2Parameters } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute, basename } from 'node:path';
import type { GitAuthor } from './config';

export const USERS_FILE = 'users.json';

export interface User {
	login: string;
	name: string;
	email?: string;
	/** Shows the Markdown tools (Q2 B); the server allows every write to every account either way. */
	markdown?: boolean;
	/** argon2id PHC string. */
	hash: string;
}

/** A user as the app shows it: never the hash. */
export type PublicUser = Omit<User, 'hash'>;

export class UsersError extends Error {}

export const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
export const PASSWORD_MIN = 8;
const PASSWORD_MAX = 1024;

/** `users.json` beside the config file. */
export function usersPath(configFile: string): string {
	return join(dirname(resolve(configFile)), USERS_FILE);
}

const real = (p: string) => {
	// The file may not exist yet: resolve its folder.
	try {
		return realpathSync(p);
	} catch {
		try {
			return join(realpathSync(dirname(p)), basename(p));
		} catch {
			return resolve(p);
		}
	}
};

/** Refuse a users file inside the vault folder (it would be committed, then pushed). */
export function assertOutsideVault(file: string, vaultDirectory: string): void {
	const rel = relative(real(vaultDirectory), real(file));
	if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)))
		throw new UsersError(`${file} is inside the vault (${vaultDirectory}); move the config and users.json out of it — accounts are never vault data.`);
}

/** The git author for a person's commits. */
export function gitAuthorOf(u: Pick<User, 'login' | 'name' | 'email'>): GitAuthor {
	return { name: u.name, email: u.email || `${u.login}@recipevault.invalid` };
}

/** Logins are compared lower-cased and trimmed. */
export const normalizeLogin = (s: string) => s.trim().toLowerCase();

function validUser(u: unknown): u is User {
	if (typeof u !== 'object' || u === null) return false;
	const o = u as Record<string, unknown>;
	return (
		typeof o.login === 'string' &&
		LOGIN_RE.test(o.login) &&
		typeof o.name === 'string' &&
		o.name.trim() !== '' &&
		typeof o.hash === 'string' &&
		o.hash.startsWith('$argon2id$') &&
		(o.email === undefined || typeof o.email === 'string') &&
		(o.markdown === undefined || typeof o.markdown === 'boolean')
	);
}

/** Read the users file; absent → no users. */
export function loadUsers(file: string): User[] {
	if (!existsSync(file)) return [];
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(file, 'utf8'));
	} catch (e) {
		throw new UsersError(`${file} is not valid JSON: ${(e as Error).message}`);
	}
	const users = (raw as { users?: unknown })?.users;
	if (!Array.isArray(users)) throw new UsersError(`${file}: expected { "users": [...] }`);
	const bad = users.findIndex((u) => !validUser(u));
	if (bad !== -1) throw new UsersError(`${file}: users[${bad}] is not a valid account (login, name, argon2id hash)`);
	return users as User[];
}

/** Write atomically, mode 0600 (temp file created 0600, then renamed over). */
export function writeUsers(file: string, users: User[]): void {
	const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.tmp`);
	try {
		writeFileSync(tmp, JSON.stringify({ users }, null, 2) + '\n', { mode: 0o600 });
		chmodSync(tmp, 0o600); // umask cannot widen it, but an old temp file might have been wider
		renameSync(tmp, file);
	} catch (e) {
		rmSync(tmp, { force: true });
		throw e;
	}
}

// --- argon2id ---------------------------------------------------------------

/** 64 MiB, 3 passes, 1 lane: about 150 ms here, inside the plan's 100–500 ms sign-in target. */
export const ARGON2_DEFAULTS = { memory: 65536, passes: 3, parallelism: 1, tagLength: 32 };

function run(message: string, nonce: Buffer, p: { memory: number; passes: number; parallelism: number; tagLength: number }): Promise<Buffer> {
	const params: Argon2Parameters = { message, nonce, memory: p.memory, passes: p.passes, parallelism: p.parallelism, tagLength: p.tagLength };
	return new Promise((ok, fail) => argon2('argon2id', params, (err, key) => (err ? fail(err) : ok(key))));
}

const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');

export async function hashPassword(password: string, p = ARGON2_DEFAULTS): Promise<string> {
	checkPassword(password);
	const salt = randomBytes(16);
	const key = await run(password, salt, p);
	return `$argon2id$v=19$m=${p.memory},t=${p.passes},p=${p.parallelism}$${b64(salt)}$${b64(key)}`;
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** Constant-time check of a password against a stored hash. False on any malformed hash. */
export async function verifyPassword(password: string, phc: string): Promise<boolean> {
	const m = PHC.exec(phc);
	if (!m || password.length > PASSWORD_MAX) return false;
	const [memory, passes, parallelism] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const salt = Buffer.from(m[4], 'base64');
	const want = Buffer.from(m[5], 'base64');
	if (want.length < 16 || salt.length < 8 || memory > 4 * 1024 * 1024 || passes > 100 || parallelism > 16) return false;
	try {
		const got = await run(password, salt, { memory, passes, parallelism, tagLength: want.length });
		return timingSafeEqual(got, want);
	} catch {
		return false;
	}
}

export function checkPassword(password: string): void {
	if (password.length < PASSWORD_MIN) throw new UsersError(`the password needs at least ${PASSWORD_MIN} characters`);
	if (password.length > PASSWORD_MAX) throw new UsersError('the password is too long');
}

/** A hash of nothing anyone knows, verified for an unknown login so its answer takes as long as a known one's. */
let decoy: Promise<string> | undefined;
export function decoyHash(): Promise<string> {
	return (decoy ??= hashPassword(randomBytes(24).toString('base64')));
}

/** Changes whenever the password does: a session made before a password change no longer matches. */
export function passwordStamp(hash: string): string {
	// Only a fingerprint of the stored hash, never the hash itself, goes into the session store.
	return createHash('sha256').update(hash).digest('hex').slice(0, 32);
}

// --- account edits (the CLI) -------------------------------------------------

export async function addUser(file: string, input: { login: string; name: string; email?: string; markdown?: boolean; password: string }): Promise<User> {
	const login = normalizeLogin(input.login);
	if (!LOGIN_RE.test(login)) throw new UsersError(`invalid login "${input.login}": lowercase letters, digits, . _ - (32 at most)`);
	const name = input.name.trim().replace(/\s+/g, ' ');
	if (!name) throw new UsersError('--name is required (the name shown in the app and in git history)');
	const email = input.email?.trim() || undefined;
	if (email && !/^[^\s@<>]+@[^\s@<>]+$/.test(email)) throw new UsersError(`invalid email "${email}"`);
	const users = loadUsers(file);
	if (users.some((u) => u.login === login)) throw new UsersError(`an account "${login}" already exists`);
	const user: User = { login, name, ...(email ? { email } : {}), ...(input.markdown ? { markdown: true } : {}), hash: await hashPassword(input.password) };
	writeUsers(file, [...users, user]);
	return user;
}

export async function setPassword(file: string, login: string, password: string): Promise<void> {
	const users = loadUsers(file);
	const u = users.find((x) => x.login === normalizeLogin(login));
	if (!u) throw new UsersError(`no account "${login}"`);
	u.hash = await hashPassword(password);
	writeUsers(file, users);
}

export function removeUser(file: string, login: string): void {
	const users = loadUsers(file);
	const rest = users.filter((x) => x.login !== normalizeLogin(login));
	if (rest.length === users.length) throw new UsersError(`no account "${login}"`);
	writeUsers(file, rest);
}

// --- the server's view --------------------------------------------------------

/** users.json as the server reads it: reloaded when the file changes (the CLI edits it while the app runs). */
export class UserStore {
	private seen = '';
	private users = new Map<string, User>();
	private unreadable = false;

	constructor(readonly file: string) {}

	private refresh(): void {
		let key = 'absent';
		try {
			const s = statSync(this.file);
			key = `${s.mtimeMs}:${s.size}:${s.ino}`;
		} catch {
			// absent: no accounts
		}
		if (key === this.seen) return;
		try {
			this.users = new Map(loadUsers(this.file).map((u) => [u.login, u]));
			this.unreadable = false;
		} catch (e) {
			// A broken file signs nobody in rather than crashing every page —
			// for now: `broken` tells the session check not to end anything.
			console.error(`recipevault: ${(e as Error).message}`);
			this.users = new Map();
			this.unreadable = true;
		}
		this.seen = key;
	}

	get(login: string): User | undefined {
		this.refresh();
		return this.users.get(normalizeLogin(login));
	}

	/** users.json exists but does not read (a hand edit half done): nobody is signed in, and no session is ended for it. */
	get broken(): boolean {
		this.refresh();
		return this.unreadable;
	}

	get size(): number {
		this.refresh();
		return this.users.size;
	}
}
