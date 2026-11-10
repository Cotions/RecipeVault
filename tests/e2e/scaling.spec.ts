// Scaling on the recipe page (plan 05, Phase 3): the amount lives in the
// address (Q1 A), an amount can be tapped (Q8 B), print shows the scaled
// recipe, and nothing is ever written (Q9 A). Invented fixture vault.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { ready } from './helpers';

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
	await expect(page.locator('.scale-status .scaled')).toHaveText('recette × 1 ¼');
});

test('a recipe without servings: multiplier, free factor, bounds', async ({ page }) => {
	await page.goto('/r/banana-bread');
	await page.getByRole('group', { name: 'Quantité' }).getByRole('button', { name: /^×\s2$/ }).click();
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
	await expect(page.locator('.ingredients li').filter({ hasText: 'sugar' })).toHaveText('18 tbsp sugar');
	// × 1.5 is one of the choices: it is the one pressed.
	await expect(page.getByRole('group', { name: 'Quantité' }).locator('[aria-pressed="true"]')).toHaveCount(1);
	await expect(page.getByRole('group', { name: 'Quantité' }).getByRole('button')).toHaveCount(5);
	await page.getByRole('button', { name: 'Remettre' }).click();
	await expect(page).toHaveURL(/\/r\/banana-bread$/);
});

test('print shows the scaled recipe and says so', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise?portions=12');
	await page.emulateMedia({ media: 'print' });
	await expect(page.locator('.scaler')).toBeHidden();
	await expect(page.locator('.scale-status .scaled')).toBeVisible();
	await expect(page.locator('.scale-status .scaled')).toHaveText('recette × 2');
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

test('steps show the scaled amount beside the original, with the notice (Q6 B)', async ({ page }) => {
	await page.goto('/r/crepes');
	const step = page.locator('.method ul.steps > li, .method ol > li').first();
	await expect(step).toHaveText('Fouetter la farine, les œufs et le sel. Ajouter 1 ½ tasse de lait peu à peu.');
	await expect(page.locator('.ingredients p.foot')).toHaveCount(0);

	await page.goto('/r/crepes?portions=8');
	await expect(step).toContainText('Ajouter 1 ½ tasse → 3 tasses de lait peu à peu.');
	await expect(step.locator('.step-scaled')).toHaveText(' → 3 tasses');
	// One short note under the list (usability round 6): the times stay the card's; the steps' amounts show their scaled value, so the steps are not named.
	await expect(page.locator('.ingredients p.foot')).toHaveText('Temps inchangés');
	// Times are never scaled.
	await expect(page.locator('.method')).toContainText('Laisser reposer 30 minutes.');

	// An English card reads T as a tablespoon: 2 T × 2 is 4 tbsp, a quarter cup on the ladder.
	await page.goto('/r/molasses-cookies?fois=2');
	await expect(page.locator('.method .step-scaled')).toHaveText(' → ¼ cup');
});

test('Back from a sub-recipe keeps the amount set by hand (review, Q1 A)', async ({ page }) => {
	await page.goto('/r/tarte-au-sucre');
	await page.getByRole('button', { name: 'Plus de portions' }).click();
	await page.getByRole('button', { name: 'Plus de portions' }).click();
	const url = page.url();
	expect(url).toMatch(/\?portions=\d+$/);
	const output = await page.locator('.scaler output').textContent();
	await page.locator('.ingredients').getByRole('link', { name: 'Recette : pâte brisée' }).click();
	await expect(page).toHaveURL(/\/r\/pate-brisee/);
	await page.goBack();
	await expect(page).toHaveURL(url);
	await expect(page.locator('.scaler output')).toHaveText(output!);
	// Forward and Back again: the sub-recipe at its amount, then the tarte at hers.
	await page.goForward();
	await expect(page).toHaveURL(/\/r\/pate-brisee\?fois=/);
	await page.goBack();
	await expect(page).toHaveURL(url);
});

test('a sub-recipe link carries the amount the line needs (Q5 A)', async ({ page }) => {
	// One crust of a pastry that makes two: the half pastry, at the card's own amount already.
	await page.goto('/r/tarte-au-sucre');
	const pastry = page.locator('.ingredients').getByRole('link', { name: 'Recette : pâte brisée' });
	await expect(pastry).toHaveAttribute('href', '/r/pate-brisee?fois=0.5');
	await page.getByRole('button', { name: 'Plus de portions' }).click();
	await expect(pastry).toHaveAttribute('href', '/r/pate-brisee?fois=0.5625');
	await page.goto('/r/tarte-au-sucre?portions=16');
	await expect(pastry).toHaveAttribute('href', '/r/pate-brisee');
	await pastry.click();
	await expect(page).toHaveURL(/\/r\/pate-brisee$/);
	await page.goto('/r/tarte-au-sucre?portions=24');
	await pastry.click();
	await expect(page).toHaveURL(/\/r\/pate-brisee\?fois=1.5$/);
	await expect(page.locator('.ingredients li').filter({ hasText: 'farine' })).toContainText('3 ¾ tasses de farine');

	// A text yield cannot be scaled by the rule: the page as written.
	await page.goto('/r/sauce-tomate-maison?fois=2');
	await expect(page.locator('.ingredients').getByRole('link', { name: 'Recette : bouillon de légumes' })).toHaveAttribute('href', '/r/bouillon-de-legumes');
});

test('the controls stay put; the count asks for a number, the factor beside it', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise');
	const plus = page.getByRole('button', { name: 'Plus de portions' });
	await expect(plus).toBeVisible();
	const before = await plus.boundingBox();
	await plus.click();
	await expect(page.getByRole('button', { name: 'Remettre' })).toBeVisible();
	// « Remettre » and the factor came on the line under the controls: the second tap lands on « + » again.
	expect(await plus.boundingBox()).toEqual(before);
	await plus.click();
	await expect(page).toHaveURL(/\?portions=8$/);

	// With servings there is no « Autre quantité »: the stepper's count is the way to type one (UI round 2).
	await expect(page.getByRole('button', { name: 'Autre quantité' })).toHaveCount(0);
	await page.getByRole('button', { name: /portions — taper un nombre/ }).click();
	const ask = page.locator('form.ask');
	await expect(ask).toContainText('Pour');
	await expect(ask).toContainText('portions');
	await expect(ask.getByRole('textbox')).toHaveValue('8');
	await ask.getByRole('textbox').fill('9');
	await expect(ask.locator('output.typed')).toHaveText('= × 1 ½');
	await ask.getByRole('button', { name: 'Ajuster' }).click();
	await expect(page).toHaveURL(/\?portions=9$/);
	await expect(page.locator('.scaler output')).toContainText('9');
	await expect(beef(page)).toHaveText('750 g de bœuf haché');

	// A yield that is one count: « Pour [3] … » too, the address a factor.
	await page.goto('/r/banana-bread');
	await page.getByRole('button', { name: 'Autre quantité' }).click();
	await expect(page.locator('form.ask')).toContainText('loaf');
	await page.locator('form.ask').getByRole('textbox').fill('2');
	await page.locator('form.ask').getByRole('button', { name: 'Ajuster' }).click();
	await expect(page).toHaveURL(/\?fois=2$/);
});

test('scaled: one line under the controls, one note under the list, nothing above the steps (usability round 6)', async ({ page }) => {
	await page.goto('/r/pouding-chomeur?portions=12');
	const status = page.locator('.scale-status');
	await expect(status.locator('.scaled')).toHaveText('recette × 1 ½');
	await expect(status.getByRole('button', { name: 'Remettre' })).toBeVisible();
	await expect(page.locator('.ingredients p.foot')).toHaveCount(1);
	await expect(page.locator('.ingredients p.foot')).toContainText('Étapes, temps et four inchangés');
	await expect(page.locator('.method .scale-notice')).toHaveCount(0);
	// At × 1 the line says nothing: the head says how many it serves.
	await status.getByRole('button', { name: 'Remettre' }).click();
	await expect(page).toHaveURL(/\/r\/pouding-chomeur$/);
	await expect(status).not.toContainText('Quantités');
	await expect(status).not.toContainText('Donne');
	await expect(page.locator('.ingredients p.foot')).toHaveCount(0);
});

test('a bare count reads in the form its number needs, from the ingredient’s names', async ({ page }) => {
	// « 2 œufs » for 4: one egg for 2.
	await page.goto('/r/crepes?portions=2');
	await expect(page.locator('.ingredients li').filter({ hasText: /œuf/ })).toHaveText(/^\s*1 œuf\b(?!s)/);
	await page.goto('/r/crepes?portions=8');
	await expect(page.locator('.ingredients li').filter({ hasText: /œuf/ })).toHaveText(/^\s*4 œufs/);
});

test('a scaled bare count agrees in French: the name and its participle (round 2 of the usability pass)', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise?portions=12');
	await expect(page.locator('.ingredients li').filter({ hasText: /oignon/ })).toContainText('2 oignons émincés');
	await page.goto('/r/lasagna-bolognaise?portions=9');
	await expect(page.locator('.ingredients li').filter({ hasText: /oignon/ })).toContainText('1 ½ oignon émincé');
});

test('nothing moves when the amount changes; the hint goes at the first scale or its ✕ (usability round 6)', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise');
	await page.evaluate(() => localStorage.removeItem('rv-tap-hint'));
	await page.reload();
	const hint = page.locator('.tap-hint');
	// At × 1 the hint holds the scale line's place.
	await expect(hint).toBeVisible();
	await expect(hint).toContainText('Touchez une quantité pour tout ajuster');
	const first = page.locator('.ingredients .group li').first();
	const before = await first.boundingBox();
	await page.getByRole('button', { name: 'Plus de portions' }).click();
	await expect(page.locator('.scale-status .scaled')).toContainText('recette ×');
	// Scaled once: the hint has done its work, on this device.
	await expect(hint).toHaveCount(0);
	expect(await first.boundingBox()).toEqual(before);
	await page.getByRole('button', { name: 'Remettre' }).click();
	expect(await first.boundingBox()).toEqual(before);
	await page.reload();
	await expect(page.locator('.scale-status')).toBeAttached();
	await expect(hint).toHaveCount(0);

	// Or closed at its ✕.
	await page.evaluate(() => localStorage.removeItem('rv-tap-hint'));
	await page.reload();
	await hint.getByRole('button', { name: 'Masquer l’astuce' }).click();
	await expect(hint).toHaveCount(0);
	await page.reload();
	await expect(page.locator('.scale-status')).toBeAttached();
	await expect(hint).toHaveCount(0);
});

test('Escape closes « J’en ai » and gives the focus back to the amount', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise');
	const amount = beef(page).getByRole('button', { name: '500 g' });
	await amount.click();
	await expect(page.locator('form.ask').getByRole('textbox')).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(page.locator('form.ask')).toHaveCount(0);
	await expect(amount).toBeFocused();
});

test('a cook in progress on this device: « Reprendre · étape N », at the session’s amount', async ({ page }) => {
	await page.goto('/r/crepes/cuisine?portions=8');
	await expect(page.locator('.kitchen')).toBeVisible();
	await ready(page);
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('rv-kitchen:crepes') ?? '{}').step)).toBeGreaterThanOrEqual(1);
	const step = await page.evaluate(() => JSON.parse(localStorage.getItem('rv-kitchen:crepes')!).step as number);
	await page.goto('/r/crepes');
	const cook = page.getByTestId('cook');
	// The session's amount is not the page's: said, so the jump to 8 portions is no surprise (usability round 3).
	await expect(cook).toHaveText(`Reprendre · étape ${step + 1} · 8 portions`);
	await expect(cook).toHaveAttribute('href', '/r/crepes/cuisine');
	await cook.click();
	await expect(page.locator('.scaler output')).toContainText('8');
	// The page at the session's amount: nothing more to say.
	await page.goto('/r/crepes?portions=8');
	await expect(page.getByTestId('cook')).toHaveText(`Reprendre · étape ${step + 1}`);
	// Another recipe content (or no session): « Cuisiner » with the page's amount.
	await page.evaluate(() => localStorage.removeItem('rv-kitchen:crepes'));
	await page.goto('/r/crepes');
	await expect(page.getByTestId('cook')).toHaveText('Cuisiner');
});

test('the count is a field: tap it and type; one control row (usability round 6)', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise');
	await page.getByRole('button', { name: '6 portions — taper un nombre' }).click();
	const ask = page.locator('form.ask');
	await expect(ask.getByRole('textbox')).toBeFocused();
	await ask.getByRole('textbox').fill('10');
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(/\?portions=10$/);
	await expect(page.locator('.scaler output')).toContainText('10');
	// The stepper and « Autre quantité »: no second row of multipliers beside it.
	await expect(page.locator('.ing-head .pill')).toHaveCount(1);
	await expect(page.locator('.ing-head').getByRole('button', { name: /^×/ })).toHaveCount(0);
});

test('« J’en ai » at another amount says both: the scaled amount and the base', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise?portions=12');
	await beef(page).getByRole('button', { name: '1 kg' }).click();
	await expect(page.locator('form.ask')).toContainText('La recette × 2 demande 1 kg (base : 500 g). J’en ai :');
});

test('scaled: half an egg is said in yolks, and a footnote says what the steps keep', async ({ page }) => {
	// 2 œufs for 8: at 6, 1 ½ œuf.
	await page.goto('/r/pouding-chomeur?portions=6');
	await expect(page.locator('.ingredients li').filter({ hasText: 'œuf' })).toContainText('(1 œuf + 1 jaune)');
	// One note: the steps (no amount in them shows a scaled value), times and oven stay the card's.
	await expect(page.locator('.ingredients p.foot')).toContainText('Étapes, temps et four inchangés');
	// « Verser la pâte dans un plat beurré »: a pan without a size, the surface it takes, in the same note.
	await expect(page.locator('.ingredients p.foot')).toContainText('moule : × ¾ la surface');
	await expect(page.locator('.ingredients p.foot')).not.toContainText('moule inchangé');
	// At the recipe as written: no help, no footnote.
	await page.goto('/r/pouding-chomeur');
	await expect(page.locator('.ingredients li').filter({ hasText: 'œuf' })).not.toContainText('jaune');
	await expect(page.locator('.ingredients p.foot')).toHaveCount(0);
});
