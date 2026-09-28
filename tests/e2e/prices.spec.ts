import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// The e2e vault (tests/e2e/serve.ts → scripts/fixture-vault.ts).
const VAULT = '/tmp/rv-e2e/vault';
const lastCommit = () => execFileSync('git', ['log', '-1', '--format=%s'], { cwd: VAULT, encoding: 'utf8' }).trim();
const priceLines = () => readFileSync(`${VAULT}/prices.csv`, 'utf8').trimEnd().split('\n');

test('a price entered inline is appended to prices.csv, committed, and shown after a reload', async ({ page }) => {
	const before = priceLines().length;
	await page.goto('/ingredients');
	await expect(page.getByRole('navigation', { name: 'Principale' }).getByRole('link', { name: 'Ingrédients' })).toHaveAttribute('aria-current', 'page');
	// Unpriced and most used first.
	const first = page.locator('tbody tr').first();
	await expect(first.locator('.none')).toHaveText('Aucun prix');

	const row = page.locator('#i-farine');
	await row.getByRole('button', { name: 'Saisir un prix pour farine' }).click();
	const amount = page.locator('#amount-farine');
	await expect(amount).toBeFocused();
	await amount.fill('4,99');
	await page.keyboard.press('Tab');
	await page.keyboard.type('2.5');
	await page.getByLabel('Unité').selectOption('kg');
	await page.getByLabel('Magasin').fill('Épicerie inventée');
	await page.getByLabel('Magasin').press('Enter');

	await expect(page.locator('.flash')).toContainText('Prix enregistré : farine, 4,99');
	// The editor moved down one row.
	await expect(page.locator('tr.editor input[name="amount"]')).toBeFocused();
	await expect(page.locator('tr.editor input[name="shop"]')).toHaveValue('Épicerie inventée');
	await page.keyboard.press('Escape');
	await expect(page.locator('tr.editor')).toHaveCount(0);

	expect(priceLines()).toHaveLength(before + 1);
	expect(priceLines().at(-1)).toMatch(/^\d{4}-\d{2}-\d{2},farine,4.99,CAD,2.5,kg,Épicerie inventée,$/);
	expect(lastCommit()).toBe('price: farine 4.99 / 2.5 kg');

	await page.reload();
	await expect(page.locator('#i-farine .money')).toHaveText(/4,99\s\$/);
	await expect(page.locator('#i-farine .pack')).toHaveText('/ 2,5 kg');

	// Its default unit is g: the editor still takes size and unit together from the last price.
	await page.locator('#i-farine').getByRole('button', { name: 'Saisir un prix pour farine' }).click();
	await expect(page.locator('tr.editor input[name="pack_qty"]')).toHaveValue('2.5');
	await expect(page.locator('tr.editor select[name="pack_unit"]')).toHaveValue('kg');
});

test('filters and sorts live in the URL', async ({ page }) => {
	await page.goto('/ingredients?prix=oui');
	await expect(page.locator('tbody tr')).not.toHaveCount(0);
	for (const r of await page.locator('tbody tr').all()) await expect(r.locator('.money')).toBeVisible();
	await page.getByRole('link', { name: 'Ingrédient', exact: true }).click();
	await expect(page).toHaveURL(/tri=nom/);
	await expect(page.locator('thead th.nom')).toHaveAttribute('aria-sort', 'ascending');
});
