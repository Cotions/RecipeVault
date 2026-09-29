// Dish photos, served through the app — never the vault folder statically
// (plan 04, Phase 6). Only derived copies go out: `?v=thumb` (cards) or
// `?v=display` (the default: recipe page, kitchen mode), WebP, rotated, no
// metadata — the original, and the location a phone wrote into its EXIF,
// never leaves the server. A missing copy is made on the spot (a deleted
// `cache/`). HEIC has no copy: 404, the page shows a placeholder.

import { error } from '@sveltejs/kit';
import { readFileSync, statSync } from 'node:fs';
import { getApp } from '$lib/server/app';
import { derivedCopy, VARIANTS, type Variant } from '$lib/server/photos';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, request }) => {
	const v = (url.searchParams.get('v') ?? 'display') as Variant;
	if (!Object.hasOwn(VARIANTS, v)) error(404);
	// derivedCopy checks the slug and the file name (one segment, image extension): no path leaves media/<slug>/.
	const app = getApp();
	const abs = await derivedCopy(app.ctx.paths, params.slug, params.file, v, app.ctx.log);
	if (!abs) error(404);
	const st = statSync(abs);
	const etag = `"${v}-${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
	const headers = {
		'Content-Type': 'image/webp',
		// A new photo gets a new file name, so a day is safe; the ETag covers a copy rebuilt in between.
		'Cache-Control': 'private, max-age=86400',
		ETag: etag
	};
	if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
	return new Response(readFileSync(abs), { headers: { ...headers, 'Content-Length': String(st.size) } });
};
