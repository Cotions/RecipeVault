// Plan 04, Phase 1: accounts, sessions, cookies, the throttle, the guard's rules.
// Invented accounts and passwords only.

import type { Cookies } from '@sveltejs/kit';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	clientAddress,
	cookieOptions,
	currentUser,
	endSession,
	guard,
	overHttps,
	safeNext,
	SESSION_COOKIE,
	signIn,
	startSession,
	Throttle,
	THROTTLE,
	type Auth
} from '../../src/lib/server/auth';
import { BROWSER_SESSION_MS, PERSISTENT_MS, SessionStore } from '../../src/lib/server/sessions';
import {
	addUser,
	assertOutsideVault,
	gitAuthorOf,
	hashPassword,
	loadUsers,
	passwordStamp,
	removeUser,
	setPassword,
	UserStore,
	UsersError,
	usersPath,
	verifyPassword
} from '../../src/lib/server/users';

const FAST = { memory: 1024, passes: 1, parallelism: 1, tagLength: 32 };

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'rv-auth-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('argon2id', () => {
	it('round trip; a wrong password, a malformed hash and an absurd parameter all fail', async () => {
		const h = await hashPassword('tarte-au-sucre-1999');
		expect(h).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
		expect(await verifyPassword('tarte-au-sucre-1999', h)).toBe(true);
		expect(await verifyPassword('tarte-au-sucre-2000', h)).toBe(false);
		expect(await verifyPassword('tarte-au-sucre-1999', h.slice(0, -2))).toBe(false);
		expect(await verifyPassword('x', 'plain')).toBe(false);
		expect(await verifyPassword('tarte-au-sucre-1999', h.replace('m=65536', 'm=99999999'))).toBe(false);
		// Salted: the same password twice gives two hashes.
		expect(await hashPassword('tarte-au-sucre-1999', FAST)).not.toBe(await hashPassword('tarte-au-sucre-1999', FAST));
	});

	it('keeps each hash’s own parameters, so they can be raised later', async () => {
		const old = await hashPassword('pouding-chomeur', FAST);
		expect(old).toContain('$m=1024,t=1,p=1$');
		expect(await verifyPassword('pouding-chomeur', old)).toBe(true);
	});

	it('refuses a short password', async () => {
		await expect(hashPassword('court')).rejects.toThrow(UsersError);
	});
});

describe('users.json', () => {
	it('sits next to the config, written 0600 and atomically; add, passwd, remove', async () => {
		const file = usersPath(join(dir, 'config.json'));
		expect(file).toBe(join(dir, 'users.json'));
		await addUser(file, { login: 'Camille', name: '  Camille   Inventée ', password: 'camille-mot-de-passe', markdown: true });
		expect(statSync(file).mode & 0o777).toBe(0o600);
		const [u] = loadUsers(file);
		expect(u).toMatchObject({ login: 'camille', name: 'Camille Inventée', markdown: true });
		expect(u.email).toBeUndefined();
		expect(gitAuthorOf(u)).toEqual({ name: 'Camille Inventée', email: 'camille@recipevault.invalid' });
		expect(readFileSync(file, 'utf8')).not.toContain('camille-mot-de-passe');
		await expect(addUser(file, { login: 'camille', name: 'X', password: 'autre-mot-de-passe' })).rejects.toThrow(/already exists/);
		await expect(addUser(file, { login: 'bad login', name: 'X', password: 'autre-mot-de-passe' })).rejects.toThrow(/invalid login/);

		const before = u.hash;
		await setPassword(file, 'camille', 'nouveau-mot-de-passe');
		const after = loadUsers(file)[0].hash;
		expect(after).not.toBe(before);
		expect(passwordStamp(after)).not.toBe(passwordStamp(before));
		expect(statSync(file).mode & 0o777).toBe(0o600);
		removeUser(file, 'camille');
		expect(loadUsers(file)).toEqual([]);
		expect(() => removeUser(file, 'camille')).toThrow(/no account/);
	});

	it('is never inside the vault', () => {
		const vault = join(dir, 'vault');
		mkdirSync(vault);
		expect(() => assertOutsideVault(join(vault, 'users.json'), vault)).toThrow(/inside the vault/);
		expect(() => assertOutsideVault(join(vault, 'cache', 'users.json'), vault)).toThrow(/inside the vault/);
		expect(() => assertOutsideVault(join(dir, 'users.json'), vault)).not.toThrow();
	});

	it('the server’s store follows edits made while it runs', async () => {
		const file = join(dir, 'users.json');
		const store = new UserStore(file);
		expect(store.size).toBe(0);
		await addUser(file, { login: 'camille', name: 'Camille Inventée', password: 'camille-mot-de-passe' });
		expect(store.get('CAMILLE')?.name).toBe('Camille Inventée');
		removeUser(file, 'camille');
		expect(store.get('camille')).toBeUndefined();
	});
});

describe('sessions', () => {
	let store: SessionStore;
	beforeEach(() => {
		store = new SessionStore(join(dir, 'cache', 'sessions.db'));
	});
	afterEach(() => store.close());

	it('stores only the token’s hash; looks it up; expires; revokes', () => {
		const now = 1_800_000_000_000;
		const { token, expires } = store.create('camille', 'stamp', true, now);
		expect(Buffer.from(token, 'base64url')).toHaveLength(32);
		expect(expires).toBe(now + PERSISTENT_MS);
		const rows = store.db.prepare('SELECT * FROM sessions').all() as Record<string, unknown>[];
		expect(JSON.stringify(rows)).not.toContain(token);
		expect(store.lookup(token, now + 1000)).toMatchObject({ login: 'camille', persistent: true, renewed: false });
		expect(store.lookup(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'), now)).toBeUndefined();
		expect(store.lookup('not a token', now)).toBeUndefined();
		expect(store.lookup(token, expires + 1)).toBeUndefined();
		expect(store.db.prepare('SELECT count(*) FROM sessions').pluck().get()).toBe(0);

		const b = store.create('camille', 'stamp', false, now);
		expect(b.expires).toBe(now + BROWSER_SESSION_MS);
		store.revoke(b.token);
		expect(store.lookup(b.token, now)).toBeUndefined();
	});

	it('is renewed on use, at most once a day', () => {
		const now = 1_800_000_000_000;
		const { token } = store.create('camille', 'stamp', true, now);
		const day = 24 * 3600 * 1000;
		expect(store.lookup(token, now + day / 2)?.renewed).toBe(false);
		const r = store.lookup(token, now + 200 * day);
		expect(r).toMatchObject({ renewed: true, expires: now + 200 * day + PERSISTENT_MS });
		// A year after the renewal, not after the sign-in.
		expect(store.lookup(token, now + 400 * day)).toBeDefined();
	});

	it('ends every session of an account (user remove, passwd)', () => {
		const a = store.create('camille', 's', true);
		const b = store.create('camille', 's', true);
		const c = store.create('dominique', 's', true);
		expect(store.revokeLogin('camille')).toBe(2);
		expect(store.lookup(a.token)).toBeUndefined();
		expect(store.lookup(b.token)).toBeUndefined();
		expect(store.lookup(c.token)).toBeDefined();
	});
});

/** A stand-in for SvelteKit's cookies: records what was set. */
function jar(initial: Record<string, string> = {}) {
	const values = { ...initial };
	const set: { name: string; value: string; opts: Record<string, unknown> }[] = [];
	const deleted: { name: string; opts: Record<string, unknown> }[] = [];
	const cookies = {
		get: (n: string) => values[n],
		set: (name: string, value: string, opts: Record<string, unknown>) => {
			values[name] = value;
			set.push({ name, value, opts });
		},
		delete: (name: string, opts: Record<string, unknown>) => {
			delete values[name];
			deleted.push({ name, opts });
		}
	} as unknown as Cookies;
	return { cookies, values, set, deleted };
}

const https = new Headers({ 'x-forwarded-proto': 'https' });
const http = new Headers();

describe('cookies', () => {
	it('HttpOnly, SameSite=Lax, Path=/; Secure only when the proxy says HTTPS', () => {
		expect(overHttps(https)).toBe(true);
		expect(overHttps(http)).toBe(false);
		expect(overHttps(new Headers({ 'x-forwarded-proto': 'http' }))).toBe(false);
		expect(cookieOptions(true, true, Date.now() + 1000_000)).toMatchObject({ path: '/', httpOnly: true, sameSite: 'lax', secure: true, maxAge: expect.toSatisfy((s: number) => s === 999 || s === 1000) });
		expect(cookieOptions(false, true, Date.now() + 1000_000)).toMatchObject({ secure: false });
		// "Rester connectée" unchecked: a browser-session cookie, no Max-Age.
		expect(cookieOptions(false, false, Date.now() + 1000_000)).not.toHaveProperty('maxAge');
	});
});

describe('sign in, the current user, sign out', () => {
	let auth: Auth;
	const file = () => join(dir, 'users.json');
	beforeEach(async () => {
		await addUser(file(), { login: 'camille', name: 'Camille Inventée', email: 'camille@example.invalid', password: 'camille-mot-de-passe' });
		auth = { users: new UserStore(file()), sessions: new SessionStore(join(dir, 'cache', 'sessions.db')), throttle: new Throttle() };
	});
	afterEach(() => auth.sessions.close());

	it('an unknown login and a wrong password get the same answer', async () => {
		const a = await signIn(auth, 'personne', 'camille-mot-de-passe', '10.0.0.1');
		const b = await signIn(auth, 'camille', 'mauvais-mot-de-passe', '10.0.0.2');
		expect(a).toEqual({ ok: false, reason: 'bad' });
		expect(b).toEqual(a);
		const ok = await signIn(auth, ' Camille ', 'camille-mot-de-passe', '10.0.0.3');
		expect(ok).toMatchObject({ ok: true, user: { login: 'camille', name: 'Camille Inventée', author: { name: 'Camille Inventée', email: 'camille@example.invalid' } } });
		expect(JSON.stringify(ok)).not.toContain('argon2');
	});

	it('a session cookie, over HTTPS and over HTTP', () => {
		const s = jar();
		startSession(auth, s.cookies, https, 'camille', true);
		expect(s.set[0]).toMatchObject({ name: SESSION_COOKIE, opts: { httpOnly: true, sameSite: 'lax', secure: true, path: '/' } });
		expect(s.set[0].opts.maxAge).toBeGreaterThan(364 * 24 * 3600);
		const h = jar();
		startSession(auth, h.cookies, http, 'camille', false);
		expect(h.set[0].opts).toMatchObject({ secure: false });
		expect(h.set[0].opts).not.toHaveProperty('maxAge');
		expect(currentUser(auth, jar(s.values).cookies, https)?.login).toBe('camille');
	});

	it('a password change or a removed account ends older sessions; sign out ends this one', async () => {
		const s = jar();
		startSession(auth, s.cookies, http, 'camille', true);
		expect(currentUser(auth, jar(s.values).cookies, http)?.name).toBe('Camille Inventée');
		// Changed from the CLI, sessions.db not touched: the stamp still ends the session.
		await setPassword(file(), 'camille', 'nouveau-mot-de-passe');
		const after = jar(s.values);
		expect(currentUser(auth, after.cookies, http)).toBeNull();
		expect(after.deleted[0]).toMatchObject({ name: SESSION_COOKIE });
		expect(auth.sessions.db.prepare('SELECT count(*) FROM sessions').pluck().get()).toBe(0);

		const t = jar();
		startSession(auth, t.cookies, http, 'camille', true);
		removeUser(file(), 'camille');
		expect(currentUser(auth, jar(t.values).cookies, http)).toBeNull();

		await addUser(file(), { login: 'camille', name: 'Camille Inventée', password: 'camille-mot-de-passe' });
		const u = jar();
		startSession(auth, u.cookies, http, 'camille', true);
		const token = u.values[SESSION_COOKIE];
		endSession(auth, u.cookies, http);
		expect(u.values[SESSION_COOKIE]).toBeUndefined();
		expect(auth.sessions.lookup(token)).toBeUndefined();
	});

	it('a users.json broken for a moment signs nobody in but ends no session', () => {
		const s = jar();
		startSession(auth, s.cookies, http, 'camille', true);
		const good = readFileSync(file(), 'utf8');
		// A hand edit half written: truncated mid-file.
		writeFileSync(file(), good.slice(0, 20));
		const during = jar(s.values);
		expect(currentUser(auth, during.cookies, http)).toBeNull();
		expect(during.deleted).toEqual([]);
		expect(auth.sessions.lookup(s.values[SESSION_COOKIE])).toBeDefined();
		// Fixed: the same cookie works again.
		writeFileSync(file(), good + '\n');
		expect(currentUser(auth, jar(s.values).cookies, http)?.login).toBe('camille');
	});

	it('throttles after 5 failures for a login, whatever the address', async () => {
		for (let i = 0; i < THROTTLE.free; i++) expect(await signIn(auth, 'camille', 'faux-mot-de-passe', `10.0.1.${i}`)).toMatchObject({ reason: 'bad' });
		const r = await signIn(auth, 'camille', 'camille-mot-de-passe', '10.0.2.1');
		expect(r).toMatchObject({ ok: false, reason: 'throttled' });
		expect((r as { wait: number }).wait).toBeGreaterThan(25);
	});
});

describe('throttle', () => {
	it('5 free failures, then one try per 30 s per key; a success clears; an hour forgets', () => {
		const t = new Throttle();
		const now = 1_000_000;
		for (let i = 0; i < 5; i++) expect(t.attempt(['login:a', 'addr:1'], now + i)).toBe(0);
		expect(t.attempt(['login:a', 'addr:2'], now + 10)).toBe(30);
		expect(t.attempt(['login:b', 'addr:1'], now + 10)).toBe(30);
		expect(t.attempt(['login:b', 'addr:3'], now + 10)).toBe(0);
		expect(t.attempt(['login:a', 'addr:2'], now + 4 + 30_000)).toBe(0);
		expect(t.attempt(['login:a', 'addr:2'], now + 4 + 30_001)).toBe(30);
		t.succeeded(['login:a', 'addr:2']);
		expect(t.attempt(['login:a', 'addr:9'], now + 4 + 30_002)).toBe(0);
		expect(t.attempt(['login:b', 'addr:1'], now + 4 + 30_000 + 3600_001)).toBe(0);
	});

	it('counts a try before its (slow) check: a parallel burst does not get through', () => {
		const t = new Throttle();
		const allowed = Array.from({ length: 50 }, () => t.attempt(['login:a', 'addr:1'], 5)).filter((w) => w === 0);
		expect(allowed).toHaveLength(5);
	});
});

describe('addresses, redirects, the guard', () => {
	it('believes X-Forwarded-For only from loopback (tailscale serve)', () => {
		const h = new Headers({ 'x-forwarded-for': '100.64.0.7' });
		expect(clientAddress('127.0.0.1', h)).toBe('100.64.0.7');
		expect(clientAddress('::1', h)).toBe('100.64.0.7');
		expect(clientAddress('192.168.1.30', h)).toBe('192.168.1.30');
		expect(clientAddress('127.0.0.1', new Headers())).toBe('127.0.0.1');
	});

	it('sends back only to a path on this site', () => {
		expect(safeNext('/r/tarte?portions=4')).toBe('/r/tarte?portions=4');
		for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '', null, '/\nx']) expect(safeNext(bad)).toBe('/');
	});

	it('reads are open; any other method needs a session; /connexion is the exception', () => {
		const u = (p: string) => new URL(`http://127.0.0.1${p}`);
		expect(guard('GET', u('/r/tarte'), false)).toBe('pass');
		expect(guard('GET', u('/resoudre'), false)).toBe('pass');
		expect(guard('GET', u('/ajouter'), false)).toEqual({ login: '/connexion?suite=%2Fajouter' });
		expect(guard('POST', u('/r/tarte?/verify'), false)).toEqual({ login: '/connexion?suite=%2Fr%2Ftarte' });
		expect(guard('POST', u('/api/save'), false)).toBe('unauthorized');
		expect(guard('DELETE', u('/api/save'), false)).toBe('unauthorized');
		expect(guard('POST', u('/connexion?/login'), false)).toBe('pass');
		expect(guard('POST', u('/api/save'), true)).toBe('pass');
	});
});

describe('vault user (CLI)', () => {
	function vault(args: string[], input: string, env: Record<string, string>) {
		const r = spawnSync(process.execPath, ['bin/vault.js', 'user', ...args], { encoding: 'utf8', input, env: { ...process.env, NO_COLOR: '1', ...env } });
		return { code: r.status, out: r.stdout, err: r.stderr };
	}

	it('add, list, passwd, remove; the password never an argument; sessions end', async () => {
		const vaultDir = join(dir, 'vault');
		mkdirSync(join(vaultDir, 'recipes'), { recursive: true });
		execFileSync('git', ['init', '-q', vaultDir]);
		const config = join(dir, 'conf', 'config.json');
		mkdirSync(join(dir, 'conf'));
		writeFileSync(config, JSON.stringify({ vault_directory: vaultDir }));
		const env = { RECIPEVAULT_CONFIG: config };

		expect(vault(['add', 'camille', '--name', 'Camille Inventée', '--markdown'], 'un-mot-de-passe\nun-autre\n', env)).toMatchObject({ code: 2 });
		expect(vault(['add', 'camille', '--name', 'Camille Inventée', '--markdown'], 'court\ncourt\n', env).err).toMatch(/at least 8/);
		const add = vault(['add', 'camille', '--name', 'Camille Inventée', '--markdown'], 'un-mot-de-passe\nun-mot-de-passe\n', env);
		expect(add.code, add.err).toBe(0);
		const file = join(dir, 'conf', 'users.json');
		expect(statSync(file).mode & 0o777).toBe(0o600);
		expect(await verifyPassword('un-mot-de-passe', loadUsers(file)[0].hash)).toBe(true);
		expect(vault(['add', 'camille', '--name', 'X'], 'un-mot-de-passe\nun-mot-de-passe\n', env).err).toMatch(/already exists/);
		expect(vault(['list'], '', env).out).toMatch(/^camille +Camille Inventée +\(markdown\)$/m);
		expect(vault(['list'], '', env).out).not.toContain('argon2');

		const sessions = new SessionStore(join(vaultDir, 'cache', 'sessions.db'));
		sessions.create('camille', 's', true);
		sessions.close();
		const pw = vault(['passwd', 'camille'], 'nouveau-mot-de-passe\nnouveau-mot-de-passe\n', env);
		expect(pw.out).toContain('1 session ended');
		expect(await verifyPassword('nouveau-mot-de-passe', loadUsers(file)[0].hash)).toBe(true);
		expect(vault(['remove', 'camille'], '', env)).toMatchObject({ code: 0 });
		expect(loadUsers(file)).toEqual([]);
	}, 30_000);

	it('refuses a config inside the vault (users.json would be committed)', () => {
		const vaultDir = join(dir, 'vault');
		mkdirSync(join(vaultDir, 'recipes'), { recursive: true });
		const config = join(vaultDir, 'config.json');
		writeFileSync(config, JSON.stringify({ vault_directory: vaultDir }));
		const r = vault(['add', 'camille', '--name', 'Camille'], 'un-mot-de-passe\nun-mot-de-passe\n', { RECIPEVAULT_CONFIG: config });
		expect(r.code).toBe(2);
		expect(r.err).toMatch(/inside the vault/);
	});
});
