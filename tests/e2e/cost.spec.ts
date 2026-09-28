import { expect, test, type Page } from '@playwright/test';

// Invented prices, entered the way the owner enters them: inline on /ingredients.
async function enterPrice(page: Page, slug: string, name: string, amount: string, qty: string, unit: string) {
	await page.goto(`/ingredients?q=${encodeURIComponent(name)}`);
	await page.locator(`#i-${slug}`).getByRole('button', { name: `Saisir un prix pour ${name}` }).click();
	await page.locator(`#amount-${slug}`).fill(amount);
	await page.keyboard.press('Tab');
	await page.keyboard.type(qty);
	await page.getByLabel('Unité').selectOption(unit);
	await page.getByLabel('Magasin').press('Enter');
	await expect(page.locator('.flash')).toContainText(`Prix enregistré : ${name}`);
}

const money = (s: string) => new RegExp(s.replace(/\s/g, '\\s').replace('$', '\\$'));

test('a recipe’s cost appears once its prices are entered, and follows the servings', async ({ page }) => {
	await page.goto('/r/crepes');
	const cost = page.locator('.cost');
	await expect(cost.locator('.line')).toContainText('Pas assez de prix');
	await expect(cost.locator('.total')).toHaveCount(0);

	await enterPrice(page, 'farine', 'farine', '4,99', '2.5', 'kg');
	await enterPrice(page, 'lait', 'lait', '5,20', '4', 'l');
	await enterPrice(page, 'sel', 'sel', '1,29', '1', 'kg');

	// 1 cup of flour, 2 of 6 eggs at 2,10 $, 1 1/2 cup of milk, a pinch of salt: 1,45 $ for 4.
	await page.goto('/r/crepes');
	await expect(cost.locator('.total')).toHaveText(money('≈ 1,45 $'));
	await expect(cost.locator('.per')).toHaveText(money('0,36 $ par portion'));
	await page.getByRole('button', { name: 'Plus de portions' }).click();
	await expect(cost.locator('.total')).toHaveText(money('≈ 1,82 $'));
	await expect(cost.locator('.per')).toHaveText(money('0,36 $ par portion'));

	// Not part of the printed recipe.
	await page.emulateMedia({ media: 'print' });
	await expect(cost).toBeHidden();
});

test('ingredient names link to the index, or to their row in the resolve queue', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise');
	const list = page.locator('section.ingredients');
	await expect(list.getByRole('link', { name: 'tomates concassées' })).toHaveAttribute('href', '/ingredients/tomates-concassees');
	await expect(page.locator('.cost .line')).toContainText('Pas assez de prix · 1 ingrédient sur 9');

	const unlinked = list.locator('li', { hasText: 'concentré de tomate' }).getByRole('link', { name: 'non relié' });
	await expect(unlinked).toHaveAttribute('href', '/resoudre#k-concentre-de-tomate');
	await unlinked.click();
	await expect(page.locator('#k-concentre-de-tomate')).toBeInViewport();
});
