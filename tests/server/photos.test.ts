// Dish photos (plan 04, Phase 6). Every image is generated here — never a
// real picture: a tiny JPEG carrying an invented EXIF block (orientation 6 and
// a made-up GPS position), a PNG, an AVIF, a fake HEIC header, a text file.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	addPhoto,
	checkUpload,
	derivedCopy,
	derivedPath,
	newPhotoName,
	PHOTO_MAX_BYTES,
	PhotoError,
	removePhoto,
	sniffPhoto
} from '../../src/lib/server/photos';
import { currentFile, save, verify } from '../../src/lib/server/save';
import { remove, restore } from '../../src/lib/server/trash';
import { checkFile } from '../../src/lib/vault/check';
import { AUTHOR, recipe, tempVault, type TempVault } from '../helpers/vault';

const TODAY = '2026-09-28';
const GPS_TEXT = 'rv-invented-gps';

/** A big-endian EXIF (TIFF) block: IFD0 with a description, orientation 6 and a GPS IFD pointer; the GPS IFD with a latitude. */
function exifBlock(): Buffer {
	const b = Buffer.alloc(120);
	b.write('MM', 0, 'latin1');
	b.writeUInt16BE(42, 2);
	b.writeUInt32BE(8, 4);
	let o = 8;
	b.writeUInt16BE(3, o);
	o += 2;
	const entry = (tag: number, type: number, count: number, value: (at: number) => void) => {
		b.writeUInt16BE(tag, o);
		b.writeUInt16BE(type, o + 2);
		b.writeUInt32BE(count, o + 4);
		value(o + 8);
		o += 12;
	};
	entry(0x010e, 2, GPS_TEXT.length + 1, (at) => b.writeUInt32BE(50, at)); // ImageDescription → 50
	entry(0x0112, 3, 1, (at) => b.writeUInt16BE(6, at)); // Orientation: rotate 90° clockwise to view
	entry(0x8825, 4, 1, (at) => b.writeUInt32BE(66, at)); // GPS IFD → 66
	b.writeUInt32BE(0, o); // no next IFD (o = 46 → 50)
	b.write(`${GPS_TEXT}\0`, 50, 'latin1'); // 16 bytes → 66
	o = 66;
	b.writeUInt16BE(2, o);
	o += 2;
	entry(0x0001, 2, 2, (at) => b.write('N\0', at, 'latin1')); // GPSLatitudeRef
	entry(0x0002, 5, 3, (at) => b.writeUInt32BE(96, at)); // GPSLatitude → 96
	b.writeUInt32BE(0, o);
	[46, 1, 48, 1, 0, 1].forEach((n, i) => b.writeUInt32BE(n, 96 + i * 4));
	return b;
}

/** A 40×20 JPEG with the EXIF block spliced in after SOI. */
async function jpegWithGps(): Promise<Buffer> {
	const plain = await sharp({ create: { width: 40, height: 20, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg().toBuffer();
	const tiff = exifBlock();
	const app1 = Buffer.alloc(4);
	app1.writeUInt16BE(0xffe1, 0);
	app1.writeUInt16BE(2 + 6 + tiff.length, 2);
	return Buffer.concat([plain.subarray(0, 2), app1, Buffer.from('Exif\0\0', 'latin1'), tiff, plain.subarray(2)]);
}

const png = () => sharp({ create: { width: 3000, height: 1000, channels: 4, background: '#3a7' } }).png().toBuffer();
const fakeHeic = () =>
	Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic', 'latin1'), Buffer.alloc(4), Buffer.from('mif1heic', 'latin1'), Buffer.alloc(64, 7)]);

let v: TempVault;
let hash: string;
const log = () => v.git('log', '--format=%s|%an').trim().split('\n');
const media = (slug = 'galettes') => (existsSync(join(v.dir, 'media', slug)) ? readdirSync(join(v.dir, 'media', slug)) : []);
const final = (slug = 'galettes') => checkFile(v.read(`recipes/${slug}.md`)).recipe!.media?.final;

beforeEach(async () => {
	v = await tempVault();
	await save(v.ctx, [{ text: recipe('Galettes') }], { today: '2026-09-01' });
	hash = currentFile(v.ctx, 'galettes')!.hash;
});
afterEach(() => v.cleanup());

describe('type by content', () => {
	it('knows JPEG, PNG, WebP, AVIF and HEIC by their bytes, and nothing by the name', async () => {
		const blank = sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } });
		expect(sniffPhoto(await jpegWithGps())).toBe('jpeg');
		expect(sniffPhoto(await png())).toBe('png');
		expect(sniffPhoto(await blank.clone().webp().toBuffer())).toBe('webp');
		expect(sniffPhoto(await blank.clone().avif().toBuffer())).toBe('avif');
		expect(sniffPhoto(fakeHeic())).toBe('heic');
		expect(sniffPhoto(Buffer.from('this is not a photo, whatever its name says'))).toBeNull();
		expect(sniffPhoto(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
		expect(sniffPhoto(Buffer.alloc(0))).toBeNull();
	});

	it('refuses empty, too big, and unknown types', () => {
		expect(() => checkUpload(Buffer.alloc(0))).toThrow(expect.objectContaining({ reason: 'empty' }));
		const big = Buffer.alloc(PHOTO_MAX_BYTES + 1);
		big.set([0xff, 0xd8, 0xff]);
		expect(() => checkUpload(big)).toThrow(expect.objectContaining({ reason: 'too-big' }));
		expect(() => checkUpload(Buffer.from('GIF89a…'))).toThrow(expect.objectContaining({ reason: 'type' }));
	});

	it('names a new original final-<date>-<n>.<ext>, never an existing one', () => {
		expect(newPhotoName(join(v.dir, 'media', 'nope'), TODAY, 'jpg')).toBe(`final-${TODAY}-1.jpg`);
		const dir = join(v.dir, 'media');
		writeFileSync(join(dir, `final-${TODAY}-1.png`), 'x');
		expect(newPhotoName(dir, TODAY, 'jpg')).toBe(`final-${TODAY}-2.jpg`);
	});
});

describe('addPhoto', () => {
	it('keeps the original byte for byte, sets media.final in one commit, derives rotated copies without metadata', async () => {
		const jpg = await jpegWithGps();
		const meta = await sharp(jpg).metadata();
		expect(meta.orientation).toBe(6);
		expect(meta.exif).toBeDefined();

		const r = await addPhoto(v.ctx, 'galettes', hash, jpg, { today: TODAY });
		const file = `final-${TODAY}-1.jpg`;
		expect(r).toMatchObject({ file, placeholder: false });
		expect(r.commit).toMatch(/^[0-9a-f]{40}$/);
		expect(readFileSync(join(v.dir, 'media/galettes', file)).equals(jpg)).toBe(true);
		expect(final()).toBe(file);
		expect(log()[0]).toBe(`edit: Galettes|${AUTHOR.name}`);
		expect(log()).toHaveLength(3); // init, add, edit
		expect(v.git('status', '--porcelain').trim()).toBe(''); // media/ is git-ignored
		expect(v.ctx.db.prepare('SELECT photo FROM recipes WHERE slug = ?').pluck().get('galettes')).toBe(file);

		for (const variant of ['thumb', 'display'] as const) {
			const copy = readFileSync(derivedPath(v.ctx.paths, 'galettes', file, variant));
			const m = await sharp(copy).metadata();
			expect(m.format).toBe('webp');
			expect([m.width, m.height]).toEqual([20, 40]); // orientation applied: 40×20 stood up
			expect(m.exif).toBeUndefined();
			expect(m.xmp).toBeUndefined();
			expect(m.orientation).toBeUndefined();
			expect(copy.includes(Buffer.from(GPS_TEXT))).toBe(false);
			expect(copy.includes(Buffer.from('Exif'))).toBe(false);
		}
	});

	it('scales the copies down to ~400 and ~1600 px, never up', async () => {
		const r = await addPhoto(v.ctx, 'galettes', hash, await png(), { today: TODAY });
		expect(r.file).toBe(`final-${TODAY}-1.png`);
		const size = async (variant: 'thumb' | 'display') => {
			const m = await sharp(derivedPath(v.ctx.paths, 'galettes', r.file, variant)).metadata();
			return [m.width, m.height];
		};
		expect(await size('thumb')).toEqual([400, 133]);
		expect(await size('display')).toEqual([1600, 533]);
	});

	it('keeps the status: a photo on a verified recipe leaves it verified', async () => {
		await save(v.ctx, [{ text: recipe('Tarte', 'servings: 6\n') }]);
		await verify(v.ctx, 'tarte', currentFile(v.ctx, 'tarte')!.hash);
		await addPhoto(v.ctx, 'tarte', currentFile(v.ctx, 'tarte')!.hash, await png(), { today: TODAY });
		const r = checkFile(v.read('recipes/tarte.md')).recipe!;
		expect(r.status).toBe('verified');
		expect(r.updated).toBe(TODAY);
	});

	it('stores a HEIC as received, with no derived copy (placeholder)', async () => {
		const heic = fakeHeic();
		const r = await addPhoto(v.ctx, 'galettes', hash, heic, { today: TODAY });
		expect(r).toMatchObject({ file: `final-${TODAY}-1.heic`, placeholder: true });
		expect(readFileSync(join(v.dir, 'media/galettes', r.file)).equals(heic)).toBe(true);
		expect(final()).toBe(r.file);
		expect(existsSync(join(v.dir, 'cache/img/galettes'))).toBe(false);
		expect(await derivedCopy(v.ctx.paths, 'galettes', r.file, 'display')).toBeNull();
	});

	it('writes nothing for a text file named .jpg, a corrupt JPEG, or a stale page', async () => {
		const text = Buffer.from('not an image at all');
		await expect(addPhoto(v.ctx, 'galettes', hash, text)).rejects.toMatchObject({ reason: 'type' });
		const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
		await expect(addPhoto(v.ctx, 'galettes', hash, corrupt)).rejects.toMatchObject({ reason: 'unreadable' });
		await expect(addPhoto(v.ctx, 'galettes', 'f'.repeat(64), await png())).rejects.toMatchObject({ reason: 'stale' });
		await expect(addPhoto(v.ctx, 'nope', hash, await png())).rejects.toMatchObject({ reason: 'gone' });
		expect(media()).toEqual([]);
		expect(existsSync(join(v.dir, 'media/nope'))).toBe(false);
		expect(existsSync(join(v.dir, 'cache/img'))).toBe(false);
		expect(final()).toBeUndefined();
		expect(currentFile(v.ctx, 'galettes')!.hash).toBe(hash);
		expect(log()).toHaveLength(2);
	});

	it('removes the new original when the commit fails', async () => {
		writeFileSync(join(v.dir, '.git/index.lock'), '');
		await expect(addPhoto(v.ctx, 'galettes', hash, await png())).rejects.toThrow(/commit failed/);
		rmSync(join(v.dir, '.git/index.lock'));
		expect(media()).toEqual([]);
		expect(currentFile(v.ctx, 'galettes')!.hash).toBe(hash);
		expect(existsSync(join(v.dir, 'cache/img'))).toBe(false);
	});

	it('replacing keeps the old original; removing unsets media.final and keeps the file', async () => {
		const a = await addPhoto(v.ctx, 'galettes', hash, await png(), { today: TODAY });
		const b = await addPhoto(v.ctx, 'galettes', currentFile(v.ctx, 'galettes')!.hash, await jpegWithGps(), { today: TODAY });
		expect(b.file).toBe(`final-${TODAY}-2.jpg`);
		expect(media().sort()).toEqual([a.file, b.file]);
		expect(final()).toBe(b.file);
		await removePhoto(v.ctx, 'galettes', currentFile(v.ctx, 'galettes')!.hash);
		expect(final()).toBeUndefined();
		expect(v.read('recipes/galettes.md')).not.toContain('media:');
		expect(media().sort()).toEqual([a.file, b.file]);
		expect(log()[0]).toBe(`edit: Galettes|${AUTHOR.name}`);
		await expect(removePhoto(v.ctx, 'galettes', hash)).rejects.toBeInstanceOf(PhotoError);
	});

	it('keeps other media keys', async () => {
		await save(v.ctx, [{ text: recipe('Tarte', 'media:\n  card: carte.jpg\n') }]);
		await addPhoto(v.ctx, 'tarte', currentFile(v.ctx, 'tarte')!.hash, await png(), { today: TODAY });
		expect(checkFile(v.read('recipes/tarte.md')).recipe!.media).toEqual({ card: 'carte.jpg', final: `final-${TODAY}-1.png` });
	});
});

describe('derived copies on demand', () => {
	it('regenerates after cache/ is deleted, and after the original is replaced by hand', async () => {
		const r = await addPhoto(v.ctx, 'galettes', hash, await png(), { today: TODAY });
		rmSync(v.ctx.paths.cache + '/img', { recursive: true });
		const [thumb, again] = await Promise.all([
			derivedCopy(v.ctx.paths, 'galettes', r.file, 'thumb'),
			derivedCopy(v.ctx.paths, 'galettes', r.file, 'thumb')
		]);
		expect(thumb).toBe(derivedPath(v.ctx.paths, 'galettes', r.file, 'thumb'));
		expect(again).toBe(thumb);
		expect((await sharp(thumb!).metadata()).width).toBe(400);
		expect(existsSync(derivedPath(v.ctx.paths, 'galettes', r.file, 'display'))).toBe(false); // only what was asked

		// Obsidian or a file manager replaced the original: the copy follows.
		await new Promise((res) => setTimeout(res, 20));
		writeFileSync(join(v.dir, 'media/galettes', r.file), await sharp({ create: { width: 100, height: 100, channels: 3, background: '#000' } }).png().toBuffer());
		expect((await sharp(readFileSync((await derivedCopy(v.ctx.paths, 'galettes', r.file, 'thumb'))!)).metadata()).width).toBe(100);
	});

	it('never leaves media/<slug>/: bad slugs, bad names, HEIC, missing files give null', async () => {
		await addPhoto(v.ctx, 'galettes', hash, await png(), { today: TODAY });
		for (const [slug, file] of [
			['..', 'galettes'],
			['galettes', '../galettes.md'],
			['galettes', '..%2Fx.png'],
			['galettes', '.hidden.png'],
			['galettes', 'final.txt'],
			['galettes', 'missing.png'],
			['galettes', 'final.heic'],
			['Galettes', `final-${TODAY}-1.png`]
		])
			expect(await derivedCopy(v.ctx.paths, slug, file, 'display'), `${slug}/${file}`).toBeNull();
	});

	it('an unreadable original gives null, logged, and no copy', async () => {
		const logged: string[] = [];
		const dir = join(v.dir, 'media/galettes');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'final.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0, 1, 2]));
		expect(await derivedCopy(v.ctx.paths, 'galettes', 'final.jpg', 'display', (m) => logged.push(m))).toBeNull();
		expect(logged).toHaveLength(1);
		expect(existsSync(derivedPath(v.ctx.paths, 'galettes', 'final.jpg', 'display'))).toBe(false);
	});
});

describe('trash', () => {
	it('moves the media folder, drops the derived copies, and restore brings the photo back', async () => {
		const r = await addPhoto(v.ctx, 'galettes', hash, await png(), { today: TODAY });
		await remove(v.ctx, 'galettes');
		expect(existsSync(join(v.dir, '_trash/galettes', r.file))).toBe(true);
		expect(existsSync(join(v.dir, 'cache/img/galettes'))).toBe(false);
		expect(await derivedCopy(v.ctx.paths, 'galettes', r.file, 'display')).toBeNull();
		await restore(v.ctx, 'galettes');
		expect(await derivedCopy(v.ctx.paths, 'galettes', r.file, 'display')).toBe(derivedPath(v.ctx.paths, 'galettes', r.file, 'display'));
	});
});
