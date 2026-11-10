import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_USERS } from '../../scripts/fixture-vault';

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
	// The owner (Markdown tools) reads one quiet line, « Coût : N prix manquants › », that opens on them (usability round 6); a family account sees no cost line.
	await expect(cost.locator('.line')).toHaveText(/^Coût\s:\s*\d+ prix manquants? ›$/);
	await expect(cost.locator('.total')).toHaveCount(0);
	await expect(cost.locator('.coverage')).toHaveCount(0);
	const missing = Number((await cost.locator('.line').innerText()).match(/(\d+) prix/)![1]);
	await cost.locator('.line').click();
	await expect(cost.locator('li.unpriced')).toHaveCount(missing);
	await expect(cost.locator('li.unpriced').first().getByRole('link')).toHaveAttribute('href', /^\/(ingredients|resoudre)/);

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
	await expect(cost.locator('.coverage')).toHaveText(/^\d+ ingrédients? sur \d+ (ont|a) un prix$/);
	await expect(cost.locator('.line')).toContainText('Coût estimé');
	// The detail is behind the coverage, not on the line.
	await cost.locator('.coverage').click();
	await expect(cost.locator('.detail h3').first()).toBeVisible();

	// Not part of the printed recipe.
	await page.emulateMedia({ media: 'print' });
	await expect(cost).toBeHidden();
});

test('ingredient names link to the index, or to their row in the resolve queue', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise');
	const list = page.locator('section.ingredients');
	await expect(list.getByRole('link', { name: 'Fiche de l’ingrédient : tomates concassées' })).toHaveAttribute('href', '/ingredients/tomates-concassees');
	// Not enough prices yet: one line; how many are missing depends on the staples priced above (farine, lait).
	await expect(page.locator('.cost .line')).toHaveText(/^Coût\s:\s*\d+ prix manquants? ›$/);

	// No word after each unlinked line: one « N ingrédients à relier » under the red rule opens the list, each with its way to the queue.
	await expect(list.getByRole('link', { name: 'pas encore relié' })).toHaveCount(0);
	await page.locator('.upkeep').getByRole('link', { name: /ingrédients? à relier$/ }).click();
	const unresolved = page.locator('details.unresolved');
	await expect(unresolved).toHaveAttribute('open', '');
	const unlinked = unresolved.locator('li', { hasText: 'concentré de tomate' }).getByRole('link', { name: 'Relier ›' });
	await expect(unlinked).toHaveAttribute('href', '/resoudre?cle=concentre%20de%20tomate#k-concentre-de-tomate');
	await unlinked.click();
	await expect(page.locator('#k-concentre-de-tomate')).toBeInViewport();
});

test('a family account never sees missing prices: no cost line until there is a figure', async ({ browser }) => {
	const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
	const page = await ctx.newPage();
	await page.goto('/connexion?suite=%2Fr%2Flasagna-bolognaise');
	await page.getByLabel('Identifiant').fill(FIXTURE_USERS.cook.login);
	await page.getByLabel('Mot de passe').fill(FIXTURE_USERS.cook.password);
	await page.getByRole('button', { name: 'Se connecter' }).click();
	await expect(page).toHaveURL(/\/r\/lasagna-bolognaise$/);
	await expect(page.locator('section.ingredients')).toBeVisible();
	await expect(page.locator('.cost')).toHaveCount(0);
	// The archive's upkeep is the keeper's: no « pas encore relié », no list of unlinked names, no review state.
	await expect(page.getByRole('link', { name: 'pas encore relié' })).toHaveCount(0);
	await expect(page.locator('details.unresolved')).toHaveCount(0);
	await expect(page.locator('.upkeep')).toHaveCount(0);
	await expect(page.getByText('Brouillon')).toHaveCount(0);
	// Still a way to each ingredient's page, after the line.
	await expect(page.getByRole('link', { name: 'Fiche de l’ingrédient : tomates concassées' })).toHaveAttribute('href', '/ingredients/tomates-concassees');
	await ctx.close();
});
