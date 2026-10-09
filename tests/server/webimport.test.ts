import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkRecipe } from '../../src/lib/vault/check';
import { loadVocab } from '../../src/lib/server/vocab';
import { checkUrl, fetchPage, ImportError, importUrl, isBlockedAddress, isoDuration, parseIngredientLine, recipeFromJsonLd } from '../../src/lib/server/webimport';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedVocab } from '../../src/lib/server/vault';

const vocabDir = join(mkdtempSync(join(tmpdir(), 'rv-vocab-')), 'vocab');
mkdirSync(vocabDir);
for (const [f, text] of Object.entries(seedVocab(readFileSync('docs/VOCAB.md', 'utf8')))) writeFileSync(join(vocabDir, f), text);
const vocab = loadVocab(vocabDir);

let server: Server;
let base: string;
beforeAll(async () => {
	server = createServer((req, res) => {
		if (req.url === '/recipe') {
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end(readFileSync('tests/fixtures/web/graph-recipe.html'));
		} else if (req.url === '/redirect') {
			res.writeHead(302, { Location: '/recipe' });
			res.end();
		} else if (req.url === '/none') {
			res.writeHead(200, { 'Content-Type': 'text/html' });
			res.end('<html><body>No structured data.</body></html>');
		} else if (req.url === '/big') {
			res.writeHead(200, { 'Content-Type': 'text/html' });
			res.end('x'.repeat(2000));
		} else if (req.url === '/drip') {
			// One byte at a time, never idle long enough for a socket timeout.
			res.writeHead(200, { 'Content-Type': 'text/html' });
			const t = setInterval(() => res.write('x'), 50);
			setTimeout(() => {
				clearInterval(t);
				res.end();
			}, 1500);
		} else if (req.url === '/slow') {
			setTimeout(() => res.end('<html></html>'), 2000);
		} else {
			res.writeHead(404);
			res.end();
		}
	});
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

describe('address checks', () => {
	it('blocks private, loopback, link-local and CGNAT addresses', () => {
		for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.10', '169.254.169.254', '100.101.102.103', '0.0.0.0', '::1', 'fe80::1', 'fd12::3', '::ffff:127.0.0.1', '::ffff:192.168.0.1'])
			expect(isBlockedAddress(ip), ip).toBe(true);
		for (const ip of ['8.8.8.8', '151.101.1.1', '2606:4700::1111']) expect(isBlockedAddress(ip), ip).toBe(false);
	});
	it('checks an IPv4 address embedded in IPv6 in any form', () => {
		// WHATWG URL rewrites [::ffff:127.0.0.1] as [::ffff:7f00:1].
		for (const ip of ['::ffff:7f00:1', '::ffff:a00:1', '::ffff:c0a8:101', '::ffff:a9fe:a9fe', '::127.0.0.1', '::7f00:1', '0:0:0:0:0:ffff:7f00:1', '::ffff:0:7f00:1', '64:ff9b::a00:1', '2002:c0a8:101::1', '::', 'fe80::1%eth0', 'fec0::1', 'ff02::1', 'not:an:ip::x:y:z:w:v'])
			expect(isBlockedAddress(ip), ip).toBe(true);
		for (const ip of ['::ffff:808:808', '::ffff:8.8.8.8', '2002:808:808::1']) expect(isBlockedAddress(ip), ip).toBe(false);
		for (const u of ['http://[::ffff:127.0.0.1]:3370/', 'http://[::ffff:10.0.0.1]/', 'http://[::ffff:a9fe:a9fe]/', 'http://[0:0:0:0:0:ffff:192.168.1.1]/'])
			expect(() => checkUrl(u), u).toThrow(/locale ou privée/);
	});
	it('refuses other schemes and local names before fetching', () => {
		expect(() => checkUrl('file:///etc/passwd')).toThrow(ImportError);
		expect(() => checkUrl('ftp://example.com/x')).toThrow(ImportError);
		expect(() => checkUrl('http://localhost:3370/')).toThrow(ImportError);
		expect(() => checkUrl('http://[::1]/')).toThrow(ImportError);
		expect(() => checkUrl('http://192.168.0.1/')).toThrow(ImportError);
		expect(checkUrl('https://example.com/r').hostname).toBe('example.com');
	});
	it('refuses a host that resolves to a private address, at connection time', async () => {
		await expect(fetchPage(`${base.replace('127.0.0.1', 'localhost.')}/recipe`)).rejects.toThrow(/locale ou privée/);
		await expect(fetchPage(`${base}/recipe`)).rejects.toThrow(/locale ou privée/);
	});
});

describe('fetch limits', () => {
	it('follows redirects, enforces size and time limits', async () => {
		expect((await fetchPage(`${base}/redirect`, { allowPrivate: true })).url).toBe(`${base}/recipe`);
		await expect(fetchPage(`${base}/big`, { allowPrivate: true, maxBytes: 1000 })).rejects.toThrow(/volumineuse/);
		await expect(fetchPage(`${base}/slow`, { allowPrivate: true, timeoutMs: 200 })).rejects.toThrow(/délai/);
	});
	it('bounds the whole fetch, body included, not only the idle time', async () => {
		const t0 = Date.now();
		await expect(fetchPage(`${base}/drip`, { allowPrivate: true, timeoutMs: 400 })).rejects.toThrow(/délai/);
		expect(Date.now() - t0).toBeLessThan(1200);
	});
});

describe('mapping', () => {
	it('parses ISO durations', () => {
		expect(isoDuration('PT1H30M')).toBe('1h30m');
		expect(isoDuration('PT45M')).toBe('45m');
		expect(isoDuration('PT0S')).toBeUndefined();
	});

	it('parses ingredient lines, and keeps what it cannot read with [?]', () => {
		expect(parseIngredientLine('2 tasses de farine tamisée', 'fr')).toEqual({ name: 'farine tamisée', qty: { raw: 2, value: 2 }, unit: 'cup' });
		expect(parseIngredientLine('1 ½ tasse de cassonade', 'fr')).toMatchObject({ qty: { raw: '1 1/2', value: 1.5 }, unit: 'cup', name: 'cassonade' });
		expect(parseIngredientLine('3 oignons, hachés', 'fr')).toMatchObject({ qty: { value: 3 }, unit: 'piece', name: 'oignons', prep: 'hachés' });
		expect(parseIngredientLine('1 boîte de tomates (796 ml)', 'fr')).toMatchObject({ unit: 'can', name: 'tomates', note: '796 ml' });
		expect(parseIngredientLine('1 tasse (250 ml) de lait', 'fr')).toMatchObject({ qty: { value: 250 }, unit: 'ml', alt: { qty: { value: 1 }, unit: 'cup' }, name: 'lait' });
		expect(parseIngredientLine('2-3 c. à table de beurre', 'fr')).toMatchObject({ qty: { value: 2 }, qtyMax: { value: 3 }, unit: 'tbsp' });
		expect(parseIngredientLine('sel et poivre', 'fr')).toEqual({ name: 'sel et poivre' });
		expect(parseIngredientLine('2 tbsp butter, melted', 'en')).toMatchObject({ unit: 'tbsp', name: 'butter', prep: 'melted' });
		expect(parseIngredientLine('3 gousses d’ail hachées 500 g', 'fr')).toEqual({ name: '3 gousses d’ail hachées 500 g [?]' });
		// A unit word that is not an alias: kept whole with [?], never read as `piece`.
		expect(parseIngredientLine('2 cuillères à soupe de beurre', 'fr')).toEqual({ name: '2 cuillères à soupe de beurre [?]' });
		expect(parseIngredientLine('2 c à soupe d’huile', 'fr')).toEqual({ name: '2 c à soupe d’huile [?]' });
		expect(parseIngredientLine('2 tablespoons butter', 'en')).toEqual({ name: '2 tablespoons butter [?]' });
		expect(parseIngredientLine('2 carottes', 'fr')).toMatchObject({ unit: 'piece', name: 'carottes' });
		// « c. à tab. » is a tablespoon; « c. à » anything else is a spoon, never the cup « c. » alone means.
		expect(parseIngredientLine('1 c. à tab. d’huile', 'fr')).toMatchObject({ qty: { value: 1 }, unit: 'tbsp', name: 'huile' });
		expect(parseIngredientLine('1 c. à dessert de sucre', 'fr')).toEqual({ name: '1 c. à dessert de sucre [?]' });
	});

	it('imports a page into a file the checker reads, marked extracted_by: web', async () => {
		const r = await importUrl(`${base}/redirect`, vocab, { allowPrivate: true });
		expect(r.markdown).toContain('title: Galettes d\'avoine inventées');
		expect(r.markdown).toContain('extracted_by: web');
		expect(r.markdown).toContain(`url: ${base}/recipe`);
		expect(r.markdown).toContain('author: Chef Imaginaire');
		expect(r.markdown).toContain('prep: 15m');
		expect(r.markdown).toContain('servings: 24');
		expect(r.markdown).toContain('tags: [dessert, quebecois]');
		expect(r.markdown).toContain('### Pâte');
		expect(r.markdown).not.toContain('<script');
		expect(r.markdown).toContain('{ qty: 250, unit: ml, name: beurre, prep: ramolli, alt: { qty: 1, unit: cup } }');
		const check = checkRecipe(r.markdown);
		const errors = check.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);
		// The unreadable line is kept, flagged: E210 (a quantity in the name) until a person fixes it.
		expect(errors).toEqual(['E210']);
		expect(check.diagnostics.some((d) => d.code === 'W605')).toBe(true);
	});

	it('drops a page\'s step numbers but keeps a decimal that starts a step', () => {
		const ld = { '@type': 'Recipe', name: 'Purée inventée', recipeIngredient: ['2 pommes de terre'], recipeInstructions: ['1. Peler.\n2) Cuire.', { '@type': 'HowToStep', text: '1.5 kg de purée : garder au chaud.' }] };
		const { markdown } = recipeFromJsonLd(ld, 'https://example.invalid/x', 'fr', vocab);
		expect(markdown).toContain('1. Peler.\n1. Cuire.\n1. 1.5 kg de purée : garder au chaud.');
	});

	it('says so when the page has no JSON-LD', async () => {
		await expect(importUrl(`${base}/none`, vocab, { allowPrivate: true })).rejects.toThrow(/JSON-LD/);
	});
});
