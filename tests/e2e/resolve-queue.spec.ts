import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// The e2e vault (tests/e2e/serve.ts → scripts/fixture-vault.ts).
const VAULT = '/tmp/rv-e2e/vault';
const lastCommit = () => execFileSync('git', ['log', '-1', '--format=%s'], { cwd: VAULT, encoding: 'utf8' }).trim();
const unresolvedCount = async (page: import('@playwright/test').Page, slug: string) => {
	await page.goto(`/r/${slug}`);
	const summary = page.locator('details.unresolved > summary');
	if (!(await summary.count())) return 0;
	return Number((await summary.textContent())!.match(/\((\d+)\)/)![1]);
};

test('the top row of the queue becomes a new ingredient; the recipes using it lose the warning', async ({ page }) => {
	const before = await unresolvedCount(page, 'lasagna-courgettes');
	expect(before).toBeGreaterThan(0);

	await page.goto('/resoudre');
	const nav = page.getByRole('navigation', { name: 'Principale' }).getByRole('link', { name: /À relier/ });
	const n = Number((await nav.textContent())!.match(/\((\d+)\)/)![1]);
	const top = page.locator('li.row').first();
	await expect(top.locator('h2')).toHaveText('feuilles de lasagne');
	await top.getByText('Créer un ingrédient').click();
	await expect(top.getByLabel('Identifiant')).toHaveValue('feuilles-de-lasagne');
	await top.getByLabel('Catégorie').selectOption('epicerie');
	await top.getByRole('button', { name: 'Créer', exact: true }).click();

	await expect(page.locator('.flash')).toHaveText('Ingrédient feuilles-de-lasagne créé.');
	await expect(page.locator('li.row h2', { hasText: /^feuilles de lasagne$/ })).toHaveCount(0);
	await expect(nav).toHaveText(`À relier (${n - 1})`);
	expect(lastCommit()).toBe('ingredient: add feuilles-de-lasagne');
	expect(readFileSync(`${VAULT}/ingredients/feuilles-de-lasagne.md`, 'utf8')).toContain('fr: [feuilles de lasagne]');

	expect(await unresolvedCount(page, 'lasagna-courgettes')).toBe(before - 1);
});

test('an ambiguous name gets a rule on one entry; lines the rule misses stay in the queue', async ({ page }) => {
	await page.goto('/resoudre');
	const row = page.locator('li.row', { has: page.locator('h2', { hasText: /^huile$/ }) });
	await row.getByText('Selon l’unité ou la préparation').click();
	await row.getByLabel('Ingrédient').last().fill('huile-vegetale');
	await row.getByLabel('tout contenant').check();
	await row.getByRole('button', { name: 'Ajouter la règle' }).click();
	await expect(page.locator('.flash')).toHaveText('Règle ajoutée : « huile » va à huile végétale sur 0 lignes qui la remplissent.');
	await expect(page.locator('li.row h2', { hasText: /^huile$/ })).toHaveCount(1);
	expect(lastCommit()).toBe('ingredient: huile-vegetale + rule "huile" (unit: container)');
	expect(readFileSync(`${VAULT}/ingredients/huile-vegetale.md`, 'utf8')).toContain('  - {names: [huile], unit: [container]}');
});

test('an ambiguous name is settled by taking it off one entry', async ({ page }) => {
	await page.goto('/resoudre');
	const row = page.locator('li.row', { has: page.locator('h2', { hasText: /^huile$/ }) });
	await expect(row.getByText('plusieurs ingrédients')).toBeVisible();
	await row.getByRole('button', { name: "Retirer de « huile d'olive »" }).click();
	await expect(page.locator('.flash')).toHaveText("Nom retiré de huile d'olive.");
	await expect(page.locator('li.row h2', { hasText: /^huile$/ })).toHaveCount(0);
	expect(lastCommit()).toBe('ingredient: huile-d-olive - "huile"');
});

test('the browse filter finds recipes with unlinked ingredients', async ({ page }) => {
	await page.goto('/?relies=non');
	await expect(page.locator('.facets')).toContainText('Non reliés au registre');
	await expect(page.getByRole('link', { name: /Soupe aux pois/ }).first()).toBeVisible();
});
