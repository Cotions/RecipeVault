import type { Handle, ServerInit } from '@sveltejs/kit';
import { startApp } from '$lib/server/app';

// Fail at startup, with the config's own message, rather than on the first page.
export const init: ServerInit = async () => {
	try {
		startApp();
	} catch (e) {
		console.error(`recipevault: ${(e as Error).message}`);
		process.exit(1);
	}
};

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** CSRF: a browser's writing request must come from a page on the host it targets. */
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
	if (crossSite(event.request)) return new Response('Cross-site request refused', { status: 403 });
	const response = await resolve(event);
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'same-origin');
	response.headers.set('X-Frame-Options', 'DENY');
	return response;
};
