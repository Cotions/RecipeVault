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

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'same-origin');
	response.headers.set('X-Frame-Options', 'DENY');
	return response;
};
