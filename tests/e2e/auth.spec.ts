// Sign in and out on a phone; reading needs no session, writing does (plan 04, Q1 A, Q2 B).
import { expect, test } from '@playwright/test';
import { FIXTURE_USERS } from '../../scripts/fixture-vault';

test.use({ storageState: { cookies: [], origins: [] } });

const { cook } = FIXTURE_USERS;

test('signed out: recipes read freely, the paste box sends to sign-in and back', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('link', { name: 'Se connecter' })).toBeVisible();
	await page.goto('/ajouter');
	await expect(page).toHaveURL(/\/connexion\?suite=%2Fajouter$/);
});

test('sign in, the name shows, the Markdown tools stay hidden for her, sign out', async ({ page }) => {
	await page.goto('/');
	const first = page.locator('a[href^="/r/"]').first();
	const href = await first.getAttribute('href');
	await page.goto(href!);
	await page.getByRole('link', { name: 'Se connecter' }).click();
	await expect(page).toHaveURL(new RegExp(`/connexion\\?suite=${encodeURIComponent(href!).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
	await expect(page.getByLabel('Rester connectée sur cet appareil')).toBeChecked();

	await page.getByLabel('Identifiant').fill(cook.login);
	await page.getByLabel('Mot de passe').fill('pas le bon');
	await page.getByRole('button', { name: 'Se connecter' }).click();
	await expect(page.getByRole('alert')).toHaveText('Identifiant ou mot de passe incorrect.');

	await page.getByLabel('Mot de passe').fill(cook.password);
	await page.getByRole('button', { name: 'Se connecter' }).click();
	await expect(page).toHaveURL(new RegExp(`${href}$`));
	await expect(page.locator('header .who')).toHaveText(cook.name);
	const nav = page.getByRole('navigation', { name: 'Principale' });
	await expect(nav.getByRole('link', { name: 'Ajouter' })).toHaveCount(0);
	await expect(page.getByText('Voir le fichier')).toHaveCount(0);
	const cookie = (await page.context().cookies()).find((c) => c.name === 'rv_session');
	expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', secure: false });
	expect(cookie!.expires).toBeGreaterThan(Date.now() / 1000 + 300 * 24 * 3600);

	await page.getByRole('button', { name: 'Se déconnecter' }).click();
	await expect(page.getByRole('link', { name: 'Se connecter' })).toBeVisible();
	expect((await page.context().cookies()).find((c) => c.name === 'rv_session')).toBeUndefined();
});
