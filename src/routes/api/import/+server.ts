import { error, json } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { loadVocab } from '$lib/server/vocab';
import { ImportError, importUrl } from '$lib/server/webimport';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (typeof body?.url !== 'string' || body.url.length > 2000) error(400, 'url: string');
	try {
		return json(await importUrl(body.url, loadVocab(getApp().ctx.paths.vocab)));
	} catch (e) {
		// `kind`: what the page offers next (a site that refuses, a page with no recipe).
		if (e instanceof ImportError) return json({ error: e.message, kind: e.kind }, { status: 422 });
		throw e;
	}
};
