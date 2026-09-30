import { expect, test } from '@playwright/test';

test('kitchen mode: checklist, steps by tap zones, timer, resume after reload', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise/cuisine');
	await expect(page.getByRole('heading', { name: 'Ingrédients' })).toBeVisible();
	await page.getByText('de bœuf haché').click();
	await expect(page.locator('li.ticked')).toHaveCount(1);

	await page.getByRole('button', { name: 'Commencer →' }).click();
	await expect(page.getByText('Étape 1 sur 7')).toBeVisible();

	// Right half of the step area: next. Left half: back. Tapped on the step
	// counter line, clear of the timer buttons in the step text.
	const tap = async (side: number) => {
		const stage = (await page.locator('.stage').boundingBox())!;
		const line = (await page.locator('.stage .count').boundingBox())!;
		await page.mouse.click(stage.x + stage.width * side, line.y + line.height / 2);
	};
	await tap(0.85);
	await expect(page.getByText('Étape 2 sur 7')).toBeVisible();
	await expect(page.locator('.step-ings')).toContainText('bœuf haché');
	await tap(0.85);
	await expect(page.getByText('Étape 3 sur 7')).toBeVisible();
	await tap(0.15);
	await expect(page.getByText('Étape 2 sur 7')).toBeVisible();
	await page.getByRole('button', { name: /Étape suivante/ }).click();

	await page.getByRole('button', { name: '⏱ 25 min' }).click();
	await expect(page.getByRole('timer')).toHaveText(/^2[45]:\d\d$/);

	// Servings rescale the step's ingredients too.
	await page.getByRole('button', { name: 'Plus de portions' }).click();
	await expect(page.locator('.step-ings')).toContainText('935 g de tomates concassées');

	await page.reload();
	await expect(page.getByText('Étape 3 sur 7')).toBeVisible();
	await expect(page.getByRole('timer')).toHaveText(/^2[45]:\d\d$/);
	await expect(page.locator('.scaler output')).toContainText('7');
	await page.getByRole('button', { name: '← Étape précédente' }).click();
	await page.getByRole('button', { name: '← Étape précédente' }).click();
	await page.getByRole('button', { name: /Ingrédients/ }).click();
	await expect(page.locator('li.ticked')).toHaveCount(1);
});

test('kitchen mode: a sub-recipe expands inline', async ({ page }) => {
	await page.goto('/r/tarte-aux-pommes-grand-mere/cuisine');
	await page.getByRole('button', { name: 'Voir la recette' }).click();
	await expect(page.locator('.sub')).toContainText('Pâte brisée');
	await expect(page.locator('.sub')).toContainText('graisse végétale');
});

test('kitchen mode: bullet steps are shown one at a time', async ({ page }) => {
	await page.goto('/r/feves-au-lard/cuisine');
	await page.getByRole('button', { name: 'Commencer →' }).click();
	await expect(page.getByText('Étape 1 sur 4')).toBeVisible();
	await expect(page.locator('.stage')).toContainText('Faire tremper les fèves');
	await page.getByRole('button', { name: /Étape suivante/ }).click();
	await expect(page.getByText('Étape 2 sur 4')).toBeVisible();
	await expect(page.locator('.stage')).toContainText('égoutter');
});
