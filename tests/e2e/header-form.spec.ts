import { expect, test } from '@playwright/test';

// A form page has its save bar at the bottom and no tab bar on a phone: the four pages head « Plus » there (usability round 5).
test('a form page on a phone: Recettes, Variantes, Ingrédients and Garde-manger are in « Plus »', async ({ page }) => {
	await page.goto('/nouvelle');
	const phone = await page.evaluate(() => matchMedia('(max-width: 40rem)').matches);
	await page.getByTestId('more').click();
	const pages = page.getByTestId('more-pages');
	if (!phone) {
		// The tabs are in the header: not twice.
		await expect(pages).toBeHidden();
		return;
	}
	for (const name of ['Recettes', 'Variantes', 'Ingrédients', 'Garde-manger']) await expect(pages.getByRole('link', { name })).toBeVisible();
	await pages.getByRole('link', { name: 'Ingrédients' }).click();
	await expect(page).toHaveURL(/\/ingredients$/);
});
