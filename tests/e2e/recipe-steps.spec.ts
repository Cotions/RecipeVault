import { expect, test } from '@playwright/test';

test('steps show as bullets; the numbered choice is kept on the device, in print too', async ({ page }) => {
	// Written with `-` bullets; lasagna-bolognaise is written numbered.
	await page.goto('/r/feves-au-lard');
	const steps = page.locator('.method .steps > li');
	await expect(steps).toHaveCount(4);
	await expect(page.locator('.method ul.steps')).toHaveCount(1);
	await expect(page.locator('.method ol')).toHaveCount(0);
	// Author and type, nothing else: no dangling dash after the name.
	await expect(page.locator('.source')).toHaveText(/Mémère Alma\s*$/);

	await page.goto('/r/lasagna-bolognaise');
	await expect(page.locator('.method ol.steps')).toHaveCount(0);
	const toggle = page.getByLabel('Numéroter les étapes');
	await expect(toggle).not.toBeChecked();
	await toggle.check();
	await expect(page.locator('.method ol.steps').first()).toBeVisible();
	await expect(page.locator('.method .steps > li').first()).toHaveAttribute('value', '1');

	await page.goto('/r/feves-au-lard');
	await expect(page.getByLabel('Numéroter les étapes')).toBeChecked();
	await expect(page.locator('.method ol.steps > li')).toHaveCount(4);
	await expect(page.locator('.method .steps > li').last()).toHaveAttribute('value', '4');
	await page.emulateMedia({ media: 'print' });
	await expect(page.locator('.step-style')).toBeHidden();
	await expect(page.locator('.method ol.steps')).toBeVisible();
	await page.emulateMedia({ media: 'screen' });

	await page.getByLabel('Numéroter les étapes').uncheck();
	await page.reload();
	await expect(page.locator('.method ul.steps > li')).toHaveCount(4);
});
