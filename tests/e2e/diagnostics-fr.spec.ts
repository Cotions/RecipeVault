import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { fenced, paste } from './helpers';

// The e2e vault (tests/e2e/serve.ts → scripts/fixture-vault.ts).
const VAULT = '/tmp/rv-e2e/vault';

test('paste box: problems in French with their place, the codes behind one « Détails pour le dépannage »', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, fenced('Biscuits inventés', '', '      - { qty: 1, unit: tasse, name: farine }'));
	const error = page.locator('.diag.error .diag-item').first();
	// One short human sentence leads: what to write; where, as a cook says it. « tasse » is a unit
	// the alias table knows: not "unknown", written as its code in the file. No code on the row.
	await expect(error.locator('.say')).toHaveText('Unité «\u00a0tasse\u00a0» : écrivez cup ; l’app affichera «\u00a0tasse\u00a0».');
	await expect(error.locator('.sub .where')).toHaveText('1er ingrédient (farine)');
	await expect(error).not.toContainText('E201');
	await expect(error).not.toContainText('inconnue');
	// No "who settles it" line: the one fix request sits under the errors.
	await expect(page.locator('.diag.error .ai-fix').getByRole('button', { name: 'Copier la demande de correction' })).toBeVisible();
	// The code, the full place, the path, how to correct it in French and the names the checker
	// cites: one « Détails pour le dépannage » for the file. The checker's English message is the AI's, not shown here.
	const trouble = page.getByTestId('trouble');
	const tech = trouble.locator('.diag-detail', { hasText: 'E201' });
	await expect(tech.locator('.code')).toBeHidden();
	await trouble.getByText('Détails pour le dépannage').click();
	await expect(tech.locator('.code')).toHaveText('E201');
	await expect(tech.locator('.place')).toHaveText('Ingrédients, groupe 1, ligne 1 « farine » : unité');
	await expect(tech).toContainText('ingredients[0].items[0].unit');
	await expect(tech.locator('.snips')).toContainText('Dans la fiche :');
	await expect(tech).not.toContainText('is not allowed');
	await expect(tech).not.toContainText('frontmatter');

	// The box scrolled to the first error's line and marked it in its margin (a paste is no typing).
	await expect(page.locator('.boxwrap .mark')).toHaveCount(1);
	// "Montrer dans le texte", a visible button: it selects the value in the pasted text.
	await error.getByRole('button', { name: 'Montrer dans le texte' }).click();
	const box = page.getByLabel('Réponse de l’IA');
	await expect(box).toBeFocused();
	expect(await box.evaluate((b: HTMLTextAreaElement) => b.value.slice(b.selectionStart, b.selectionEnd))).toBe('tasse');

	// A warning reads on one line: its first sentence, its place; the code and the rest wait in the details.
	// (One remark shows open; more wait behind their count: clicking it opens them.)
	await page.locator('.diag.warning').getByText(/^\d+ remarques?$/).click();
	const w602 = page.locator('.diag.warning .diag-item', { hasText: 'Aucun temps n’est indiqué.' });
	await expect(w602.locator('.text')).toHaveText('Aucun temps n’est indiqué.');
	await expect(w602.locator('.where')).toHaveText('Temps');
	await expect(w602).not.toContainText('W602');
	await expect(trouble.locator('.diag-detail', { hasText: 'W602' })).toContainText('Rien à faire si l’original ne le dit pas.');
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
		// « pintes » is a unit the alias table knows: written as its code (qt), not "unknown".
		await expect(item.locator('.say')).toContainText('écrivez qt');
		await expect(item.locator('.sub .where')).toHaveText('5e ingrédient (eau)');
		await item.getByText('Détails pour le dépannage').click();
		await expect(item.locator('.tech .place')).toHaveText('Ingrédients, groupe 1, ligne 5 « eau » : unité');
		await expect(page.locator('.banner .hint')).toContainText('Remplacer');

		// A file that never passed: listed on the home page.
		writeFileSync(orphan, '---\nschema: 3\nslug: fichier-casse-invente\ningredients:\n  - items:\n      - { qty: 1, unit: cup, name: farine }\n---\n\n## Préparation\n\n1. Mélanger.\n');
		await expect(async () => {
			await page.goto('/');
			await expect(page.locator('.problems')).toBeVisible({ timeout: 500 });
		}).toPass({ timeout: 10_000 });
		await page.locator('.problems > summary').click();
		const e101 = page.locator('.problems .diag-item', { hasText: 'La recette n’a pas de titre.' });
		await expect(e101.locator('.sub .where')).toHaveText('Titre');
		await e101.getByText('Détails pour le dépannage').click();
		await expect(e101.locator('.tech .code')).toHaveText('E101');
	} finally {
		writeFileSync(rel, original);
		rmSync(orphan, { force: true });
	}
	await expect(async () => {
		await page.goto('/r/soupe-aux-pois');
		await expect(page.locator('.banner')).toBeHidden({ timeout: 500 });
	}).toPass({ timeout: 10_000 });
});
