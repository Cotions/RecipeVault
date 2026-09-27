import { expect, test } from '@playwright/test';
import { fenced, paste } from './helpers';

test('paste a valid recipe: saved, box cleared and refocused, found by search', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, fenced('Galettes à la mélasse inventées'));
	await expect(page.getByText('Valide')).toBeVisible();
	await page.getByLabel('Réponse de l’IA').press('Control+Enter');
	await expect(page.locator('.toast')).toContainText('Recette enregistrée');
	await expect(page.getByLabel('Réponse de l’IA')).toHaveValue('');
	await expect(page.getByLabel('Réponse de l’IA')).toBeFocused();

	await page.goto('/');
	await page.getByRole('searchbox').fill('melasse invent');
	await expect(page).toHaveURL(/q=melasse/);
	await expect(page.locator('.cards')).toContainText('Galettes à la mélasse inventées');
	await page.getByRole('link', { name: 'Galettes à la mélasse inventées' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Galettes à la mélasse inventées');
	await expect(page.locator('.badge')).toHaveText('Brouillon');
});

test('paste an invalid recipe: the fix-request block is copied, with only ai codes', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, fenced('Biscuits cassés', '', '      - { qty: 1, unit: tasse, name: farine }'));
	await expect(page.getByText('À corriger')).toBeVisible();
	await expect(page.getByRole('button', { name: /Enregistrer/ })).toBeDisabled();
	await page.getByRole('button', { name: 'Copier la demande de correction' }).click();
	await expect(page.locator('.toast')).toContainText('Demande copiée');
	const clip = await page.evaluate(() => navigator.clipboard.readText());
	expect(clip).toContain('RECIPEVAULT — FILE REJECTED');
	expect(clip).toContain('[E201]');
	expect(clip).toContain('--- YOUR FILE ---');
	expect(clip).not.toContain('W602');
});

test('a slug collision is saved under the suffixed slug', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, fenced('Pâté chinois'));
	await expect(page.getByText('Une recette « pate-chinois » existe déjà.')).toBeVisible();
	await page.getByLabel('Enregistrer comme pate-chinois-2').check();
	await page.getByRole('button', { name: /Enregistrer/ }).click();
	await expect(page.locator('.toast')).toContainText('Pâté chinois');
	await page.goto('/r/pate-chinois-2');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pâté chinois');
	// The original is untouched.
	await page.goto('/r/pate-chinois');
	await expect(page.locator('.source')).toContainText('tante Rita');
});

test('delete goes to the trash, restore brings it back', async ({ page }) => {
	await page.goto('/r/salade-de-chou');
	page.once('dialog', (d) => d.accept());
	await page.getByRole('button', { name: 'Supprimer' }).click();
	await expect(page).toHaveURL(/\/corbeille/);
	await expect(page.locator('.list')).toContainText('Salade de chou crémeuse');
	expect((await page.request.get('/r/salade-de-chou')).status()).toBe(404);
	await page.getByRole('button', { name: 'Restaurer' }).click();
	await expect(page.getByText('Recette restaurée.')).toBeVisible();
	await page.goto('/r/salade-de-chou');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Salade de chou crémeuse');
});

test('verify a recipe with no uncertain reading', async ({ page }) => {
	await page.goto('/r/crepes');
	await page.getByRole('button', { name: 'Vérifié' }).click();
	await expect(page.getByText('Recette marquée vérifiée.')).toBeVisible();
	await expect(page.locator('.badge')).toHaveText('Vérifiée');
});

test('browse filters live in the URL and survive the back button', async ({ page }) => {
	await page.goto('/');
	await page.locator('.facets').getByRole('link', { name: /Lasagna/ }).click();
	await expect(page).toHaveURL(/famille=lasagna/);
	await expect(page.locator('.count')).toHaveText('3 recettes');
	await page.goBack();
	await expect(page.locator('.count')).not.toHaveText('3 recettes');
});

test('a writing request from another site is refused', async ({ request }) => {
	const res = await request.post('/api/save', {
		headers: { origin: 'http://evil.example', 'content-type': 'application/json' },
		data: { files: [{ text: 'x' }] }
	});
	expect(res.status()).toBe(403);
	const form = await request.post('/r/crepes?/remove', { headers: { origin: 'http://evil.example' }, form: { hash: 'x' } });
	expect(form.status()).toBe(403);
});
