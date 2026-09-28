import { expect, test } from '@playwright/test';

// Pantry search, /garde-manger (plan 03, Phase 7), on the e2e vault. Read-only.

test('pick ingredients by name, see the tiers, open a ready recipe', async ({ page }) => {
	await page.goto('/garde-manger');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Garde-manger');
	await expect(page.getByText('Ajoutez au moins un ingrédient que vous avez.')).toBeVisible();

	for (const name of ['œufs', 'lait', 'farine']) {
		await page.getByLabel('Ajouter un ingrédient').fill(name);
		await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
		await expect(page.locator('.chips.have')).toContainText(name === 'œufs' ? 'œuf' : name);
	}
	await expect(page).toHaveURL(/\/garde-manger\?have=oeuf,lait,farine$/);

	const ready = page.locator('section[data-tier="pret"]');
	await expect(ready.getByRole('heading', { level: 2 })).toContainText('Prêt à cuisiner');
	const crepes = ready.locator('li', { hasText: 'Crêpes minces' });
	await expect(crepes.locator('.coverage')).toHaveText('3 sur 3');

	// The staples off: the salt is missing, the crêpes move to "Presque".
	await page.getByLabel('Supposer les essentiels').uncheck();
	await page.getByRole('button', { name: 'Chercher' }).click();
	await expect(page).toHaveURL(/essentiels=non/);
	const almost = page.locator('section[data-tier="presque"] li', { hasText: 'Crêpes minces' });
	await expect(almost.locator('.missing')).toContainText('sel');

	await almost.getByRole('link', { name: 'Crêpes minces' }).click();
	await expect(page).toHaveURL('/r/crepes');
});

test('an unknown name is said so; a chip removes its ingredient; the last pantry comes back', async ({ page }) => {
	await page.goto('/garde-manger?have=oeuf,lait');
	await page.getByLabel('Ajouter un ingrédient').fill('zzz introuvable');
	await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
	await expect(page.locator('.flash.error')).toHaveText('« zzz introuvable » n’est pas un ingrédient du registre.');

	await page.getByRole('link', { name: 'Retirer lait' }).click();
	await expect(page).toHaveURL('/garde-manger?have=oeuf');

	await page.goto('/garde-manger');
	await expect(page).toHaveURL('/garde-manger?have=oeuf');
	await page.getByRole('link', { name: 'Tout effacer' }).click();
	await expect(page.getByText('Ajoutez au moins un ingrédient que vous avez.')).toBeVisible();
	await page.goto('/garde-manger');
	await expect(page).toHaveURL('/garde-manger');
});

test('an allergen to avoid leaves out the recipes using it', async ({ page }) => {
	await page.goto('/garde-manger?have=farine');
	await expect(page.locator('li', { hasText: 'Crêpes minces' })).toHaveCount(1);
	await page.getByLabel('Œufs').check();
	await page.getByRole('button', { name: 'Chercher' }).click();
	await expect(page).toHaveURL(/allergenes=oeuf/);
	await expect(page.locator('li', { hasText: 'Crêpes minces' })).toHaveCount(0);
});
