// Dish photos (plan 04, Phase 6; Q12 A): one per recipe, `media.final`.
//
// - The original is stored in `media/<slug>/` exactly as received — never
//   resized, recompressed or stripped (docs/STORAGE.md, "Media") — under a new
//   name each time (`final-<date>-<n>.<ext>`), so a replaced photo is never
//   overwritten and an older version of the recipe still finds its own.
// - What a browser gets is derived into `cache/img/<slug>/`: a thumbnail and a
//   display copy, WebP, EXIF rotation applied, every metadata block (EXIF, GPS,
//   XMP, ICC) dropped. Made on upload and again on demand when missing, so
//   deleting `cache/` loses nothing. The original is never served.
// - Type by content (magic bytes), never by the name; 25 MB cap. HEIC is stored
//   but not decoded (the prebuilt sharp has no HEVC decoder): the page shows a
//   placeholder, as before.
// - `media/` is not in git: the recipe's `media.final` change is the one
//   commit; the original is written under the same lock just before it and
//   removed again if that commit fails.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { VaultContext } from './context';
import type { VaultPaths } from './vault';
import { EditError, editRecipeLocked, localDate, type SaveOptions } from './save';
import { SLUG_RE } from '../vault/slug';

// Every input is a buffer read once: libvips' operation cache would only hold memory.
sharp.cache(false);

export const PHOTO_MAX_BYTES = 25 * 1024 * 1024;

export type PhotoType = 'jpeg' | 'png' | 'webp' | 'avif' | 'heic';

export const PHOTO_EXT: Record<PhotoType, string> = { jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif', heic: 'heic' };

/** Longest side, in pixels, of each derived copy. */
export const VARIANTS = { thumb: 400, display: 1600 } as const;
export type Variant = keyof typeof VARIANTS;

/** A media file name the app will touch: one path segment, no dot first, a known image extension. */
export const MEDIA_FILE_RE = /^[\w][\w.-]*\.(jpe?g|png|webp|avif|gif|hei[cf])$/i;

/** HEIC/HEIF: stored and kept, never decoded (placeholder instead). */
export const isHeic = (file: string) => /\.hei[cf]$/i.test(file);

export class PhotoError extends Error {
	constructor(
		readonly reason: 'empty' | 'too-big' | 'type' | 'unreadable' | 'gone' | 'stale' | 'invalid',
		message: string
	) {
		super(message);
	}
}

const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs', 'mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

/** The image type by its first bytes, or null. The file name plays no part. */
export function sniffPhoto(b: Uint8Array): PhotoType | null {
	const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
	if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
	if (b.length >= 8 && b[0] === 0x89 && ascii(1, 8) === 'PNG\r\n\x1a\n') return 'png';
	if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
	// ISO base media file: [size][ftyp][major brand][minor version][compatible brands…]
	if (b.length >= 16 && ascii(4, 8) === 'ftyp') {
		const size = Math.min(b.length, ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0 || 16);
		const brands = [ascii(8, 12)];
		for (let i = 16; i + 4 <= size; i += 4) brands.push(ascii(i, i + 4));
		// AVIF first: an AVIF file often lists mif1 too.
		if (brands.some((x) => AVIF_BRANDS.has(x))) return 'avif';
		if (brands.some((x) => HEIC_BRANDS.has(x))) return 'heic';
	}
	return null;
}

/** Both derived copies of a decodable image: rotated per EXIF, WebP, no metadata. Throws on an image sharp cannot read. */
export async function deriveCopies(input: Buffer): Promise<Record<Variant, Buffer>> {
	const out = {} as Record<Variant, Buffer>;
	for (const v of Object.keys(VARIANTS) as Variant[]) out[v] = await deriveOne(input, v);
	return out;
}

function deriveOne(input: Buffer, v: Variant): Promise<Buffer> {
	// sharp writes no metadata unless asked (withMetadata / keepExif), so the
	// copy carries neither EXIF nor GPS; rotate() with no angle applies the
	// EXIF orientation first. 100 MP is a generous camera, and a decompression
	// bomb's limit.
	return sharp(input, { limitInputPixels: 100_000_000, failOn: 'error' })
		.rotate()
		.resize(VARIANTS[v], VARIANTS[v], { fit: 'inside', withoutEnlargement: true })
		.webp({ quality: v === 'thumb' ? 75 : 82 })
		.toBuffer();
}

/** Check an upload: size and type. Returns its type; throws a PhotoError naming the refusal in French. */
export function checkUpload(bytes: Uint8Array): PhotoType {
	if (!bytes.length) throw new PhotoError('empty', 'le fichier est vide.');
	if (bytes.length > PHOTO_MAX_BYTES) throw new PhotoError('too-big', `la photo dépasse ${PHOTO_MAX_BYTES / 1024 / 1024} Mo.`);
	const type = sniffPhoto(bytes);
	if (!type) throw new PhotoError('type', 'ce fichier n’est pas une photo (JPEG, PNG, WebP, AVIF ou HEIC).');
	return type;
}

// --- where things are -------------------------------------------------------

const mediaDir = (paths: VaultPaths, slug: string) => join(paths.media, slug);
const cacheDir = (paths: VaultPaths, slug: string) => join(paths.cache, 'img', slug);

/** `cache/img/<slug>/<file>.<variant>.webp` */
export const derivedPath = (paths: VaultPaths, slug: string, file: string, v: Variant) => join(cacheDir(paths, slug), `${file}.${v}.webp`);

/** The first free `final-<date>-<n>.<ext>` in the recipe's media folder. */
export function newPhotoName(dir: string, date: string, ext: string): string {
	const taken = new Set(existsSync(dir) ? readdirSync(dir).map((f) => f.replace(/\.[^.]*$/, '')) : []);
	let n = 1;
	while (taken.has(`final-${date}-${n}`)) n++;
	return `final-${date}-${n}.${ext}`;
}

function writeCopies(paths: VaultPaths, slug: string, file: string, copies: Partial<Record<Variant, Buffer>>): void {
	mkdirSync(cacheDir(paths, slug), { recursive: true });
	for (const [v, buf] of Object.entries(copies) as [Variant, Buffer][]) {
		const abs = derivedPath(paths, slug, file, v);
		const tmp = `${abs}.${process.pid}.tmp`;
		writeFileSync(tmp, buf);
		renameSync(tmp, abs);
	}
}

// --- derived copies on demand ------------------------------------------------

const pending = new Map<string, Promise<string | null>>();
/** Originals sharp could not decode, by copy path → the original's stat stamp: refused at once until the original changes. */
const undecodable = new Map<string, string>();
const stamp = (s: { mtimeMs: number; size: number; ino: number }) => `${s.mtimeMs}:${s.size}:${s.ino}`;

/**
 * The derived copy to serve, made now if missing or older than its original
 * (a `cache/` deleted, a file replaced by hand). Null when there is nothing to
 * serve: no such original, a HEIC, or an original sharp cannot read. Two
 * requests for the same copy share one conversion.
 */
export function derivedCopy(paths: VaultPaths, slug: string, file: string, v: Variant, log: (m: string) => void = console.warn): Promise<string | null> {
	if (!SLUG_RE.test(slug) || !MEDIA_FILE_RE.test(file) || isHeic(file)) return Promise.resolve(null);
	const original = join(mediaDir(paths, slug), file);
	const out = derivedPath(paths, slug, file, v);
	let src;
	try {
		src = statSync(original);
	} catch {
		return Promise.resolve(null);
	}
	if (!src.isFile()) return Promise.resolve(null);
	if (existsSync(out) && statSync(out).mtimeMs >= src.mtimeMs) return Promise.resolve(out);
	// A corrupt original is read and decoded once, not on every request for it.
	if (undecodable.get(out) === stamp(src)) return Promise.resolve(null);
	undecodable.delete(out);
	const running = pending.get(out);
	if (running) return running;
	const job = deriveOne(readFileSync(original), v)
		.catch((e) => {
			undecodable.set(out, stamp(src));
			throw e;
		})
		.then((buf) => {
			writeCopies(paths, slug, file, { [v]: buf });
			return out;
		})
		.catch((e) => {
			log(`recipevault: could not derive ${v} of media/${slug}/${file}: ${(e as Error).message}`);
			return null;
		})
		.finally(() => pending.delete(out));
	pending.set(out, job);
	return job;
}

/** Drop every derived copy of a recipe (trash: rebuilt on demand after a restore). */
export function dropDerived(paths: VaultPaths, slug: string): void {
	if (SLUG_RE.test(slug)) rmSync(cacheDir(paths, slug), { recursive: true, force: true });
}

// --- add, remove ------------------------------------------------------------

export interface PhotoResult {
	/** The new original's name in `media/<slug>/`, now `media.final`. */
	file: string;
	commit?: string;
	/** HEIC: stored, shown as a placeholder. */
	placeholder: boolean;
}

/**
 * Store an uploaded photo as the recipe's `media.final`, in one commit (the
 * recipe file; `media/` is git-ignored). Guarded by the hash of the recipe file
 * the person saw. Refused uploads write nothing; a failed commit removes the
 * new original. The previous original stays on disk (never deleted by an edit).
 */
export async function addPhoto(ctx: VaultContext, slug: string, hash: string, bytes: Buffer, opts: SaveOptions = {}): Promise<PhotoResult> {
	if (!SLUG_RE.test(slug)) throw new PhotoError('gone', 'cette recette n’existe plus.');
	const type = checkUpload(bytes);
	// Decode before taking the lock: the slow part, and the proof the file is an image.
	let copies: Record<Variant, Buffer> | undefined;
	if (type !== 'heic') {
		try {
			copies = await deriveCopies(bytes);
		} catch {
			throw new PhotoError('unreadable', 'cette photo n’a pas pu être lue ; elle est peut-être abîmée.');
		}
	}
	const result = await ctx.lock.run(async () => {
		const dir = mediaDir(ctx.paths, slug);
		const file = newPhotoName(dir, opts.today ?? localDate(), PHOTO_EXT[type]);
		const abs = join(dir, file);
		mkdirSync(dir, { recursive: true });
		const tmp = join(dir, `.${file}.${process.pid}.tmp`);
		writeFileSync(tmp, bytes);
		renameSync(tmp, abs);
		try {
			const { commit } = await edit(ctx, slug, hash, (r) => ({ ...r, media: { ...r.media, final: file } }), opts);
			return { file, commit, placeholder: type === 'heic' };
		} catch (e) {
			rmSync(abs, { force: true });
			if (!readdirSync(dir).length) rmSync(dir, { recursive: true, force: true });
			throw e;
		}
	});
	// DATA-FLOW "SAVE" step 5, after the commit: a failure here costs nothing, the copies come back on demand.
	if (copies) {
		try {
			writeCopies(ctx.paths, slug, result.file, copies);
		} catch (e) {
			ctx.log(`recipevault: could not write the derived copies of media/${slug}/${result.file}: ${(e as Error).message}`);
		}
	}
	return result;
}

/** "Retirer la photo": unset `media.final`. The original stays in `media/<slug>/`. */
export function removePhoto(ctx: VaultContext, slug: string, hash: string, opts: SaveOptions = {}): Promise<{ commit?: string }> {
	return ctx.lock.run(() =>
		edit(
			ctx,
			slug,
			hash,
			(r) => {
				const { final: _drop, ...rest } = r.media ?? {};
				return { ...r, media: Object.keys(rest).length ? rest : undefined };
			},
			opts
		)
	);
}

async function edit(...args: Parameters<typeof editRecipeLocked>) {
	try {
		return await editRecipeLocked(...args);
	} catch (e) {
		if (e instanceof EditError) throw new PhotoError(e.reason, e.message);
		throw e;
	}
}
