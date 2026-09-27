// Kitchen mode sessions and offline use (review fixes). Invented fixture vault.
import { expect, test } from '@playwright/test';

test('the recipe page amount wins over an old session, and a reload keeps the kitchen one', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise/cuisine');
	await page.getByRole('button', { name: 'Plus de portions' }).click();
	await page.getByRole('button', { name: 'Plus de portions' }).click();
	await expect(page.locator('.scaler output')).toContainText('8');

	await page.goto('/r/lasagna-bolognaise');
	await page.getByRole('link', { name: 'Cuisiner' }).click();
	await expect(page.locator('.kitchen')).toBeVisible();
	await expect(page.locator('.scaler output')).toContainText('6');
	await expect(page).toHaveURL(/\/cuisine$/);

	await page.getByRole('button', { name: 'Plus de portions' }).click();
	await page.reload();
	await expect(page.locator('.scaler output')).toContainText('7');
});

test('an old or finished session is not resumed; Recommencer starts over', async ({ page }) => {
	await page.goto('/r/crepes/cuisine');
	await page.locator('li label').first().click();
	await expect(page.locator('li.ticked')).toHaveCount(1);
	// Make the session 13 hours old.
	await page.evaluate(() => {
		const s = JSON.parse(localStorage.getItem('rv-kitchen:crepes')!);
		localStorage.setItem('rv-kitchen:crepes', JSON.stringify({ ...s, at: Date.now() - 13 * 3600 * 1000 }));
	});
	await page.reload();
	await expect(page.locator('li.ticked')).toHaveCount(0);

	// Another recipe file: ticks by position must not land on other items.
	await page.locator('li label').first().click();
	await page.evaluate(() => {
		const s = JSON.parse(localStorage.getItem('rv-kitchen:crepes')!);
		localStorage.setItem('rv-kitchen:crepes', JSON.stringify({ ...s, v: 'other' }));
	});
	await page.reload();
	await expect(page.locator('li.ticked')).toHaveCount(0);

	await page.locator('li label').first().click();
	await page.getByRole('button', { name: 'Commencer →' }).click();
	while (await page.getByRole('button', { name: /Étape suivante/ }).isVisible()) await page.getByRole('button', { name: /Étape suivante/ }).click();
	await expect(page.getByText('Bon appétit !')).toBeVisible();
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Ingrédients' })).toBeVisible();
	await expect(page.locator('li.ticked')).toHaveCount(0);

	await page.getByRole('button', { name: 'Commencer →' }).click();
	while (await page.getByRole('button', { name: /Étape suivante/ }).isVisible()) await page.getByRole('button', { name: /Étape suivante/ }).click();
	await page.getByRole('button', { name: 'Recommencer' }).click();
	await expect(page.getByRole('heading', { name: 'Ingrédients' })).toBeVisible();
});

test('kitchen mode entered from the recipe page reloads offline', async ({ page, context }) => {
	await page.goto('/r/pizza-maison');
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
		if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
	});
	await page.getByRole('link', { name: 'Cuisiner' }).click();
	await expect(page).toHaveURL(/\/r\/pizza-maison\/cuisine/);
	await expect(page.locator('.kitchen')).toBeVisible();
	await expect
		.poll(() => page.evaluate(async () => !!(await caches.match('/r/pizza-maison/cuisine', { ignoreSearch: true, ignoreVary: true }))))
		.toBe(true);

	await context.setOffline(true);
	try {
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Ingrédients' })).toBeVisible();
		await expect(page.locator('.top .name')).toContainText('Pizza maison');
		// Offline for real: a page never opened in kitchen mode is not there.
		const other = await page.evaluate(() => fetch('/r/soupe-aux-pois').then(() => 'fetched', () => 'failed'));
		expect(other).toBe('failed');
	} finally {
		await context.setOffline(false);
	}
});
