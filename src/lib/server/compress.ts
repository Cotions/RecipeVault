// Compression for the responses the app makes itself: pages, `__data.json`,
// the API's JSON. adapter-node serves the build's static files precompressed
// (.br / .gz, made at build time) but sends everything SvelteKit renders as
// is: over Tailscale or a phone's data, a recipe list or the ingredient table
// is 3 to 12 times larger than it needs to be.
//
// Brotli when the browser takes it, gzip otherwise. Brotli at quality 5, not
// the build's 11: these are made per request, and 5 is most of the gain for a
// fraction of the time. Every chunk is flushed as it comes, so a streamed
// response (a load returning a promise) still arrives piece by piece.
//
// Left alone: HEAD, no body, an already encoded body, `no-transform`, a
// type that does not shrink (photos are WebP already), a body known to be
// under MIN_BYTES, and SvelteKit's own sub-requests (a load's `fetch` to the
// app reads the body itself).
//
// BREACH (a secret in a compressed page beside text an attacker chooses) does
// not apply as such: no page carries a token, CSRF is an Origin check
// (hooks.server.ts), and the session cookie is a header, never compressed.

import { Duplex } from 'node:stream';
import { constants, createBrotliCompress, createGzip } from 'node:zlib';

export type Encoding = 'br' | 'gzip';

/** Under this, the encoding's own header and framing eat the gain. */
export const MIN_BYTES = 1024;

const COMPRESSIBLE = /^\s*(text\/|application\/(json|javascript|xml|manifest\+json|[\w.+-]+\+json|[\w.+-]+\+xml)|image\/svg\+xml)/i;

/** The encoding to send for an `Accept-Encoding`, or null for none: br first, then gzip; `q=0` refuses, `*` stands for any other. */
export function pickEncoding(accept: string | null): Encoding | null {
	if (!accept) return null;
	const q = new Map<string, number>();
	for (const part of accept.split(',')) {
		const [name, ...params] = part.trim().toLowerCase().split(';');
		if (!name) continue;
		const qp = params.map((s) => s.trim()).find((s) => s.startsWith('q='));
		const v = qp ? Number(qp.slice(2)) : 1;
		q.set(name, Number.isFinite(v) ? v : 0);
	}
	const takes = (e: string) => (q.get(e) ?? q.get('*') ?? 0) > 0;
	if (takes('br')) return 'br';
	if (takes('gzip')) return 'gzip';
	return null;
}

function compressor(enc: Encoding) {
	return enc === 'br'
		? createBrotliCompress({
				params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT },
				flush: constants.BROTLI_OPERATION_FLUSH
			})
		: createGzip({ level: 6, flush: constants.Z_SYNC_FLUSH });
}

/** Whether the response is one this module would encode, the browser's encodings aside. */
function compressible(request: Request, response: Response): boolean {
	if (request.method === 'HEAD' || !response.body) return false;
	const s = response.status;
	if (s < 200 || s === 204 || s === 206 || s === 304) return false;
	const h = response.headers;
	if (h.has('content-encoding') || /(^|[\s,])no-transform($|[\s,])/i.test(h.get('cache-control') ?? '')) return false;
	if (!COMPRESSIBLE.test(h.get('content-type') ?? '')) return false;
	const len = h.get('content-length');
	return len === null || !(Number(len) < MIN_BYTES);
}

/** The response, encoded for the browser that asked when it is worth it; untouched otherwise. */
export function compress(request: Request, response: Response): Response {
	if (!compressible(request, response)) return response;
	const headers = new Headers(response.headers);
	// Whether this answer is encoded depends on the request's Accept-Encoding: any cache in between must know.
	const vary = headers.get('vary');
	if (!vary) headers.set('vary', 'Accept-Encoding');
	else if (vary.trim() !== '*' && !/(^|,)\s*accept-encoding\s*(,|$)/i.test(vary)) headers.set('vary', `${vary}, Accept-Encoding`);
	const enc = pickEncoding(request.headers.get('accept-encoding'));
	if (!enc) return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
	headers.set('content-encoding', enc);
	headers.delete('content-length');
	// The bytes differ from the identity body's: a strong validator would claim they are the same.
	const etag = headers.get('etag');
	if (etag && !etag.startsWith('W/')) headers.set('etag', `W/${etag}`);
	const body = response.body!.pipeThrough(Duplex.toWeb(compressor(enc)) as unknown as TransformStream<Uint8Array, Uint8Array>);
	return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
