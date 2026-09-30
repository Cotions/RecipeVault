// Scaling on the recipe page (plan 05, Phase 3): the amount lives in the
// address (Q1 A), an amount can be tapped (Q8 B), print shows the scaled
// recipe, and nothing is ever written (Q9 A). Invented fixture vault.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const VAULT = '/tmp/rv-e2e/vault';
const git = (...args: string[]) => execFileSync('git', args, { cwd: VAULT, encoding: 'utf8' }).trim();
const beef = (page: import('@playwright/test').Page) => page.locator('.ingredients li').filter({ hasText: 'bœuf haché' });

test('the amount is in the address: a reload, a link and the kitchen link keep it', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise?portions=12');
	await expect(page.locator('.scaler output')).toContainText('12');
	await expect(beef(page)).toHaveText('1 kg de bœuf haché');
	await expect(page.getByRole('link', { name: 'Cuisiner' })).toHaveAttribute('href', '/r/lasagna-bolognaise/cuisine?portions=12');

	await page.getByRole('button', { name: 'Moins de portions' }).click();
	await expect(page).toHaveURL(/\?portions=11$/);
	await page.reload();
	await expect(page.locator('.scaler output')).toContainText('11');

	await page.getByRole('button', { name: 'Remettre' }).click();
	await expect(page).toHaveURL(/\/r\/lasagna-bolognaise$/);
	await expect(beef(page)).toHaveText('500 g de bœuf haché');
	await expect(page.getByRole('link', { name: 'Cuisiner' })).toHaveAttribute('href', '/r/lasagna-bolognaise/cuisine?portions=6');

	// A bad address is ignored: the recipe as written.
	for (const q of ['portions=0', 'fois=abc', 'portions=1e9']) {
		await page.goto(`/r/lasagna-bolognaise?${q}`);
		await expect(page.locator('.scaler output')).toContainText('6');
		await expect(beef(page)).toHaveText('500 g de bœuf haché');
	}
});

test('tap an amount: « j’en ai » sets the factor', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise');
	await beef(page).getByRole('button', { name: '500 g' }).click();
	const ask = page.locator('form.ask');
	await expect(ask).toContainText('La recette demande 500 g. J’en ai :');
	await ask.getByRole('textbox').fill('abc');
	await ask.getByRole('button', { name: 'Ajuster' }).click();
	await expect(ask.getByRole('alert')).toHaveText('Écrivez un nombre : 3, 2,5 ou 1 1/2.');
	await ask.getByRole('textbox').fill('750');
	await ask.getByRole('button', { name: 'Ajuster' }).click();
	await expect(ask).toHaveCount(0);
	await expect(page.locator('.scaler output')).toContainText('9');
	await expect(page).toHaveURL(/\?portions=9$/);
	await expect(beef(page)).toHaveText('750 g de bœuf haché');

	// Not a whole number of servings: the factor, in the address and on screen.
	await page.locator('.ingredients li').filter({ hasText: 'gousses d’ail' }).getByRole('button').first().click();
	await page.locator('form.ask').getByRole('textbox').fill('1');
	await page.locator('form.ask').getByRole('button', { name: 'Ajuster' }).click();
	await expect(page).toHaveURL(/\?portions=3$/);
	await page.locator('.ingredients li').filter({ hasText: 'laurier' }).getByRole('button').first().click();
	await page.locator('form.ask').getByRole('textbox').fill('1 1/4');
	await page.locator('form.ask').getByRole('button', { name: 'Ajuster' }).click();
	await expect(page).toHaveURL(/\?fois=1\.25$/);
	await expect(page.locator('p.scaled')).toHaveText('recette × 1 ¼');
});

test('a recipe without servings: multiplier, free factor, bounds', async ({ page }) => {
	await page.goto('/r/banana-bread');
	await page.getByLabel('Quantité').selectOption('2');
	await expect(page).toHaveURL(/\?fois=2$/);
	await expect(page.locator('.ingredients li').filter({ hasText: 'sugar' })).toHaveText('1 ½ cups sugar');
	await page.getByRole('button', { name: 'Autre quantité' }).click();
	const ask = page.locator('form.ask');
	await ask.getByRole('textbox').fill('50');
	await ask.getByRole('button', { name: 'Ajuster' }).click();
	await expect(ask.getByRole('alert')).toHaveText('Entre × 0,1 et × 20.');
	await ask.getByRole('textbox').fill('1,5');
	await ask.getByRole('button', { name: 'Ajuster' }).click();
	await expect(page).toHaveURL(/\?fois=1\.5$/);
	await expect(page.locator('.ingredients li').filter({ hasText: 'sugar' })).toHaveText('≈ 1 cup sugar');
	await expect(page.getByLabel('Quantité')).toHaveValue('1.5');
	await page.getByRole('button', { name: 'Remettre' }).click();
	await expect(page).toHaveURL(/\/r\/banana-bread$/);
});

test('print shows the scaled recipe and says so', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise?portions=12');
	await page.emulateMedia({ media: 'print' });
	await expect(page.locator('.scaler')).toBeHidden();
	await expect(page.locator('p.scaled')).toBeVisible();
	await expect(page.locator('p.scaled')).toHaveText('recette × 2');
	await expect(beef(page)).toHaveText('1 kg de bœuf haché');
	await expect(page.locator('.facts')).toContainText('12');
});

test('scaling makes no request and writes nothing', async ({ page }) => {
	const file = `${VAULT}/recipes/lasagna-bolognaise.md`;
	const before = readFileSync(file, 'utf8');
	const head = git('rev-parse', 'HEAD');
	await page.goto('/r/lasagna-bolognaise');
	await expect(page.locator('.scaler output')).toContainText('6');
	const requests: string[] = [];
	page.on('request', (r) => requests.push(`${r.method()} ${r.url()}`));
	await page.getByRole('button', { name: 'Plus de portions' }).click();
	await page.getByRole('button', { name: 'Plus de portions' }).click();
	await beef(page).getByRole('button').first().click();
	await page.locator('form.ask').getByRole('textbox').fill('1000');
	await page.locator('form.ask').getByRole('button', { name: 'Ajuster' }).click();
	await expect(page).toHaveURL(/\?portions=12$/);
	expect(requests).toEqual([]);
	expect(readFileSync(file, 'utf8')).toBe(before);
	expect(git('rev-parse', 'HEAD')).toBe(head);
	expect(git('status', '--porcelain')).toBe('');
});
