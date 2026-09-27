// Review fixes on the paste box and the recipe page. Invented recipes only.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { fenced, paste } from './helpers';

const box = (page: import('@playwright/test').Page) => page.getByLabel('Réponse de l’IA');

test('a Remplacer choice does not carry over to another recipe pasted in its place', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, fenced('Pâté chinois'));
	await expect(page.getByText('Une recette « pate-chinois » existe déjà.')).toBeVisible();
	await page.getByLabel('Remplacer').check();
	await expect(page.getByText('Valide')).toBeVisible();

	await paste(page, fenced('Crêpes de remplacement', 'slug: crepes\n'));
	await expect(page.getByText('Une recette « crepes » existe déjà.')).toBeVisible();
	await expect(page.getByLabel('Remplacer')).not.toBeChecked();
	await expect(page.getByText('À corriger')).toBeVisible();
	await expect(page.getByRole('button', { name: /Enregistrer/ })).toBeDisabled();
});

test('a save refused for a collision says so and offers the choice', async ({ page }) => {
	// Hold the live check back so the save goes out on the browser's check alone.
	await page.route('**/api/check', async (route) => {
		await new Promise((r) => setTimeout(r, 1500));
		await route.continue();
	});
	await page.goto('/ajouter');
	await paste(page, fenced('Pâté chinois'));
	await expect(page.getByText('Valide')).toBeVisible();
	await box(page).press('Control+Enter');
	await expect(page.locator('.toast')).toContainText('1 recette n’a pas été enregistrée');
	await expect(page.getByText('Une recette « pate-chinois » existe déjà.')).toBeVisible();
	await expect(page.getByLabel('Remplacer')).toBeVisible();
});

test('two new files with one slug: the first saves under it, the later one waits', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, fenced('Tarte doublon inventée') + '\n' + fenced('Tarte doublon inventée', '', '      - { qty: 2, unit: cup, name: farine }'));
	const files = page.locator('section.file');
	await expect(files).toHaveCount(2);
	await expect(files.nth(1).getByLabel('Enregistrer comme tarte-doublon-inventee-2')).toBeVisible();
	await expect(files.nth(0).locator('.state')).toHaveText('Valide');
	await expect(files.nth(0).getByRole('radio')).toHaveCount(0);
	await expect(files.nth(1).locator('.state')).toHaveText('À corriger');

	await page.getByRole('button', { name: /Enregistrer/ }).click();
	await expect(page.locator('.toast')).toContainText('Recette enregistrée');
	await expect(files).toHaveCount(1);
	// The one left now collides with the saved one.
	await expect(page.getByText('Une recette « tarte-doublon-inventee » existe déjà.')).toBeVisible();

	const log = readFileSync('/tmp/rv-e2e/vault/cache/paste-log.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
	const last = log.at(-1);
	expect(last.via).toBe('save');
	expect(last.files).toBe(2);
	expect(last.results.map((r: { outcome: string }) => r.outcome).sort()).toEqual(['rejected', 'saved']);
	expect(last.results.find((r: { outcome: string }) => r.outcome === 'rejected').codes).toContain('E103');
});

test('the recipe page resets its servings when going to another recipe', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise');
	await page.getByRole('button', { name: 'Plus de portions' }).click();
	await expect(page.locator('.scaler output')).toContainText('7');
	await expect(page.getByRole('link', { name: 'Cuisiner' })).toHaveAttribute('href', '/r/lasagna-bolognaise/cuisine?portions=7');
	await page.locator('.related').getByRole('link', { name: 'Lasagnes épinards et ricotta' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lasagnes épinards et ricotta');
	await expect(page.locator('.scaler output')).toContainText('8');
	await expect(page.getByRole('link', { name: 'Cuisiner' })).toHaveAttribute('href', '/r/lasagna-epinards-ricotta/cuisine?portions=8');
});
