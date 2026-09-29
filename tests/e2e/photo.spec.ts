// Dish photos (plan 04, Phase 6), on a phone: "Ajouter une photo" on a recipe
// without one, the display copy on the page, the thumbnail on the card. The
// photo is generated here (sharp), never a real picture. Only derived WebP
// copies are served; the original never is.
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { devices, expect, test } from '@playwright/test';
import sharp from 'sharp';
import { FIXTURE_USERS } from '../../scripts/fixture-vault';

const VAULT = '/tmp/rv-e2e/vault';
const { defaultBrowserType: _, ...phone } = devices['Pixel 7'];
test.use(phone);

test('add a photo from the recipe page, see it there and on the card', async ({ page }) => {
	const jpg = await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 180, g: 90, b: 30 } } })
		.jpeg()
		.withExif({ IFD0: { ImageDescription: 'rv-invented-e2e' } })
		.toBuffer();

	await page.goto('/r/pate-a-pizza');
	await expect(page.locator('figure.photo')).toHaveCount(0);
	await page.getByTestId('photo-input').setInputFiles({ name: 'plat.jpg', mimeType: 'image/jpeg', buffer: jpg });
	const img = page.locator('figure.photo img');
	await expect(img).toBeVisible();
	const src = (await img.getAttribute('src'))!;
	expect(src).toMatch(/^\/media\/pate-a-pizza\/final-\d{4}-\d\d-\d\d-1\.jpg\?v=display$/);
	await expect(page.getByTestId('photo-input')).toHaveCount(0);

	// The original is on disk byte for byte, the recipe names it, one commit by the signed-in person.
	const file = readdirSync(`${VAULT}/media/pate-a-pizza`)[0];
	expect(readFileSync(`${VAULT}/media/pate-a-pizza/${file}`).equals(jpg)).toBe(true);
	expect(readFileSync(`${VAULT}/recipes/pate-a-pizza.md`, 'utf8')).toContain(`media:\n  final: ${file}\n`);
	expect(execFileSync('git', ['log', '-1', '--format=%s|%an'], { cwd: VAULT, encoding: 'utf8' }).trim()).toBe(`edit: Pâte à pizza|${FIXTURE_USERS.owner.name}`);

	// Served: a WebP copy without the EXIF; the original under no variant.
	const display = await page.request.get(src);
	expect(display.headers()['content-type']).toBe('image/webp');
	const body = await display.body();
	expect(body.includes(Buffer.from('rv-invented-e2e'))).toBe(false);
	expect((await sharp(body).metadata()).exif).toBeUndefined();
	expect((await page.request.get(src.replace('display', 'original'))).status()).toBe(404);
	expect((await page.request.get(`/media/pate-a-pizza/..%2F..%2Frecipes%2Fpate-a-pizza.md`)).status()).toBe(404);
	const etag = display.headers().etag;
	expect((await page.request.get(src, { headers: { 'if-none-match': etag } })).status()).toBe(304);

	await page.goto('/?q=pizza');
	const thumb = page.locator(`a[href="/r/pate-a-pizza"]`).locator('xpath=..').locator('img');
	await expect(thumb).toHaveAttribute('src', src.replace('display', 'thumb'));
	await expect(thumb).toHaveJSProperty('complete', true);
	expect(await thumb.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(300);
});

test('a file that is not a photo is refused and nothing changes', async ({ page }) => {
	await page.goto('/r/bouillon-de-legumes');
	const before = readFileSync(`${VAULT}/recipes/bouillon-de-legumes.md`, 'utf8');
	await page.getByTestId('photo-input').setInputFiles({ name: 'plat.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('pas une image') });
	await expect(page.getByText(/La photo n’a pas pu être ajoutée ; rien n’a changé\./)).toBeVisible();
	expect(readFileSync(`${VAULT}/recipes/bouillon-de-legumes.md`, 'utf8')).toBe(before);
	expect(() => readdirSync(`${VAULT}/media/bouillon-de-legumes`)).toThrow();
});
