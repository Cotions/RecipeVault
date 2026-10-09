// The Content-Security-Policy (vite.config.ts) is sent, and the app works
// under it: no page, signed in, has anything refused (start script, styles,
// the photo preview's blob: URL, the service worker).
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

function refusals(page: Page): string[] {
	const out: string[] = [];
	page.on('console', (m) => {
		if (/Content Security Policy|Refused to/i.test(m.text())) out.push(`${page.url()}: ${m.text()}`);
	});
	return out;
}

test('the policy is sent and nothing the app does is refused', async ({ page }) => {
	const refused = refusals(page);
	const res = await page.goto('/');
	const csp = res!.headers()['content-security-policy'];
	expect(csp).toMatch(/script-src 'self' 'nonce-[^']+'/);
	expect(csp).toContain("object-src 'none'");
	expect(csp).toContain("frame-ancestors 'none'");
	for (const path of ['/r/crepes', '/r/crepes/cuisine', '/r/crepes/modifier', '/ajouter', '/ingredients/farine', '/garde-manger', '/doublons', '/resoudre']) {
		await page.goto(path);
		await expect(page.locator('h1').first()).toBeVisible();
	}
	await page.goto('/nouvelle');
	const jpg = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 90, g: 120, b: 60 } } })
		.jpeg()
		.toBuffer();
	await page.getByTestId('photo-input').setInputFiles({ name: 'plat.jpg', mimeType: 'image/jpeg', buffer: jpg });
	await expect(page.locator('main')).toContainText('Photo choisie : plat.jpg');
	expect(refused).toEqual([]);
});
