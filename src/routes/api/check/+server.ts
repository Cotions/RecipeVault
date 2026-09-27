import { error, json } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { serverCheck } from '$lib/server/paste';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body || !Array.isArray(body.files) || !body.files.every((f: unknown) => typeof f === 'string')) error(400, 'files: string[]');
	if (body.files.length > 50) error(413, 'too many files');
	return json({ files: serverCheck(getApp(), body.files) });
};
