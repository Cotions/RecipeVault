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

test('Back from kitchen mode and « Retour » keep the amount set on the recipe page (review, Q1 A)', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise');
	await page.getByRole('button', { name: 'Plus de portions' }).tap();
	await page.getByRole('button', { name: 'Plus de portions' }).tap();
	await expect(page).toHaveURL(/\?portions=8$/);
	await page.getByRole('link', { name: 'Cuisiner' }).tap();
	await expect(page.locator('.kitchen')).toBeVisible();
	await expect(page.locator('.scaler output')).toContainText('8');
	await page.goBack();
	await expect(page).toHaveURL(/\/r\/lasagna-bolognaise\?portions=8$/);
	await expect(page.locator('.scaler output')).toContainText('8');
	await expect(page.locator('.ingredients li').filter({ hasText: 'bœuf haché' })).toContainText('665 g de bœuf haché');
	// Still there after a reload, then Back again from kitchen mode.
	await page.reload();
	await page.getByRole('link', { name: 'Cuisiner' }).tap();
	await expect(page.locator('.kitchen')).toBeVisible();
	await page.goBack();
	await expect(page).toHaveURL(/\?portions=8$/);
	await expect(page.locator('.scaler output')).toContainText('8');

	// « Retour » carries the amount cooked in kitchen mode.
	await page.getByRole('link', { name: 'Cuisiner' }).tap();
	await expect(page.locator('.kitchen')).toBeVisible();
	await page.getByRole('button', { name: 'Plus de portions' }).tap();
	await expect(page.locator('.scaler output')).toContainText('9');
	await expect(page.locator('a.quit')).toHaveAttribute('href', '/r/lasagna-bolognaise?portions=9');
	await page.locator('a.quit').tap();
	await expect(page).toHaveURL(/\/r\/lasagna-bolognaise\?portions=9$/);
	await expect(page.locator('.scaler output')).toContainText('9');
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

test('kitchen mode opens a sub-recipe inside a sub-recipe, each at its own amount (#13)', async ({ page }) => {
	// Pizza ×2: 2 cups of a sauce making 1 L is the half sauce; its broth (a text yield) shows as written.
	await page.goto('/r/pizza-maison/cuisine?portions=8');
	await expect(page.locator('.scaler output')).toContainText('8');
	const sauce = page.locator('.ingredients > ul > li').filter({ hasText: 'sauce tomate' });
	await sauce.getByRole('button', { name: 'Voir la recette' }).tap();
	const sub = sauce.locator('.sub').first();
	await expect(sub.locator('.subtitle').first()).toContainText('Sauce tomate maison recette × ½');
	await expect(sub.locator(':scope > ul > li').filter({ hasText: 'tomates entières' })).toContainText('½ boîte de tomates entières');
	const broth = sub.locator(':scope > ul > li').filter({ hasText: 'bouillon de légumes' });
	await expect(broth.locator('.sub')).toHaveCount(0);
	await broth.getByRole('button', { name: 'Voir la recette' }).tap();
	const inner = broth.locator('.sub');
	await expect(inner.locator('.subtitle')).toHaveText('Bouillon de légumes');
	await expect(inner.locator('.subwhole')).toHaveText('Recette complète : donne 2 litres');
	await expect(inner.locator('ul > li').filter({ hasText: 'carottes' })).toHaveText('2 carottes');
	// The broth has no sub-recipe of its own: no further button.
	await expect(inner.getByRole('button', { name: 'Voir la recette' })).toHaveCount(0);
	// Closing the outer level closes all; the inner one stays open underneath.
	await sauce.getByRole('button', { name: 'Masquer' }).first().tap();
	await expect(sauce.locator('.sub')).toHaveCount(0);
	await sauce.getByRole('button', { name: 'Voir la recette' }).tap();
	await expect(sauce.locator('.sub')).toHaveCount(2);
});

test('kitchen steps show the scaled amount beside the original', async ({ page }) => {
	await page.goto('/r/crepes/cuisine?portions=8');
	await page.getByRole('button', { name: 'Commencer' }).tap();
	const now = page.locator('.now');
	await expect(now).toContainText('Ajouter 1 ½ tasse → 3 tasses de lait peu à peu.');
	await expect(page.locator('.stage .scale-notice')).toContainText('les temps, la température du four');
	await expect(page.locator('.step-ings')).toContainText('3 tasses de lait');
});
