// Review fixes on the paste box and the recipe page. Invented recipes only.
import { existsSync, readFileSync } from 'node:fs';
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
	// Unanswered, a clash keeps both: the suffixed slug, chosen and listed first (usability round 4).
	await expect(page.getByRole('radio').first()).toHaveAccessibleName(/^Enregistrer comme crepes-\d+$/);
	await expect(page.getByRole('radio').first()).toBeChecked();
});

test('a clash nobody answered: « Enregistrer comme …-2 » chosen, the clash not repeated in the errors', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, fenced('Pâté chinois'));
	await expect(page.getByText('Une recette « pate-chinois » existe déjà.')).toBeVisible();
	await expect(page.getByTestId('collision-settled')).toContainText(/pate-chinois-\d+/);
	await expect(page.getByLabel('Remplacer la fiche existante (l’ancienne reste dans l’historique)')).not.toBeChecked();
	await expect(page.locator('.diag.error')).toHaveCount(0);
	await expect(page.getByText('Valide')).toBeVisible();
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
	await expect(box(page)).toBeHidden();
	await page.keyboard.press('Control+Enter');
	await expect(page.locator('.toast')).toContainText('1 recette n’a pas été enregistrée');
	await expect(page.getByText('Une recette « pate-chinois » existe déjà.')).toBeVisible();
	await expect(page.getByLabel('Remplacer')).toBeVisible();
});

test('two new files with one slug: the first saves under it, the later one under …-2 unless she picks otherwise', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, fenced('Tarte doublon inventée') + '\n' + fenced('Tarte doublon inventée', '', '      - { qty: 2, unit: cup, name: farine }'));
	const files = page.locator('section.file');
	await expect(files).toHaveCount(2);
	// The clash default (usability round 4): the suffixed slug, chosen, listed first; no error row.
	await expect(files.nth(1).getByLabel('Enregistrer comme tarte-doublon-inventee-2')).toBeChecked();
	await expect(files.nth(1).getByRole('radio').first()).toHaveAccessibleName('Enregistrer comme tarte-doublon-inventee-2');
	await expect(files.nth(0).locator('.state')).toHaveText('Valide');
	await expect(files.nth(0).getByRole('radio')).toHaveCount(0);
	await expect(files.nth(1).locator('.state')).toHaveText('Valide');
	await expect(files.nth(1).locator('.diag.error')).toHaveCount(0);

	await page.getByRole('button', { name: /Enregistrer/ }).click();
	// Several saved: the card lists a link to each.
	await expect(page.getByTestId('saved-card')).toContainText('2 recettes enregistrées');
	await expect(page.getByTestId('saved-card').getByRole('link')).toHaveCount(2);
	expect(existsSync('/tmp/rv-e2e/vault/recipes/tarte-doublon-inventee.md')).toBe(true);
	expect(existsSync('/tmp/rv-e2e/vault/recipes/tarte-doublon-inventee-2.md')).toBe(true);

	const log = readFileSync('/tmp/rv-e2e/vault/cache/paste-log.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
	const last = log.at(-1);
	expect(last.via).toBe('save');
	expect(last.files).toBe(2);
	expect(last.results.map((r: { outcome: string }) => r.outcome)).toEqual(['saved', 'saved']);
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
