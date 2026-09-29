// Sign the invented owner account in once and keep its cookie for the other
// projects: every write in the e2e specs is his (plan 04, Phase 1).
import { expect, test as setup } from '@playwright/test';
import { FIXTURE_USERS } from '../../scripts/fixture-vault';
import { STATE } from './state';

setup('sign in as the owner', async ({ page }) => {
	await page.goto('/connexion');
	await page.getByLabel('Identifiant').fill(FIXTURE_USERS.owner.login);
	await page.getByLabel('Mot de passe').fill(FIXTURE_USERS.owner.password);
	await page.getByRole('button', { name: 'Se connecter' }).click();
	await expect(page.locator('header .who')).toHaveText(FIXTURE_USERS.owner.name);
	await page.context().storageState({ path: STATE });
});
