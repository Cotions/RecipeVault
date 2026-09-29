import { getApp } from '$lib/server/app';
import { queueCount } from '$lib/server/queue';
import type { LayoutServerLoad } from './$types';

// The nav's "À relier (N)" entry (plan 03, Phase 3): shown once N > 0, to an
// account with the Markdown tools (plan 04, Q2 B). The signed-in person: name
// and that preference, never the email or anything else from users.json.
export const load: LayoutServerLoad = ({ locals }) => ({
	toResolve: queueCount(getApp().ctx.db),
	user: locals.user ? { login: locals.user.login, name: locals.user.name, markdown: !!locals.user.markdown } : null
});
