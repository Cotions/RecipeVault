// /compte: what the signed-in person chooses for themself (lib/prefs.ts) —
// the interface's language, the measuring system, their own unit words.
// Stored in users.json beside the config, never in the vault. The guard sends
// a signed-out visitor to /connexion first.

import { fail, redirect } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { setUserPrefs } from '$lib/server/users';
import { t } from '$lib/i18n';
import { parsePrefs } from '$lib/prefs';
import { UNITS } from '$lib/vault/types';
import type { Actions, PageServerLoad } from './$types';

// The choices themselves come with the root layout's data (`prefs`).
export const load: PageServerLoad = ({ url }) => ({ saved: url.searchParams.has('ok') });

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const f = await request.formData();
		const words = Object.fromEntries(UNITS.map((u) => [u, [f.get(`un-${u}`), f.get(`des-${u}`)]]));
		// Anything unknown or malformed falls back to the default: nothing to refuse.
		const prefs = parsePrefs({ lang: f.get('langue'), system: f.get('mesures'), words });
		try {
			setUserPrefs(getApp().auth.users.file, locals.user!.login, prefs);
		} catch (e) {
			console.error(`recipevault: ${(e as Error).message}`);
			return fail(500, { message: t.account.failed });
		}
		// A full page load: every string and amount is then made in the new language and measures.
		redirect(303, '/compte?ok');
	}
};
