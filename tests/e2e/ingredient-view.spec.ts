import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// The ingredient view, /ingredients/<slug> (plan 03, Phase 6), on the e2e
// vault (tests/e2e/serve.ts → scripts/fixture-vault.ts). Leaves "feuilles de
// lasagne", "huile" and Soupe aux pois alone: resolve-queue.spec.ts uses them.
const VAULT = '/tmp/rv-e2e/vault';
const lastCommit = () => execFileSync('git', ['log', '-1', '--format=%s'], { cwd: VAULT, encoding: 'utf8' }).trim();

test('a recipe ingredient links to its view: prices, recipes by quantity, substitutes', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise');
	await page.locator('a.item', { hasText: 'tomates concassées' }).first().click();
	await expect(page).toHaveURL('/ingredients/tomates-concassees');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('tomates concassées');
	await expect(page.locator('.current .money')).toHaveText(/0,89\s\$/);
	await expect(page.locator('.total')).toContainText('Total dans le coffre : 2400 g dans 3 recettes');
	await expect(page.locator('ol.uses li')).toHaveCount(3);
	await expect(page.locator('section', { has: page.locator('h3', { hasText: 'Se remplace par' }) }).getByRole('link', { name: 'coulis de tomate' })).toBeVisible();
});

test('adding a name from the view resolves the recipe that writes it', async ({ page }) => {
	await page.goto('/r/sauce-tomate-maison');
	const unresolved = page.locator('details.unresolved > summary');
	const before = Number((await unresolved.textContent())!.match(/\((\d+)\)/)![1]);

	await page.goto('/ingredients/tomates-concassees');
	await page.getByLabel('Nom tel qu’écrit dans les recettes').fill('tomates entières');
	await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
	await expect(page.locator('.flash')).toContainText('Nom « tomates entières » ajouté.');
	await expect(page.locator('dl.names')).toContainText('tomates entières');
	expect(lastCommit()).toBe('ingredient: tomates-concassees + "tomates entières"');

	await page.goto('/r/sauce-tomate-maison');
	await expect(page.locator('a.item', { hasText: 'tomates entières' })).toHaveAttribute('href', '/ingredients/tomates-concassees');
	if (before === 1) await expect(unresolved).toHaveCount(0);
	else await expect(unresolved).toContainText(`(${before - 1})`);
});

test('"Relier ici" links a drifting unresolved name, and the recipe follows', async ({ page }) => {
	await page.goto('/ingredients/tomates-concassees');
	const row = page.locator('ul.drift li', { hasText: '« tomates »' });
	await row.getByRole('button', { name: 'Relier ici' }).click();
	await expect(page.locator('.flash')).toHaveText('« tomates » est relié à cet ingrédient.');
	await expect(page.locator('ul.drift li', { hasText: '« tomates »' })).toHaveCount(0);
	expect(lastCommit()).toBe('ingredient: tomates-concassees + "tomates"');
	await page.goto('/r/ketchup-aux-fruits');
	await expect(page.locator('a.item', { hasText: /^tomates$/ })).toHaveAttribute('href', '/ingredients/tomates-concassees');
});

test('editing the fields commits the file; merging deletes the duplicate and lands on the target', async ({ page }) => {
	await page.goto('/ingredients/margarine');
	await page.getByText('Modifier l’ingrédient').click();
	await page.getByLabel('Densité (g par ml)').fill('0,95');
	await page.getByRole('button', { name: 'Enregistrer' }).click();
	await expect(page.locator('.flash')).toHaveText('Ingrédient enregistré.');
	await expect(page.locator('dl.facts')).toContainText('0,95 g par ml');
	expect(lastCommit()).toBe('ingredient: edit margarine');
	expect(readFileSync(`${VAULT}/ingredients/margarine.md`, 'utf8')).toContain('density: 0.95');

	await page.getByText('Fusionner dans…').click();
	await page.getByLabel('Ingrédient qui le remplace').fill('beurre');
	page.once('dialog', (d) => d.accept());
	await page.getByRole('button', { name: 'Fusionner' }).click();
	await expect(page).toHaveURL(/\/ingredients\/beurre\?fusion=margarine/);
	await expect(page.locator('.flash')).toHaveText('« margarine » a été fusionné dans beurre.');
	await expect(page.locator('dl.names')).toContainText('margarine');
	expect(lastCommit()).toBe('ingredient: merge margarine into beurre');
	expect(existsSync(`${VAULT}/ingredients/margarine.md`)).toBe(false);
});

test('a merge is refused when the absorbed ingredient has prices', async ({ page }) => {
	await page.goto('/ingredients/oeuf');
	await page.getByText('Fusionner dans…').click();
	await page.getByLabel('Ingrédient qui le remplace').fill('beurre');
	page.once('dialog', (d) => d.accept());
	await page.getByRole('button', { name: 'Fusionner' }).click();
	await expect(page.locator('.flash.error')).toContainText('prices.csv');
	expect(existsSync(`${VAULT}/ingredients/oeuf.md`)).toBe(true);
});
