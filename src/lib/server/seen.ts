// What « Plus » counts as new on this device (PLANNING.md, « Plus »): a cookie
// holding the index's highest recipe id when the device first showed the
// Markdown tools. A duplicate card holding a recipe saved after it is new
// until she has seen it: /doublons, showing every new card on its first page
// (they sort first), moves the mark up to the index's (usability round 4).
// Per device, like the reading choices; nothing about it is stored in the
// vault.

import type { Cookies } from '@sveltejs/kit';
import type { VaultContext } from './context';
import { recipeMark } from './duplicates';

export const SEEN_COOKIE = 'rv-vu';

const OPTIONS = (secure: boolean) => ({ path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: 60 * 60 * 24 * 365 * 5 }) as const;

/** The device's mark, set to the index's current one the first time. `secure`: the request came over HTTPS (auth.ts, overHttps). */
export function seenMark(cookies: Cookies, ctx: VaultContext, secure: boolean): number {
	const had = Number(cookies.get(SEEN_COOKIE));
	if (cookies.get(SEEN_COOKIE) && Number.isFinite(had)) return had;
	const mark = recipeMark(ctx);
	cookies.set(SEEN_COOKIE, String(mark), OPTIONS(secure));
	return mark;
}

/** The new cards were shown: none of today's recipes is new any more on this device. */
export function markSeen(cookies: Cookies, ctx: VaultContext, secure: boolean): void {
	cookies.set(SEEN_COOKIE, String(recipeMark(ctx)), OPTIONS(secure));
}
