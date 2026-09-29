// Sign-in, cookies, the login throttle, the write guard's rules (plan 04,
// Phase 1; Q1 A: reading needs no session, every write needs one).
//
// HTTPS: adapter-node reports every request as https unless told otherwise
// (no ORIGIN / PROTOCOL_HEADER here: the app is reached under several names),
// so `event.url.protocol` says nothing. What does: `tailscale serve` terminates
// TLS and sets `X-Forwarded-Proto: https` on what it forwards — and, being a
// Go ReverseProxy with a Rewrite hook, strips any such header the client sent.
// Plain LAN HTTP carries none. A LAN client could send the header itself; all
// it gets is a Secure cookie its own browser refuses to keep over http, so the
// header is trusted without a check on who sent it.

import type { Cookies } from '@sveltejs/kit';
import type { SessionStore } from './sessions';
import { decoyHash, gitAuthorOf, passwordStamp, verifyPassword, type PublicUser, type UserStore } from './users';
import type { GitAuthor } from './config';

export const SESSION_COOKIE = 'rv_session';

/** The request reached the proxy over HTTPS (see the header comment). */
export function overHttps(headers: Headers): boolean {
	return headers.get('x-forwarded-proto')?.split(',')[0].trim().toLowerCase() === 'https';
}

export function cookieOptions(secure: boolean, persistent: boolean, expires?: number) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'lax' as const,
		secure,
		...(persistent && expires ? { maxAge: Math.max(0, Math.floor((expires - Date.now()) / 1000)) } : {})
	};
}

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;

/**
 * Who is asking, for the throttle. Behind `tailscale serve` every request
 * comes from loopback; the proxy then names the tailnet peer in
 * `X-Forwarded-For` (set by it, not passed through). Only a loopback peer is
 * believed about that header: from the LAN, it would be the client's word.
 */
export function clientAddress(socketAddress: string, headers: Headers): string {
	if (LOOPBACK.test(socketAddress)) {
		const xff = headers.get('x-forwarded-for');
		const last = xff?.split(',').pop()?.trim();
		if (last) return last;
	}
	return socketAddress;
}

/** Only a path on this site: `/r/x?y`, never `//evil`, `/\evil` or `https://…`. */
export function safeNext(next: string | null | undefined): string {
	if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || /[\u0000-\u001f]/.test(next)) return '/';
	return next;
}

// --- throttle ---------------------------------------------------------------

export const THROTTLE = { free: 5, waitMs: 30_000, forgetMs: 3600_000, maxKeys: 10_000 };

interface Tries {
	failures: number;
	last: number;
}

/**
 * After 5 failures for a login or for an address, one try per 30 s (per key),
 * said in words. A success clears both keys; a key untouched for an hour is
 * forgotten. The failure is counted *before* the slow password check, so a
 * burst of parallel tries cannot all get through while the first is running.
 */
export class Throttle {
	private keys = new Map<string, Tries>();

	/** Seconds to wait before this attempt is allowed, 0 when allowed now (and then counted). */
	attempt(keys: string[], now = Date.now()): number {
		this.prune(now);
		let wait = 0;
		for (const k of keys) {
			const t = this.keys.get(k);
			if (t && t.failures >= THROTTLE.free) wait = Math.max(wait, t.last + THROTTLE.waitMs - now);
		}
		if (wait > 0) return Math.ceil(wait / 1000);
		for (const k of keys) {
			const t = this.keys.get(k) ?? { failures: 0, last: 0 };
			t.failures++;
			t.last = now;
			this.keys.set(k, t);
		}
		return 0;
	}

	succeeded(keys: string[]): void {
		for (const k of keys) this.keys.delete(k);
	}

	private prune(now: number): void {
		for (const [k, t] of this.keys) if (now - t.last > THROTTLE.forgetMs) this.keys.delete(k);
		// A flood of made-up logins: drop the oldest rather than grow without bound.
		while (this.keys.size > THROTTLE.maxKeys) this.keys.delete(this.keys.keys().next().value!);
	}
}

// --- sign in, look up, sign out --------------------------------------------

export interface Auth {
	users: UserStore;
	sessions: SessionStore;
	throttle: Throttle;
}

export interface SignedIn extends PublicUser {
	author: GitAuthor;
}

export type SignInResult = { ok: true; user: SignedIn } | { ok: false; reason: 'bad' } | { ok: false; reason: 'throttled'; wait: number };

const publicOf = (u: PublicUser & { hash?: string }): SignedIn => ({
	login: u.login,
	name: u.name,
	...(u.email ? { email: u.email } : {}),
	...(u.markdown ? { markdown: true } : {}),
	author: gitAuthorOf(u)
});

/**
 * Check a login and password. The same answer, after the same argon2id work,
 * for an unknown login and a wrong password: no account enumeration.
 */
export async function signIn(auth: Auth, login: string, password: string, address: string): Promise<SignInResult> {
	const key = login.trim().toLowerCase().slice(0, 64);
	const keys = [`login:${key}`, `addr:${address}`];
	const wait = auth.throttle.attempt(keys);
	if (wait) return { ok: false, reason: 'throttled', wait };
	const user = key ? auth.users.get(key) : undefined;
	const good = await verifyPassword(password, user?.hash ?? (await decoyHash()));
	if (!user || !good) return { ok: false, reason: 'bad' };
	auth.throttle.succeeded(keys);
	return { ok: true, user: publicOf(user) };
}

/** Start a session and set its cookie. */
export function startSession(auth: Auth, cookies: Cookies, headers: Headers, login: string, persistent: boolean): void {
	const user = auth.users.get(login);
	if (!user) return;
	const { token, expires } = auth.sessions.create(user.login, passwordStamp(user.hash), persistent);
	cookies.set(SESSION_COOKIE, token, cookieOptions(overHttps(headers), persistent, expires));
}

/**
 * The person behind the request's cookie, or null. A session whose account
 * is gone or whose password changed since is ended here. A renewed session
 * gets its cookie again, with the new expiry. While users.json does not read
 * (a hand edit half written), nobody is signed in but no session or cookie is
 * ended: they work again once the file does.
 */
export function currentUser(auth: Auth, cookies: Cookies, headers: Headers): SignedIn | null {
	const token = cookies.get(SESSION_COOKIE);
	if (!token) return null;
	const secure = overHttps(headers);
	const s = auth.sessions.lookup(token);
	if (s && auth.users.broken) return null;
	const user = s ? auth.users.get(s.login) : undefined;
	if (!s || !user || passwordStamp(user.hash) !== s.stamp) {
		if (s) auth.sessions.revoke(token);
		cookies.delete(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure });
		return null;
	}
	if (s.renewed && s.persistent) cookies.set(SESSION_COOKIE, token, cookieOptions(secure, true, s.expires));
	return publicOf(user);
}

export function endSession(auth: Auth, cookies: Cookies, headers: Headers): void {
	auth.sessions.revoke(cookies.get(SESSION_COOKIE));
	cookies.delete(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: overHttps(headers) });
}

// --- the guard's rules -----------------------------------------------------------

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Pages that exist only to write: signed out, they send to /connexion instead of showing a form that cannot save. */
const WRITE_PAGES = [/^\/ajouter\/?$/, /^\/nouvelle\/?$/, /^\/r\/[^/]+\/modifier\/?$/];

export type Guard = 'pass' | { login: string } | 'unauthorized';

/**
 * Q1 A: reads are open; every other method needs a session, except the sign-in
 * page's own actions. `api/` answers 401; a page or a form action goes to
 * /connexion, back to `next` afterwards.
 */
export function guard(method: string, url: URL, signedIn: boolean): Guard {
	if (signedIn) return 'pass';
	if (url.pathname === '/connexion') return 'pass';
	if (READS.has(method)) {
		if (WRITE_PAGES.some((re) => re.test(url.pathname))) return { login: loginHref(url.pathname + url.search) };
		return 'pass';
	}
	if (url.pathname.startsWith('/api/')) return 'unauthorized';
	// A form action: come back to the page it was posted from, not to the action URL.
	return { login: loginHref(url.pathname) };
}

export const loginHref = (next: string) => (safeNext(next) === '/' ? '/connexion' : `/connexion?suite=${encodeURIComponent(safeNext(next))}`);
