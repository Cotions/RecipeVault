// Account preferences (docs/DATA-FLOW.md, "Account preferences"): one account
// chooses its language, its measuring system and its own unit words on
// /compte; nobody else's pages change. The invented cook account, signed in
// here and put back to the defaults at the end.
import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_USERS } from '../../scripts/fixture-vault';

const RECIPE = '/r/muffins-bleuets';

test.use({ storageState: { cookies: [], origins: [] } });

async function signIn(page: Page) {
	await page.goto('/connexion?suite=%2Fcompte');
	await page.getByLabel('Identifiant').fill(FIXTURE_USERS.cook.login);
	await page.getByLabel('Mot de passe').fill(FIXTURE_USERS.cook.password);
	await page.getByRole('button', { name: 'Se connecter' }).click();
	await expect(page).toHaveURL(/\/compte$/);
}

test('signed out, /compte asks to sign in', async ({ page }) => {
	await page.goto('/compte');
	await expect(page).toHaveURL(/\/connexion\?suite=%2Fcompte$/);
});

test('language, measures and a unit word are the account’s own', async ({ page, browser, baseURL }) => {
	await signIn(page);
	try {
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mon compte');
		await page.goto(RECIPE);
		await expect(page.locator('.recipe')).toContainText('2 tasses de farine');

		await page.locator('header .who').click();
		await page.getByLabel('Langue').selectOption('en');
		await page.getByLabel('Métrique').check();
		await page.locator('input[name="un-ml"]').fill('mL');
		await page.getByRole('button', { name: 'Enregistrer' }).click();

		// The page comes back in English.
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('My account');
		await expect(page.locator('.flash.ok')).toHaveText('Saved.');
		await expect(page.locator('html')).toHaveAttribute('lang', 'en-CA');
		await expect(page.getByRole('navigation').getByRole('link', { name: 'Pantry' })).toBeVisible();
		await expect(page.getByLabel('Metric')).toBeChecked();
		await expect(page.locator('input[name="un-ml"]')).toHaveValue('mL');

		// Cups show in millilitres, with this account's word; the name stays as the card has it.
		await page.goto(RECIPE);
		await expect(page.locator('.recipe')).toContainText('500 mL farine');
		await expect(page.locator('.recipe')).not.toContainText('tasses de farine');

		// Somebody else, signed out, sees the card as written, in French.
		const other = await browser.newContext({ storageState: { cookies: [], origins: [] } });
		const theirs = await other.newPage();
		await theirs.goto(RECIPE);
		await expect(theirs.locator('.recipe')).toContainText('2 tasses de farine');
		await expect(theirs.getByRole('navigation').getByRole('link', { name: 'Garde-manger' })).toBeVisible();
		await other.close();

	} finally {
		// Back to French, as written, whatever happened above: other specs sign this account in.
		await page.request.post('/compte', { form: { langue: 'fr', mesures: 'written' }, headers: { origin: baseURL! } });
	}
	await page.goto('/compte');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mon compte');
	await page.goto(RECIPE);
	await expect(page.locator('.recipe')).toContainText('2 tasses de farine');
});
