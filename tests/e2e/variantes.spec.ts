import { expect, test } from '@playwright/test';

// The interface calls a family « Variantes »; the vault keeps `family:` and
// the /famille, /familles and ?famille= addresses (docs/VOCAB.md, "Families").
// The fixture vault's lasagna files are written with `family: lasagna` and
// `source.type: family`, as before the rename: they must group and render.

test('a vault written with family: keys still groups its variants, under « Variantes »', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('navigation', { name: 'Principale' }).getByRole('link', { name: 'Variantes' }).click();
	await expect(page).toHaveURL(/\/familles$/);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Variantes');
	const row = page.locator('li', { has: page.locator('a[href="/famille/lasagna"]') });
	await expect(row).toContainText('3 variantes');

	await row.getByRole('link').click();
	await expect(page).toHaveURL(/\/famille\/lasagna$/);
	await expect(page.locator('.count')).toHaveText('3 variantes');
	for (const slug of ['lasagna-bolognaise', 'lasagna-courgettes', 'lasagna-epinards-ricotta']) {
		await expect(page.locator(`.variants a[href="/r/${slug}"]`)).toBeVisible();
	}
	await expect(page.getByRole('heading', { name: 'Ce qui les distingue' })).toBeVisible();

	await page.goto('/r/lasagna-bolognaise');
	await expect(page.locator('.family a[href="/famille/lasagna"]')).toBeVisible();
	await expect(page.locator('.related')).toContainText('Autres variantes');

	// The filter keeps its address; its heading and the source type read the new way.
	await page.goto('/?famille=lasagna');
	await expect(page.getByText('3 recettes', { exact: true })).toBeVisible();
	await expect(page.locator('.facets')).toContainText('Variantes');
	await page.goto('/');
	await expect(page.locator('.facets')).toContainText('Recette personnelle');
});
