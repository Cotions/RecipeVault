// Scaling on a phone and in kitchen mode (plan 05, Phase 3). Invented fixture vault.
import { expect, test } from '@playwright/test';

test('the servings stepper on a phone keeps the amount in the address', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise');
	await page.getByRole('button', { name: 'Plus de portions' }).tap();
	await page.getByRole('button', { name: 'Plus de portions' }).tap();
	await expect(page.locator('.scaler output')).toContainText('8');
	await expect(page).toHaveURL(/\?portions=8$/);
	await page.reload();
	await expect(page.locator('.scaler output')).toContainText('8');
	await expect(page.locator('.ingredients li').filter({ hasText: 'bœuf haché' })).toContainText('665 g de bœuf haché');
});

test('kitchen mode opens scaled from the recipe page, and reads an older session', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise?portions=12');
	await page.getByRole('link', { name: 'Cuisiner' }).click();
	await expect(page.locator('.kitchen')).toBeVisible();
	await expect(page.locator('.scaler output')).toContainText('12');
	await expect(page).toHaveURL(/\/cuisine$/);
	await expect(page.locator('.kitchen li').filter({ hasText: 'bœuf haché' })).toContainText('1 kg de bœuf haché');

	// A session saved before the factor was stored (servings only) still resumes.
	await page.evaluate(() => {
		const s = JSON.parse(localStorage.getItem('rv-kitchen:lasagna-bolognaise')!);
		delete s.factor;
		localStorage.setItem('rv-kitchen:lasagna-bolognaise', JSON.stringify({ ...s, servings: 9 }));
	});
	await page.reload();
	await expect(page.locator('.scaler output')).toContainText('9');
	await expect(page.locator('.kitchen li').filter({ hasText: 'bœuf haché' })).toContainText('750 g de bœuf haché');
});
