import { describe, expect, it } from 'vitest';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { compress, MIN_BYTES, pickEncoding } from '../../src/lib/server/compress';

const page = '<!doctype html><p>Tarte inventée</p>'.repeat(200);
const req = (accept: string | null, method = 'GET') => new Request('http://x/', { method, headers: accept === null ? {} : { 'accept-encoding': accept } });
const html = (body: BodyInit | null = page, init: ResponseInit = {}) =>
	new Response(body, { ...init, headers: { 'content-type': 'text/html', ...(init.headers as Record<string, string>) } });
const bytes = async (r: Response) => Buffer.from(await r.arrayBuffer());

describe('pickEncoding', () => {
	it('prefers br, then gzip, and honours q=0 and *', () => {
		expect(pickEncoding('gzip, deflate, br, zstd')).toBe('br');
		expect(pickEncoding('gzip, deflate')).toBe('gzip');
		expect(pickEncoding('br;q=0, gzip;q=0.5')).toBe('gzip');
		expect(pickEncoding('*')).toBe('br');
		expect(pickEncoding('*;q=0')).toBe(null);
		expect(pickEncoding('identity')).toBe(null);
		expect(pickEncoding('br;q=nonsense, gzip')).toBe('gzip');
		expect(pickEncoding('')).toBe(null);
		expect(pickEncoding(null)).toBe(null);
	});
});

describe('compress', () => {
	it('encodes a page as br, and the bytes come back the same', async () => {
		const out = compress(req('gzip, br'), html(page, { headers: { 'content-length': String(page.length) } }));
		expect(out.headers.get('content-encoding')).toBe('br');
		expect(out.headers.get('content-length')).toBe(null);
		expect(out.headers.get('vary')).toBe('Accept-Encoding');
		const body = await bytes(out);
		expect(body.length).toBeLessThan(page.length / 5);
		expect(brotliDecompressSync(body).toString()).toBe(page);
	});

	it('falls back to gzip', async () => {
		const out = compress(req('gzip'), new Response(JSON.stringify({ items: Array(300).fill('farine') }), { headers: { 'content-type': 'application/json' } }));
		expect(out.headers.get('content-encoding')).toBe('gzip');
		expect(JSON.parse(gunzipSync(await bytes(out)).toString()).items).toHaveLength(300);
	});

	it('keeps a streamed body streaming: each chunk is readable before the next is sent', async () => {
		let push!: (s: string) => void;
		const source = new ReadableStream<Uint8Array>({
			start(c) {
				push = (s) => c.enqueue(new TextEncoder().encode(s));
			}
		});
		const out = compress(req('gzip'), new Response(source, { headers: { 'content-type': 'text/sveltekit-data' } }));
		const reader = out.body!.getReader();
		push('{"type":"data"}\n');
		const first = await reader.read();
		expect(gunzipSync(Buffer.from(first.value!), { finishFlush: 2 /* Z_SYNC_FLUSH */ }).toString()).toBe('{"type":"data"}\n');
		await reader.cancel();
	});

	it('weakens a strong ETag and adds to an existing Vary', () => {
		const out = compress(req('br'), html(page, { headers: { etag: '"abc"', vary: 'Cookie' } }));
		expect(out.headers.get('etag')).toBe('W/"abc"');
		expect(out.headers.get('vary')).toBe('Cookie, Accept-Encoding');
	});

	it('says Vary even to a browser that takes no encoding, and sends the body as is', async () => {
		const out = compress(req(null), html());
		expect(out.headers.get('content-encoding')).toBe(null);
		expect(out.headers.get('vary')).toBe('Accept-Encoding');
		expect((await bytes(out)).toString()).toBe(page);
	});

	it('leaves alone what it should not touch', () => {
		const same = (r: Request, res: Response) => expect(compress(r, res)).toBe(res);
		same(req('br', 'HEAD'), html());
		same(req('br'), html(null, { status: 204 }));
		same(req('br'), html(null, { status: 304 }));
		same(req('br'), new Response(page, { headers: { 'content-type': 'image/webp' } }));
		same(req('br'), new Response(new TextEncoder().encode(page))); // no type at all
		same(req('br'), html(page, { headers: { 'content-encoding': 'gzip' } }));
		same(req('br'), html(page, { headers: { 'cache-control': 'private, no-transform' } }));
		same(req('br'), html('x', { headers: { 'content-length': String(MIN_BYTES - 1) } }));
	});
});
