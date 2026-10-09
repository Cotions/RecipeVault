// Web import (plan 02, decision 7): URL → schema.org `Recipe` JSON-LD → a
// Markdown file placed in the paste box for review, never saved directly.
// Fetched server-side: http/https only, 10 s, 5 MB, and never a host that
// resolves to a private, loopback or link-local address — checked on the
// address actually connected to, for every redirect.

import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { Readable } from 'node:stream';
import { parseBody } from '../vault/body';
import { parseDuration } from '../vault/duration';
import { stripMarkers } from '../vault/markers';
import { fold, normalizeText } from '../vault/normalize';
import { parseQuantity } from '../vault/quantity';
import { serialize } from '../vault/serialize';
import { slugify } from '../vault/slug';
import type { Ingredient, Lang, Quantity, Recipe, Unit } from '../vault/types';
import { EXTRACTED_BY, UNIT_ALIASES, findQtyUnit, unitForAlias } from '../vault/vocab';
import { UNITS } from '../vault/types';
import { canonicalTag, type VaultVocab } from './vocab';

export class ImportError extends Error {}

export const LIMITS = { timeoutMs: 10_000, maxBytes: 5 * 1024 * 1024, maxRedirects: 5 };

// --- address checks ----------------------------------------------------------

function v4ToInt(ip: string): number {
	return ip.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
}

const V4_BLOCKED: [string, number][] = [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10], // CGNAT — Tailscale addresses live here
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 4],
	['240.0.0.0', 4]
];

/** An IPv6 address as 8 16-bit groups (an embedded dotted quad included), or undefined. */
function v6Groups(ip: string): number[] | undefined {
	let a = ip.toLowerCase().replace(/%.*$/, ''); // zone id
	const quad = a.match(/(\d+\.\d+\.\d+\.\d+)$/);
	if (quad) {
		if (isIP(quad[1]) !== 4) return undefined;
		const n = v4ToInt(quad[1]);
		a = a.slice(0, -quad[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
	}
	const halves = a.split('::');
	if (halves.length > 2) return undefined;
	const part = (s: string) => (s ? s.split(':').map((g) => parseInt(g, 16)) : []);
	const head = part(halves[0]);
	const tail = halves.length === 2 ? part(halves[1]) : [];
	const fill = 8 - head.length - tail.length;
	if (halves.length === 1 ? fill !== 0 : fill < 0) return undefined;
	const groups = [...head, ...Array(fill).fill(0), ...tail];
	return groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : undefined;
}

const v4Of = (hi: number, lo: number) => `${hi >>> 8}.${hi & 0xff}.${lo >>> 8}.${lo & 0xff}`;

/**
 * True for any address the server must not fetch from. IPv6 is normalised
 * first, so an IPv4 address embedded in any form (`::ffff:7f00:1`,
 * `::ffff:127.0.0.1`, `::127.0.0.1`, NAT64, 6to4) is checked as IPv4.
 */
export function isBlockedAddress(ip: string): boolean {
	const kind = isIP(ip);
	if (kind === 4) {
		const n = v4ToInt(ip);
		return V4_BLOCKED.some(([base, bits]) => (n >>> (32 - bits)) === (v4ToInt(base) >>> (32 - bits)));
	}
	if (kind === 6) {
		const g = v6Groups(ip);
		if (!g) return true;
		const zero = (n: number) => g.slice(0, n).every((x) => x === 0);
		// ::/96 (IPv4-compatible, :: and ::1 included), ::ffff:0:0/96 (mapped), ::ffff:0:0:0/96 (translated)
		if (zero(6) || (zero(5) && g[5] === 0xffff) || (zero(4) && g[4] === 0xffff && g[5] === 0)) return isBlockedAddress(v4Of(g[6], g[7])) || zero(6);
		if (g[0] === 0x64 && g[1] === 0xff9b) return true; // 64:ff9b::/96 and /48 NAT64
		if (g[0] === 0x2002) return isBlockedAddress(v4Of(g[1], g[2])); // 6to4
		if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
		if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
		if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
		if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
		if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
		if ((g[0] & 0xff00) === 0xff00) return true; // multicast
		return false;
	}
	return true;
}

/** A DNS lookup that refuses blocked addresses — used for the actual connection. */
function safeLookup(
	hostname: string,
	options: object,
	callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void
): void {
	dnsLookup(hostname, { all: true }, (err, addresses) => {
		if (err) return callback(err, '');
		const list = addresses as LookupAddress[];
		if (!list.length || list.some((a) => isBlockedAddress(a.address))) {
			const e = new Error(`${hostname} resolves to a private or local address`) as NodeJS.ErrnoException;
			e.code = 'EBLOCKED';
			return callback(e, '');
		}
		if ((options as { all?: boolean }).all) return callback(null, list);
		callback(null, list[0].address, list[0].family);
	});
}

export function checkUrl(raw: string): URL {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		throw new ImportError('adresse invalide');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ImportError('seules les adresses http et https sont acceptées');
	if (url.username || url.password) throw new ImportError('adresse avec identifiants refusée');
	const host = url.hostname.replace(/^\[|\]$/g, '');
	if (isIP(host) && isBlockedAddress(host)) throw new ImportError('adresse locale ou privée refusée');
	if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new ImportError('adresse locale ou privée refusée');
	return url;
}

// --- fetch -------------------------------------------------------------------

export interface FetchOptions {
	timeoutMs?: number;
	maxBytes?: number;
	/** Tests only: skip the address check (to reach a local test server). */
	allowPrivate?: boolean;
}

export async function fetchPage(raw: string, opts: FetchOptions = {}): Promise<{ url: string; html: string }> {
	const timeoutMs = opts.timeoutMs ?? LIMITS.timeoutMs;
	const maxBytes = opts.maxBytes ?? LIMITS.maxBytes;
	const deadline = Date.now() + timeoutMs;
	let url = opts.allowPrivate ? new URL(raw) : checkUrl(raw);
	for (let hop = 0; hop <= LIMITS.maxRedirects; hop++) {
		const res = await request(url, deadline, maxBytes, !!opts.allowPrivate);
		if (res.redirect) {
			url = opts.allowPrivate ? new URL(res.redirect, url) : checkUrl(new URL(res.redirect, url).href);
			continue;
		}
		return { url: url.href, html: res.body! };
	}
	throw new ImportError('trop de redirections');
}

/**
 * One hop. `deadline` bounds the whole fetch — connection, headers and body —
 * not only the time between two packets: a page that drips a byte at a time
 * is cut off at the deadline like one that never answers.
 */
function request(url: URL, deadline: number, maxBytes: number, allowPrivate: boolean): Promise<{ redirect?: string; body?: string }> {
	const timeoutMs = Math.max(1, deadline - Date.now());
	return new Promise((resolve, reject) => {
		let stream: Readable | undefined;
		const timer = setTimeout(() => {
			const e = new ImportError('délai dépassé (10 s)');
			stream?.destroy();
			req.destroy(e);
			reject(e);
		}, timeoutMs);
		const done = <T>(fn: (v: T) => void) => (v: T) => {
			clearTimeout(timer);
			fn(v);
		};
		resolve = done(resolve);
		reject = done(reject);
		const lib = url.protocol === 'https:' ? https : http;
		const req = lib.request(
			url,
			{
				method: 'GET',
				lookup: allowPrivate ? undefined : (safeLookup as unknown as typeof dnsLookup),
				headers: {
					'User-Agent': 'RecipeVault/1 (recipe import; +self-hosted)',
					Accept: 'text/html,application/xhtml+xml',
					'Accept-Encoding': 'gzip, deflate, br',
					'Accept-Language': 'fr-CA,fr;q=0.9,en;q=0.8'
				},
				timeout: timeoutMs
			},
			(res) => {
				const status = res.statusCode ?? 0;
				if (status >= 300 && status < 400 && res.headers.location) {
					res.resume();
					return resolve({ redirect: res.headers.location });
				}
				if (status < 200 || status >= 300) {
					res.resume();
					return reject(new ImportError(`le site a répondu ${status}`));
				}
				const type = String(res.headers['content-type'] ?? '');
				if (type && !/html|xml/i.test(type)) {
					res.resume();
					return reject(new ImportError('la page n’est pas du HTML'));
				}
				if (Number(res.headers['content-length'] ?? 0) > maxBytes) {
					res.destroy();
					return reject(new ImportError('page trop volumineuse (plus de 5 Mo)'));
				}
				const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
				let body: Readable = res;
				if (enc === 'gzip') body = res.pipe(createGunzip());
				else if (enc === 'deflate') body = res.pipe(createInflate());
				else if (enc === 'br') body = res.pipe(createBrotliDecompress());
				stream = body;
				const chunks: Buffer[] = [];
				let size = 0;
				body.on('data', (c: Buffer) => {
					size += c.length;
					if (size > maxBytes) {
						req.destroy();
						body.destroy();
						reject(new ImportError('page trop volumineuse (plus de 5 Mo)'));
						return;
					}
					chunks.push(c);
				});
				body.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8') }));
				body.on('error', (e) => reject(new ImportError(`lecture impossible : ${e.message}`)));
			}
		);
		req.on('timeout', () => req.destroy(new ImportError('délai dépassé (10 s)')));
		req.on('error', (e: NodeJS.ErrnoException) =>
			reject(e instanceof ImportError ? e : new ImportError(e.code === 'EBLOCKED' ? 'adresse locale ou privée refusée' : `connexion impossible : ${e.message}`))
		);
		req.end();
	});
}

// --- JSON-LD -----------------------------------------------------------------

const NAMED: Record<string, string> = {
	amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
	agrave: 'à', acirc: 'â', ccedil: 'ç', icirc: 'î', iuml: 'ï', ocirc: 'ô', ugrave: 'ù', ucirc: 'û', oelig: 'œ',
	Eacute: 'É', frac12: '½', frac14: '¼', frac34: '¾', deg: '°', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', ndash: '–', mdash: '—'
};

export function decodeEntities(s: string): string {
	return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
		if (e[0] === '#') {
			const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
		}
		return NAMED[e] ?? m;
	});
}

/** Plain text from an HTML-ish string: tags dropped, entities decoded, spaces collapsed. */
export function plain(s: unknown): string {
	if (typeof s !== 'string') return typeof s === 'number' ? String(s) : '';
	// Every pattern here matches in one pass: a hostile page (5 MB of `<`) must not stall the server.
	return decodeEntities(s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^<>]*>/g, ' '))
		.replace(/[ \t ]+/g, ' ')
		.replace(/\s+/g, (w) => (w.includes('\n') ? '\n' : w))
		.trim();
}

type LD = Record<string, unknown>;

const isType = (o: LD, t: string) => {
	const ty = o['@type'];
	return ty === t || (Array.isArray(ty) && ty.includes(t));
};

/** Every `Recipe` object in the page's JSON-LD blocks (inside @graph and arrays too). */
export function findRecipes(html: string): LD[] {
	const out: LD[] = [];
	const visit = (v: unknown) => {
		if (Array.isArray(v)) v.forEach(visit);
		else if (v && typeof v === 'object') {
			const o = v as LD;
			if (isType(o, 'Recipe')) out.push(o);
			else if (o['@graph']) visit(o['@graph']);
			else if (o.mainEntity) visit(o.mainEntity);
		}
	};
	const close = /<\/script>/gi;
	for (const tag of openTags(html, 'script')) {
		if (!/\btype\s*=\s*["']?application\/ld\+json\b/i.test(tag.attrs)) continue;
		close.lastIndex = tag.end;
		const end = close.exec(html);
		if (!end) break;
		try {
			visit(JSON.parse(html.slice(tag.end, end.index).trim()));
		} catch {
			// a broken block on the page: skip it
		}
	}
	return out;
}

/**
 * Each opening `<name …>` tag on the page: its attribute text and where it
 * ends. Found with indexOf, not one regex, so a page of unclosed tags is read
 * once instead of once per tag.
 */
function* openTags(html: string, name: string): Generator<{ attrs: string; end: number }> {
	const open = new RegExp(`<${name}(?=[\\s/>])`, 'gi');
	let m: RegExpExecArray | null;
	while ((m = open.exec(html))) {
		const gt = html.indexOf('>', open.lastIndex);
		if (gt < 0) return;
		yield { attrs: html.slice(open.lastIndex, gt), end: gt + 1 };
		open.lastIndex = gt + 1;
	}
}

/** ISO 8601 duration → the file's format: PT1H30M → 1h30m. */
export function isoDuration(v: unknown): string | undefined {
	if (typeof v !== 'string') return undefined;
	const m = v.trim().match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+(?:\.\d+)?S)?)?$/i);
	if (!m) return undefined;
	const minutes = Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
	if (!minutes) return undefined;
	const h = Math.floor(minutes / 60);
	const min = minutes % 60;
	return h && min ? `${h}h${min}m` : h ? `${h}h` : `${min}m`;
}

// --- ingredient lines --------------------------------------------------------

const VULGAR: Record<string, string> = { '½': '1/2', '¼': '1/4', '¾': '3/4', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8' };
const QTY_SRC = String.raw`\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?\s*[½¼¾⅓⅔⅛]|\d+(?:[.,]\d+)?|[½¼¾⅓⅔⅛]`;
const LEAD_RE = new RegExp(String.raw`^(${QTY_SRC})(?:\s*(?:-|–|à|to|ou|or)\s*(${QTY_SRC}))?\s*(.*)$`, 'u');
const ALIASES = [...new Set(UNITS.flatMap((u) => UNIT_ALIASES[u]))].sort((a, b) => b.length - a.length);

/** A quantity as the file writes it: numbers plain, fractions as quoted strings. */
function toQuantity(s: string): Quantity | undefined {
	let t = s.trim().replace(/(\d)\s*([½¼¾⅓⅔⅛])/, '$1 $2');
	t = t.replace(/[½¼¾⅓⅔⅛]/, (g) => VULGAR[g]);
	const raw: number | string = /^\d+(?:[.,]\d+)?$/.test(t) ? Number(t.replace(',', '.')) : t;
	const p = parseQuantity(raw);
	return p.ok ? { raw, value: p.value } : undefined;
}

function leadingUnit(rest: string, lang: Lang): { unit: Unit; rest: string } | undefined {
	for (const alias of ALIASES) {
		if (!rest.toLowerCase().startsWith(alias.toLowerCase())) continue;
		const after = rest.slice(alias.length);
		if (after && !/^[\s.,)]/.test(after)) continue;
		const unit = unitForAlias(rest.slice(0, alias.length), lang);
		if (unit) return { unit, rest: after.replace(/^\.?\s*/, '') };
	}
	return undefined;
}

/** A word folded for the measure-word test: no accents, no trailing dot, no plural s/x. */
const measureKey = (w: string) => {
	const f = fold(w).replace(/\.+$/, '');
	return f.length > 2 ? f.replace(/[sx]$/, '') : f;
};
/** First words of every unit alias, plus spellings that are not aliases but still a measure. */
const MEASURE_WORDS = new Set(
	[...ALIASES.map((a) => a.split(/\s+/)[0]), 'cuillère', 'cuillerée', 'cuiller', 'cuil', 'c', 'cs', 'ct', 'tbs', 'tbl'].map(measureKey)
);

/** The line reads like "<qty> <a unit word we cannot place> …": defaulting to `piece` would be a guess. */
function looksLikeUnit(rest: string): boolean {
	const word = rest.match(/^[^\s,()]+/)?.[0];
	return !!word && MEASURE_WORDS.has(measureKey(word));
}

/**
 * "farine (tamisée)" → name and note: the "(…)" that ends the text, from the
 * first "(" after any earlier ")". Found by index; the regex this replaces went
 * quadratic on a line of "(".
 */
function trailingNote(s: string): { name: string; note: string } | undefined {
	const t = s.trimEnd();
	if (!t.endsWith(')')) return;
	const close = t.length - 1;
	const open = t.indexOf('(', t.lastIndexOf(')', close - 1) + 1);
	if (open < 0 || open >= close) return;
	const name = t.slice(0, open).trimEnd();
	return name ? { name, note: t.slice(open + 1, close).trim() } : undefined;
}

/**
 * One ingredient line from a web page → an entry. A line that does not read
 * cleanly becomes `{ name: "<the whole line> [?]" }` so the checker flags it
 * for review instead of losing it.
 */
export function parseIngredientLine(line: string, lang: Lang): Ingredient {
	const text = plain(line).replace(/\s+/g, ' ').trim();
	const fallback: Ingredient = { name: `${text} [?]` };
	const lead = text.match(LEAD_RE);
	let it: Ingredient;
	if (!lead) {
		it = { name: text };
	} else {
		const qty = toQuantity(lead[1]);
		const qtyMax = lead[2] ? toQuantity(lead[2]) : undefined;
		if (!qty || (lead[2] && (!qtyMax || qtyMax.value <= qty.value))) return fallback;
		let rest = lead[3];
		const u = leadingUnit(rest, lang);
		if (!u && looksLikeUnit(rest)) return fallback;
		// "c." alone is a cup, but "c. à …" is a spoon this list does not know: not a cup.
		if (u?.unit === 'cup' && /^à\s/i.test(u.rest)) return fallback;
		it = { name: '', qty, unit: u?.unit ?? 'piece' };
		if (qtyMax) it.qtyMax = qtyMax;
		rest = u ? u.rest : rest;
		// "1 tasse (250 ml) de farine": the metric one goes in qty/unit, the other in alt.
		const paren = rest.match(/^\(([^)]*)\)\s*(.*)$/);
		if (paren) {
			const inner = paren[1].match(LEAD_RE);
			const innerUnit = inner ? leadingUnit(inner[3], lang) : undefined;
			const innerQty = inner ? toQuantity(inner[1]) : undefined;
			if (inner && innerUnit && innerQty && !innerUnit.rest && !inner[2]) {
				const metric = (['g', 'kg', 'ml', 'cl', 'l'] as Unit[]).includes(innerUnit.unit);
				if (metric && u) {
					it.alt = { qty: it.qty!, unit: it.unit! };
					it.qty = innerQty;
					it.unit = innerUnit.unit;
					if (it.qtyMax) {
						it.alt.qtyMax = it.qtyMax;
						delete it.qtyMax;
					}
				} else it.alt = { qty: innerQty, unit: innerUnit.unit };
				rest = paren[2];
			}
		}
		rest = rest.replace(/^(?:de |d['’]|of )/i, '');
		it.name = rest;
	}
	// A trailing "(…)" is a note; ", …" is the preparation.
	const note = trailingNote(it.name);
	if (note) {
		it.name = note.name;
		it.note = note.note;
	}
	const comma = it.name.indexOf(',');
	if (comma > 0) {
		it.prep = it.name.slice(comma + 1).trim();
		it.name = it.name.slice(0, comma).trim();
	}
	it.name = it.name.trim();
	if (!it.name || findQtyUnit(it.name) || (it.prep !== undefined && !it.prep)) return fallback;
	if (it.note && findQtyUnit(it.note) && it.unit && !['piece', 'can', 'packet', 'bottle', 'jar', 'bag'].includes(it.unit)) return fallback;
	return it;
}

// --- mapping -----------------------------------------------------------------

function list(v: unknown): unknown[] {
	return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
}

function nameOf(v: unknown): string | undefined {
	for (const x of list(v)) {
		if (typeof x === 'string' && x.trim()) return plain(x);
		if (x && typeof x === 'object' && typeof (x as LD).name === 'string') return plain((x as LD).name);
	}
	return undefined;
}

/** Instructions → Markdown steps, `###` for HowToSection names. */
function steps(v: unknown): string[] {
	const out: string[] = [];
	const visit = (x: unknown) => {
		if (typeof x === 'string') {
			for (const line of plain(x).split('\n')) {
				// The page's own step number goes ("2." or "2)"); "1.5 kg" is a quantity and stays.
				const t = line.replace(/^\s*\d+[.)](?=\s|$)\s*/, '').trim();
				if (t) out.push(`1. ${t}`);
			}
		} else if (Array.isArray(x)) x.forEach(visit);
		else if (x && typeof x === 'object') {
			const o = x as LD;
			if (isType(o, 'HowToSection')) {
				if (typeof o.name === 'string' && o.name.trim()) out.push('', `### ${plain(o.name)}`);
				visit(o.itemListElement);
			} else visit(o.text ?? o.name ?? o.itemListElement);
		}
	};
	visit(v);
	return out;
}

/** Markers are not allowed from the web: a `[` in scraped text would read as one. */
const clean = (s: string) => stripMarkers(s).replace(/\[/g, '(').replace(/\]/g, ')');

export interface ImportResult {
	markdown: string;
	title: string;
}

export function recipeFromJsonLd(ld: LD, pageUrl: string, htmlLang: string | undefined, vocab: VaultVocab): ImportResult {
	const inLang = typeof ld.inLanguage === 'string' ? ld.inLanguage : htmlLang;
	const lang: Lang = inLang && /^en/i.test(inLang) ? 'en' : 'fr';
	const title = clean(plain(ld.name) || plain(ld.headline) || 'Recette importée') || 'Recette importée';
	const ingredients: Ingredient[] = list(ld.recipeIngredient ?? ld.ingredients)
		.map((l) => plain(l))
		.filter(Boolean)
		.map((l) => parseIngredientLine(clean(l), lang));
	// Two identical names in one group are an error (E209); number the repeats for review.
	const seen = new Map<string, number>();
	for (const it of ingredients) {
		const k = it.name.toLowerCase();
		const n = seen.get(k) ?? 0;
		seen.set(k, n + 1);
		if (n) it.name = `${it.name} (${n + 1}) [?]`;
	}

	const recipe: Recipe = {
		schema: 3,
		title,
		slug: slugify(title) || 'recette-importee',
		slugDerived: false,
		lang,
		tags: [],
		season: [],
		ingredients: [{ items: ingredients.length ? ingredients : [{ name: 'ingrédients introuvables [?]' }] }],
		markers: [],
		extractedBy: 'web' satisfies (typeof EXTRACTED_BY)[number]
	};
	const author = nameOf(ld.author);
	const site = nameOf(ld.publisher);
	recipe.source = { type: 'website', url: pageUrl };
	if (author) recipe.source.author = clean(author);
	if (site && site !== author) recipe.source.title = clean(site);

	const times: Recipe['times'] = {};
	for (const [k, key] of [
		['prep', 'prepTime'],
		['cook', 'cookTime'],
		['total', 'totalTime']
	] as const) {
		const d = parseDuration(isoDuration(ld[key]));
		if (d) times[k] = d;
	}
	if (Object.keys(times).length) recipe.times = times;

	const y = list(ld.recipeYield).map((x) => plain(x)).filter(Boolean);
	const servings = y.map((s) => s.match(/^(\d+)(?:\s*(?:portions?|servings?|personnes?|people|parts?))?$/i)).find(Boolean);
	if (servings) recipe.servings = Number(servings[1]);
	else if (y.length) recipe.yield = clean(y[0]);

	const words = [
		...list(ld.keywords).flatMap((k) => (typeof k === 'string' ? k.split(',') : [])),
		...list(ld.recipeCategory),
		...list(ld.recipeCuisine)
	]
		.map((k) => plain(k))
		.filter(Boolean);
	const tags = new Set<string>();
	for (const w of words) {
		const c = canonicalTag(vocab, w);
		if (!c.pending) tags.add(c.tag);
	}
	recipe.tags = [...tags].slice(0, 6);

	const heading = lang === 'en' ? 'Instructions' : 'Préparation';
	const method = steps(ld.recipeInstructions).map(clean);
	const bodyText = `## ${heading}\n\n${method.length ? method.join('\n').trim() : '1. [?]'}\n`;
	const markdown = serialize(recipe, parseBody(normalizeText(bodyText)).body);
	return { markdown, title };
}

export async function importUrl(raw: string, vocab: VaultVocab, opts: FetchOptions = {}): Promise<ImportResult> {
	const { url, html } = await fetchPage(raw, opts);
	const recipes = findRecipes(html);
	if (!recipes.length)
		throw new ImportError('aucune recette structurée (JSON-LD) sur cette page. Faites une capture de la page et passez par l’IA avec le prompt.');
	const lang = openTags(html, 'html').next().value?.attrs.match(/\blang=["']?([a-zA-Z-]+)/i)?.[1];
	return recipeFromJsonLd(recipes[0], url, lang, vocab);
}
