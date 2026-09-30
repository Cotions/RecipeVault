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

test('kitchen mode scales a sub-recipe by the line’s amount, or says why not (Q5 A)', async ({ page }) => {
	await page.goto('/r/tarte-au-sucre/cuisine');
	const pastry = page.locator('.ingredients > ul > li').filter({ hasText: 'pâte brisée' });
	await pastry.getByRole('button', { name: 'Voir la recette' }).tap();
	const sub = pastry.locator('.sub');
	// One crust of two: the half pastry at ×1.
	await expect(sub.locator('.subtitle')).toContainText('recette × ½');
	await expect(sub.locator('ul > li').filter({ hasText: 'farine' })).toHaveText('1 ¼ tasse de farine');
	await page.getByRole('button', { name: 'Plus de portions' }).tap();
	await expect(sub.locator('.subtitle')).toContainText('recette × 0,56');
	// 16 servings of 8: one whole pastry, as written.
	await page.goto('/r/tarte-au-sucre/cuisine?portions=16');
	await expect(page.locator('.scaler output')).toContainText('16');
	await pastry.getByRole('button', { name: 'Voir la recette' }).tap();
	await expect(sub.locator('.subtitle')).not.toContainText('recette ×');
	await expect(sub.locator('ul > li').filter({ hasText: 'farine' })).toHaveText('2 ½ tasses de farine');

	// A text yield: shown as written, saying how much the whole recipe makes.
	await page.goto('/r/sauce-tomate-maison/cuisine?fois=2');
	const stock = page.locator('.ingredients > ul > li').filter({ hasText: 'bouillon de légumes' });
	await stock.getByRole('button', { name: 'Voir la recette' }).tap();
	await expect(stock.locator('.subwhole')).toHaveText('Recette complète : donne 2 litres');
});

test('kitchen steps show the scaled amount beside the original', async ({ page }) => {
	await page.goto('/r/crepes/cuisine?portions=8');
	await page.getByRole('button', { name: 'Commencer' }).tap();
	const now = page.locator('.now');
	await expect(now).toContainText('Ajouter 1 ½ tasse → 3 tasses de lait peu à peu.');
	await expect(page.locator('.stage .scale-notice')).toContainText('les temps, la température du four');
	await expect(page.locator('.step-ings')).toContainText('3 tasses de lait');
});
