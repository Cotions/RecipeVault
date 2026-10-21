import { AsyncLocalStorage } from 'node:async_hooks';
import { json, redirect, type Handle, type ServerInit } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { setPrefsSource, type Prefs } from '$lib/prefs';
import { getApp, startApp } from '$lib/server/app';
import { currentUser, guard } from '$lib/server/auth';
import { hostAllowed } from '$lib/server/hosts';
import { installUnitWords } from '$lib/server/vocab';
import { match as isSlug } from './params/slug';

// Fail at startup, with the config's own message, rather than on the first page.
export const init: ServerInit = async () => {
	try {
		startApp();
	} catch (e) {
		console.error(`recipevault: ${(e as Error).message}`);
		process.exit(1);
	}
};

// Several requests are served at once, each for its own account: the strings
// and the amounts ask here whose preferences apply (lib/prefs.ts).
const serving = new AsyncLocalStorage<Prefs>();
setPrefsSource(() => serving.getStore());

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** CSRF: a browser's writing request must come from a page on the host it targets (already checked against the allowed hosts). */
function crossSite(request: Request): boolean {
	if (!WRITES.has(request.method)) return false;
	const origin = request.headers.get('origin');
	if (!origin) return request.headers.get('sec-fetch-site') === 'cross-site';
	try {
		return new URL(origin).host !== request.headers.get('host');
	} catch {
		return true;
	}
}

export const handle: Handle = async ({ event, resolve }) => {
	const answer = await check(event);
	if (answer) return answer;
	const lang = event.locals.user?.prefs.lang ?? 'fr';
	const run = async () => {
		const response = await resolve(event, { transformPageChunk: ({ html }) => html.replace('%lang%', `${lang}-CA`) });
		response.headers.set('X-Content-Type-Options', 'nosniff');
		response.headers.set('Referrer-Policy', 'same-origin');
		response.headers.set('X-Frame-Options', 'DENY');
		return response;
	};
	return event.locals.user ? serving.run(event.locals.user.prefs, run) : run();
};

/** Everything settled before the page is made: the answer when the request stops here, else who is asking. */
async function check(event: Parameters<Handle>[0]['event']): Promise<Response | undefined> {
	// DNS rebinding: refuse any request, reads included, for a host name the app is not served on.
	if (!hostAllowed(event.request.headers.get('host'), getApp().config.hosts))
		return new Response('Unknown host: add it to "hosts" in the RecipeVault config.', { status: 421 });
	if (crossSite(event.request)) return new Response('Cross-site request refused', { status: 403 });
	// Every slug route is `[slug=slug]`, so a param that is not a slug (`..%2F..%2Fx`) matches no page;
	// this check stays as defense in depth, for a route added later without the matcher.
	if (event.params.slug !== undefined && !isSlug(event.params.slug)) return new Response('Not found', { status: 404 });
	// Then who is asking (plan 04, Phase 1), and whether that may write (Q1 A: reads are open, every write needs a session).
	const app = getApp();
	event.locals.user = currentUser(app.auth, event.cookies, event.request.headers);
	const g = guard(event.request.method, event.url, !!event.locals.user);
	if (g === 'unauthorized') return json({ message: t.auth.required }, { status: 401 });
	if (g !== 'pass') redirect(303, g.login);
	// The unit words (vocab/unit-labels.yaml) for loads and actions that format
	// units: the root layout sets them only when it renders.
	installUnitWords(app.ctx.paths.vocab);
	return undefined;
}
