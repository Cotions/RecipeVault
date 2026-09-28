import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { fenced, paste } from './helpers';

// The e2e vault (tests/e2e/serve.ts → scripts/fixture-vault.ts).
const VAULT = '/tmp/rv-e2e/vault';

test('paste box: problems in French with their place, the English detail behind a disclosure', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, fenced('Biscuits inventés', '', '      - { qty: 1, unit: tasse, name: farine }'));
	const error = page.locator('.diag.error .diag-item').first();
	await expect(error).toContainText('Unité inconnue');
	await expect(error.locator('.where')).toHaveText('Ingrédients, groupe 1, ligne 1 « farine » : unité');
	await expect(error.locator('.who')).toHaveText('L’IA s’en charge : copiez la demande de correction.');
	// The checker's own message, in English, only once opened.
	const tech = error.locator('.tech');
	await expect(tech.getByText('`unit: "tasse"` is not allowed', { exact: false })).toBeHidden();
	await tech.getByText('Détail technique').click();
	await expect(tech).toContainText('ingredients[0].items[0].unit');
	await expect(tech).toContainText('is not allowed');

	// An app code (no times): settled here, not by the AI.
	await page.locator('.diag.warning > summary').click();
	const w602 = page.locator('.diag.warning .diag-item', { hasText: 'W602' });
	await expect(w602).toContainText('Aucun temps n’est indiqué');
	await expect(w602.locator('.where')).toHaveText('Temps');
	await expect(w602.locator('.who')).toHaveText('Se règle ici, dans l’application — pas par l’IA.');
});

test('a vault file that stops passing: French banner on its page and on the home page', async ({ page }) => {
	const rel = `${VAULT}/recipes/soupe-aux-pois.md`;
	const original = readFileSync(rel, 'utf8');
	const orphan = `${VAULT}/recipes/fichier-casse-invente.md`;
	try {
		writeFileSync(rel, original.replace('{ qty: 3, unit: qt, name: eau }', '{ qty: 3, unit: pintes, name: eau }'));
		await expect(async () => {
			await page.goto('/r/soupe-aux-pois');
			await expect(page.locator('.banner')).toBeVisible({ timeout: 500 });
		}).toPass({ timeout: 10_000 });
		const item = page.locator('.banner .diag-item').first();
		await expect(item).toContainText('Unité inconnue');
		await expect(item.locator('.where')).toHaveText('Ingrédients, groupe 1, ligne 5 « eau » : unité');
		await expect(page.locator('.banner .hint')).toContainText('Remplacer');

		// A file that never passed: listed on the home page.
		writeFileSync(orphan, '---\nschema: 3\nslug: fichier-casse-invente\ningredients:\n  - items:\n      - { qty: 1, unit: cup, name: farine }\n---\n\n## Préparation\n\n1. Mélanger.\n');
		await expect(async () => {
			await page.goto('/');
			await expect(page.locator('.problems')).toBeVisible({ timeout: 500 });
		}).toPass({ timeout: 10_000 });
		await page.locator('.problems > summary').click();
		const e101 = page.locator('.problems .diag-item', { hasText: 'E101' });
		await expect(e101).toContainText('La recette n’a pas de titre.');
		await expect(e101.locator('.where')).toHaveText('Titre');
	} finally {
		writeFileSync(rel, original);
		rmSync(orphan, { force: true });
	}
	await expect(async () => {
		await page.goto('/r/soupe-aux-pois');
		await expect(page.locator('.banner')).toBeHidden({ timeout: 500 });
	}).toPass({ timeout: 10_000 });
});
