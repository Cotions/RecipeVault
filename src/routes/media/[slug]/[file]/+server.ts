// Dish photos, served through the app — never the vault folder statically.
// Originals as stored; HEIC is not served (the page shows a placeholder).

import { error } from '@sveltejs/kit';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { getApp } from '$lib/server/app';
import { SLUG_RE } from '$lib/vault/slug';
import type { RequestHandler } from './$types';

const TYPES: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	gif: 'image/gif',
	avif: 'image/avif'
};

export const GET: RequestHandler = ({ params }) => {
	const { slug, file } = params;
	const ext = file.split('.').pop()?.toLowerCase() ?? '';
	if (!SLUG_RE.test(slug) || !/^[\w][\w.-]*$/.test(file) || !TYPES[ext]) error(404);
	const abs = join(getApp().ctx.paths.media, slug, file);
	if (!existsSync(abs) || !statSync(abs).isFile()) error(404);
	const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream;
	return new Response(stream, {
		headers: {
			'Content-Type': TYPES[ext],
			'Content-Length': String(statSync(abs).size),
			'Cache-Control': 'private, max-age=86400'
		}
	});
};
