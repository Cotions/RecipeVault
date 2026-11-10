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
	// The total in the page's head, and on the « Plus » line (« À relier · N »).
	const nav = page.getByTestId('more').locator('..').getByRole('link', { name: /^À relier\b/, includeHidden: true });
	await expect(nav).toHaveCount(1);
	const head = page.locator('header.page-head .count');
	const n = Number((await head.textContent())!.match(/\d+/)![0]);
	const top = page.locator('li.row').first();
	await expect(top.locator('h2')).toHaveText('feuilles de lasagne');
	await top.getByText('Créer un ingrédient').click();
	await expect(top.getByLabel('Identifiant')).toHaveValue('feuilles-de-lasagne');
	await top.getByLabel('Catégorie').selectOption('epicerie');
	await top.getByRole('button', { name: 'Créer', exact: true }).click();

	await expect(page.getByTestId('toast')).toContainText('Ingrédient feuilles-de-lasagne créé.');
	await expect(page.locator('li.row h2', { hasText: /^feuilles de lasagne$/ })).toHaveCount(0);
	await expect(head).toHaveText(new RegExp(`^${n - 1} ingrédients? à relier$`));
	expect(lastCommit()).toBe('ingredient: add feuilles-de-lasagne');
	expect(readFileSync(`${VAULT}/ingredients/feuilles-de-lasagne.md`, 'utf8')).toContain('fr: [feuilles de lasagne]');

	expect(await unresolvedCount(page, 'lasagna-courgettes')).toBe(before - 1);
});

test('an ambiguous name gets a rule on one entry; lines the rule misses stay in the queue', async ({ page }) => {
	await page.goto('/resoudre?cle=huile'); // the queue shows 30 rows; earlier specs add names
	const row = page.locator('li.row', { has: page.locator('h2', { hasText: /^huile$/ }) });
	await row.getByText('Selon l’unité ou la préparation').click();
	await row.getByLabel('Ingrédient').last().fill('huile-vegetale');
	await row.getByLabel('tout contenant').check();
	await row.getByRole('button', { name: 'Ajouter la règle' }).click();
	await expect(page.getByTestId('toast')).toContainText('Règle ajoutée : « huile » va à huile végétale sur 0 lignes qui la remplissent.');
	await expect(page.locator('li.row h2', { hasText: /^huile$/ })).toHaveCount(1);
	expect(lastCommit()).toBe('ingredient: huile-vegetale + rule "huile" (unit: container)');
	expect(readFileSync(`${VAULT}/ingredients/huile-vegetale.md`, 'utf8')).toContain('  - {names: [huile], unit: [container]}');
});

test('an ambiguous name is settled by taking it off one entry', async ({ page }) => {
	await page.goto('/resoudre?cle=huile'); // the queue shows 30 rows; earlier specs add names
	const row = page.locator('li.row', { has: page.locator('h2', { hasText: /^huile$/ }) });
	await expect(row.getByText('plusieurs ingrédients')).toBeVisible();
	await row.getByRole('button', { name: "Retirer de « huile d'olive »" }).click();
	await expect(page.getByTestId('toast')).toContainText("Nom retiré de huile d'olive.");
	await expect(page.locator('li.row h2', { hasText: /^huile$/ })).toHaveCount(0);
	expect(lastCommit()).toBe('ingredient: huile-d-olive - "huile"');
});

test('the browse filter finds recipes with unlinked ingredients', async ({ page }) => {
	await page.goto('/?relies=non&q=soupe'); // one page of results; earlier specs add recipes
	await expect(page.locator('.facets')).toContainText('Ingrédients à relier');
	await expect(page.getByRole('link', { name: /Soupe aux pois/ }).first()).toBeVisible();
});

test('the queue shows 30 names at a time: « 30 sur N — Voir les suivants », the total in the heading', async ({ page }) => {
	await page.goto('/resoudre');
	await expect(page.locator('main')).toContainText(/\d+ ingrédients? à relier/);
	const more = page.getByTestId('queue-more');
	if (!(await more.count())) return; // fewer than 30 waiting
	await expect(page.locator('li.row')).toHaveCount(30);
	await expect(more).toHaveText(/^30 sur \d+ — Voir les suivants$/);
	await more.getByRole('link', { name: 'Voir les suivants' }).click();
	await expect(page).toHaveURL(/\?n=60$/);
	expect(await page.locator('li.row').count()).toBeGreaterThan(30);
});

test('linking a name says so in the toast, and « Annuler » there puts the entry back', async ({ page }) => {
	await page.goto('/resoudre?cle=sarriette');
	const row = page.locator('li.row', { has: page.locator('h2', { hasText: /^sarriette$/ }) });
	if (!(await row.count())) test.skip(true, 'sarriette already linked on this vault');
	const before = lastCommit();
	await row.getByText('Relier à un ingrédient existant').click();
	await row.getByLabel('Ingrédient').first().fill('laurier');
	await row.getByRole('button', { name: 'Relier', exact: true }).click();
	await expect(row).toHaveCount(0);
	await expect(page.getByTestId('toast')).toContainText('sarriette');
	await page.getByTestId('toast').getByRole('button', { name: 'Annuler' }).click();
	await expect(row).toHaveCount(1);
	expect(lastCommit()).toMatch(/^undo: ingredient: /);
	expect(lastCommit()).not.toBe(before);
});

test('on a keyboard, « 1 » takes the focused row’s clear match; the count in the head follows, and « Annuler » puts it back', async ({ page }) => {
	await page.goto('/resoudre?n=1000');
	const row = page.locator('ol.queue > li.row', { has: page.locator('[data-pick][data-sure]') }).first();
	if (!(await row.count())) test.skip(true, 'no name with a clear match on this vault');
	const key = (await row.locator('h2').textContent())!.trim();
	const head = page.locator('header.page-head .count');
	const n = Number((await head.textContent())!.match(/\d+/)![0]);
	// A clear match first, the primary button.
	await expect(row.locator('[data-pick]').first()).toHaveClass(/primary/);
	await row.locator('a').first().focus();
	await page.keyboard.press('1');
	await expect(page.locator('li.row h2', { hasText: new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })).toHaveCount(0);
	// The toast says how many recipes the link changed.
	await expect(page.getByTestId('toast')).toContainText(new RegExp(`${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.* dans \\d+ recettes?`));
	await expect(head).toHaveText(new RegExp(`^${n - 1} ingrédients? à relier$`));
	expect(lastCommit()).toMatch(/^ingredient: .* \+ "/);
	await page.getByTestId('toast').getByRole('button', { name: 'Annuler' }).click();
	await expect.poll(lastCommit).toMatch(/^undo: ingredient: /);
	await expect(head).toHaveText(new RegExp(`^${n} ingrédients? à relier$`));
});

test('a guess is no primary button: « 1 » only puts the focus on it, nothing is linked', async ({ page }) => {
	await page.goto('/resoudre?n=1000');
	const row = page.locator('ol.queue > li.row', { has: page.locator('[data-pick]'), hasNot: page.locator('[data-sure]') }).first();
	if (!(await row.count())) test.skip(true, 'no name with only guesses on this vault');
	const before = lastCommit();
	const first = row.locator('[data-pick]').first();
	await expect(first).not.toHaveClass(/primary/);
	await expect(row.locator('h3').first()).toHaveText('Peut-être (à vérifier)');
	await row.locator('a').first().focus();
	await page.keyboard.press('1');
	await expect(first).toBeFocused();
	expect(lastCommit()).toBe(before);
});
