// Sign in and out (plan 04, Phase 1). The guard lets these two actions through
// signed out; the Origin check and the host allowlist still come first.

import { error, fail, redirect } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { clientAddress, endSession, safeNext, signIn, startSession, SESSION_COOKIE } from '$lib/server/auth';
import { t } from '$lib/i18n/fr';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, locals }) => ({
	next: safeNext(url.searchParams.get('suite')),
	signedIn: locals.user?.name ?? null
});

export const actions: Actions = {
	login: async ({ request, cookies, getClientAddress }) => {
		const app = getApp();
		// The one body read before sign-in: a login form is a few hundred bytes, not the 26 MB a photo may be.
		if (Number(request.headers.get('content-length') ?? 0) > 16 * 1024) error(413, t.auth.bad);
		const f = await request.formData();
		const login = String(f.get('login') ?? '').slice(0, 64);
		const password = String(f.get('password') ?? '');
		const next = safeNext(String(f.get('suite') ?? '/'));
		// Unchecked box = absent field; the page checks it by default (Q1 A).
		const persistent = f.get('rester') === 'on';
		const r = await signIn(app.auth, login, password, clientAddress(getClientAddress(), request.headers));
		if (!r.ok) {
			const message = r.reason === 'throttled' ? t.auth.wait(r.wait) : t.auth.bad;
			return fail(r.reason === 'throttled' ? 429 : 400, { login, message, persistent });
		}
		// A new token on every sign-in; an older one on this device ends.
		app.auth.sessions.revoke(cookies.get(SESSION_COOKIE));
		startSession(app.auth, cookies, request.headers, r.user.login, persistent);
		redirect(303, next);
	},
	logout: async ({ request, cookies }) => {
		endSession(getApp().auth, cookies, request.headers);
		redirect(303, '/');
	}
};
