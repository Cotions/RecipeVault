// The fix-request block was copied: log the codes (never content).

import { error, json } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const files = body?.files;
	const ok =
		Array.isArray(files) &&
		files.length <= 50 &&
		files.every(
			(f: { codes?: unknown; slug?: unknown }) =>
				Array.isArray(f.codes) &&
				f.codes.every((c) => typeof c === 'string' && /^[EWI]\d{3}$/.test(c)) &&
				(f.slug === undefined || typeof f.slug === 'string')
		);
	if (!ok) error(400, 'files: { codes: string[], slug?: string }[]');
	getApp().pasteLog.append(
		'fix-block',
		files.map((f: { codes: string[]; slug?: string }) => ({ codes: f.codes, outcome: 'rejected' as const, slug: f.slug }))
	);
	return json({ ok: true });
};
