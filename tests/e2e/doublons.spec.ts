import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { devices, expect, test } from '@playwright/test';
import { file } from './helpers';

// Possible duplicates, /doublons (plan 05, Phase 7; Q13 B), on a phone. Plants
// three invented pairs, each on ingredients no other spec uses, and settles
// each one a different way: one commit each, each undoable.
const VAULT = '/tmp/rv-e2e/vault';
const git = (...args: string[]) => execFileSync('git', args, { cwd: VAULT, encoding: 'utf8' }).trim();
const { defaultBrowserType: _, ...phone } = devices['Pixel 7'];
test.use(phone);

const lines = (...names: string[]) => names.map((n, i) => `      - { qty: ${i + 1}, unit: cup, name: ${n} }`).join('\n');
const ABRICOTS = lines('abricots secs', 'miel de trèfle', 'amandes effilées', 'cardamome');
const AVOINE = lines('gruau à cuisson rapide', 'mélasse de fantaisie', 'raisins de Corinthe', 'macis');
const DATTES = lines('dattes Medjool', 'noix de coco râpée', 'chapelure graham', 'lait concentré sucré');

test('pairs on /doublons: compare, "Deux versions", "Même recette" with undo, "Recettes différentes"', async ({ page, baseURL }) => {
	const saved = await page.request.post('/api/save', {
		headers: { origin: baseURL! },
		data: {
			files: [
				{ text: file('Abricots au four', '', ABRICOTS) },
				{ text: file('Abricots rôtis de tante Zoé', '', ABRICOTS) },
				{ text: file('Barres à l’avoine de Lise', '', AVOINE) },
				{ text: file('Barres avoine', '', AVOINE) },
				{ text: file('Carrés aux dattes', '', DATTES) },
				{ text: file('Carrés magiques', '', DATTES) }
			]
		}
	});
	expect(saved.ok()).toBe(true);

	await page.goto('/');
	await page.getByTestId('more').click();
	// The menu line gives the total, then what is new on this device (« Doublons · 3 · 1 nouveau »).
	await page.getByRole('link', { name: /^Doublons( · \d+)?( · \d+ nouveaux?)?$/ }).click();
	await expect(page).toHaveURL('/doublons');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Doublons possibles');

	// Compare, read-only.
	const abricots = page.locator('li.card[data-pair="abricots-au-four abricots-rotis-de-tante-zoe"]');
	await expect(abricots.locator('.score')).toHaveText('100 % en commun');
	await abricots.getByRole('link', { name: 'Comparer' }).click();
	await expect(page.getByTestId('compare')).toContainText('Abricots rôtis de tante Zoé');
	await expect(page.getByText('Les deux recettes sont identiques, au titre près.')).toBeVisible();
	await page.getByRole('link', { name: /Retour aux doublons/ }).click();

	// "Deux versions": both in one new family, one commit.
	await abricots.getByText('Deux variantes du même plat').click();
	// The group's name: the shorter title, never a slug.
	await expect(abricots.getByLabel('Nom du groupe', { exact: true })).toHaveValue('Abricots au four');
	await abricots.getByLabel('Ce qui distingue « Abricots au four »').fill('au four');
	await abricots.getByLabel('Ce qui distingue « Abricots rôtis de tante Zoé »').fill('de tante Zoé');
	await abricots.getByRole('button', { name: 'En faire deux variantes' }).click();
	// One undo per decision: the receipt where the card stood, no toast.
	await expect(page.getByTestId('receipt').filter({ hasText: 'Abricots au four : 2 variantes' })).toBeVisible();
	await expect(page.getByTestId('toast')).toHaveCount(0);
	expect(git('log', '-1', '--format=%s|%an')).toBe('edit: Abricots au four; edit: Abricots rôtis de tante Zoé|Proprio Inventé');
	expect(git('show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual([
		'recipes/abricots-au-four.md',
		'recipes/abricots-rotis-de-tante-zoe.md',
		'vocab/families.yaml'
	]);
	expect(readFileSync(`${VAULT}/recipes/abricots-rotis-de-tante-zoe.md`, 'utf8')).toContain('family: abricots-au-four');
	// Identical ingredients in one family: still listed (Q16 C), without the offer.
	// The decided card is rebuilt closed (receipt above it), so open its « Deux variantes » panel again.
	const versions = abricots.locator('.actions > details').first();
	if (!(await versions.evaluate((d) => (d as HTMLDetailsElement).open))) await versions.locator('summary').click();
	await expect(abricots.getByText('Déjà variantes du même plat')).toBeVisible();

	// "Même recette": the other to the trash, then "Annuler".
	const avoine = page.locator('li.card[data-pair="barres-a-l-avoine-de-lise barres-avoine"]');
	await avoine.getByText('C’est la même recette').click();
	await avoine.getByLabel('Garder « Barres à l’avoine de Lise »').check();
	await avoine.getByRole('button', { name: 'Mettre l’autre à la corbeille' }).click();
	const avoineReceipt = page.getByTestId('receipt').filter({ hasText: 'Barres à l’avoine de Lise gardée · 1 fiche à la corbeille' });
	await expect(avoineReceipt).toBeVisible();
	expect(git('log', '-1', '--format=%s')).toBe('delete: Barres avoine');
	expect(existsSync(`${VAULT}/recipes/barres-avoine.md`)).toBe(false);
	await expect(avoine).toHaveCount(0);
	await avoineReceipt.getByRole('button', { name: 'Annuler' }).click();
	await expect(page.getByTestId('toast')).toContainText('Annulé.');
	expect(git('log', '-1', '--format=%s')).toBe('restore: Barres avoine');
	expect(existsSync(`${VAULT}/recipes/barres-avoine.md`)).toBe(true);
	await expect(avoine).toHaveCount(1);

	// "Recettes différentes": the pair written to vocab/distinct.yaml, gone from the list.
	const dattes = page.locator('li.card[data-pair="carres-aux-dattes carres-magiques"]');
	const left = Number((await page.locator('main .count').first().textContent())?.match(/^(\d+) groupes? à décider/)?.[1]);
	await dattes.getByText('Recettes différentes', { exact: true }).click();
	await dattes.getByRole('button', { name: 'Ce sont deux recettes différentes' }).click();
	// The card gone and « N à décider » one less, at once.
	await expect(page.locator('main .count').first()).toContainText(`${left - 1} groupe${left - 1 > 1 ? 's' : ''} à décider`);
	// The card folds into one line where it stood, with its own « Annuler » (usability round 4).
	await expect(page.getByTestId('receipt').filter({ hasText: 'Carrés aux dattes · Carrés magiques : recettes différentes' })).toBeVisible();
	// What is left, said to a screen reader; and how many are done since she came in this tab (« 3 sur 22 faits »).
	await expect(page.getByRole('status').filter({ hasText: 'Paire écartée' })).toContainText(/Reste \d+ groupes? à décider|Plus aucun groupe/);
	await expect(page.locator('main .count').first()).toContainText(/\d+ sur \d+ faits?/);
	await expect(dattes).toHaveCount(0);
	expect(git('log', '-1', '--format=%s|%an')).toBe('duplicate: carres-aux-dattes ≠ carres-magiques|Proprio Inventé');
	expect(git('show', '--name-only', '--format=', 'HEAD')).toBe('vocab/distinct.yaml');
	expect(readFileSync(`${VAULT}/vocab/distinct.yaml`, 'utf8')).toContain('- [carres-aux-dattes, carres-magiques]');
	// « Annuler » on the receipt, the one undo: the card back, the line gone.
	await page.getByTestId('receipt').filter({ hasText: 'Carrés aux dattes' }).getByRole('button', { name: 'Annuler' }).click();
	await expect(dattes).toHaveCount(1);
	await expect(page.getByTestId('receipt').filter({ hasText: 'Carrés aux dattes' })).toHaveCount(0);
	expect(git('log', '-1', '--format=%s')).toBe('undo: duplicate carres-aux-dattes ≠ carres-magiques');
	// Dismissed again, for the next runs of this spec on the same vault.
	await dattes.getByText('Recettes différentes', { exact: true }).click();
	await dattes.getByRole('button', { name: 'Ce sont deux recettes différentes' }).click();
	await expect(dattes).toHaveCount(0);
});

test('"Même recette" never offers to trash a recipe another one uses as a sub-recipe', async ({ page, baseURL }) => {
	// A second copy of the fixture's pizza dough, which pizza-maison uses as a sub-recipe.
	const dough = readFileSync('tests/fixtures/vault/recipes/pate-a-pizza.md', 'utf8')
		.replace(/^title: .*$/m, 'title: Pâte à pizza de Lise')
		.replace(/^slug: .*$/m, 'slug: pate-a-pizza-de-lise')
		.replace(/^(status|added): .*\n/gm, '');
	const saved = await page.request.post('/api/save', { headers: { origin: baseURL! }, data: { files: [{ text: dough }] } });
	expect(saved.ok()).toBe(true);
	await page.goto('/doublons');
	const card = page.locator('li.card[data-pair="pate-a-pizza pate-a-pizza-de-lise"]');
	await expect(card.getByTestId('used-by')).toContainText('Pizza maison');
	await card.getByText('C’est la même recette').click();
	// Keeping the copy would trash the one in use: not offered.
	await expect(card.getByLabel('Garder « Pâte à pizza de Lise »')).toBeDisabled();
	await expect(card.getByLabel('Garder « Pâte à pizza »', { exact: true })).toBeChecked();
	// A thumb-sized radio (22 px) in a 44 px label.
	const box = await card.getByLabel('Garder « Pâte à pizza »', { exact: true }).boundingBox();
	expect(box!.width).toBeGreaterThanOrEqual(22);
});

test('three copies make one card: « 3 fiches semblables », one decision for the ticked ones', async ({ page, baseURL }) => {
	// Registry names: three copies of unlinked names would top /resoudre for the specs after this one.
	const FIGUES = lines('bleuets', 'cannelle', 'laurier', 'saumon');
	const saved = await page.request.post('/api/save', {
		headers: { origin: baseURL! },
		data: {
			files: [
				{ text: file('Figues confites', '', FIGUES) },
				{ text: file('Figues confites de Rose', '', FIGUES) },
				{ text: file('Figues au sirop', '', FIGUES) }
			]
		}
	});
	expect(saved.ok()).toBe(true);
	await page.goto('/doublons');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Doublons possibles');
	const card = page.locator('li.card[data-group="figues-au-sirop figues-confites figues-confites-de-rose"]');
	await expect(card.getByRole('heading', { name: '3 fiches semblables' })).toBeVisible();
	// No slug on the card but in « Détail ».
	await expect(card.getByText('figues-confites-de-rose')).toBeHidden();
	// The closest two ticked at first, marked « Les plus proches »; the third not.
	await expect(card.getByTestId('closest-mark')).toHaveCount(2);
	await expect(card.locator('input.tick:checked')).toHaveCount(2);
	await expect(card.locator('input.tick')).toHaveCount(3);
	// All three ticked: « Mettre 2 fiches à la corbeille », the number said.
	await card.locator('input.tick:not(:checked)').check();
	await card.getByText('C’est la même recette', { exact: true }).click();
	await expect(card.getByTestId('same-save')).toHaveText('Mettre 2 fiches à la corbeille');
	// One of them apart, ticked alone: « Pas le même plat que les autres ».
	for (const name of ['Figues confites', 'Figues confites de Rose']) await card.getByRole('checkbox', { name, exact: true }).uncheck();
	await expect(card.getByRole('checkbox', { name: 'Figues au sirop' })).toBeChecked();
	await card.getByText('Recettes différentes', { exact: true }).click();
	await card.getByRole('button', { name: 'Pas le même plat que les autres' }).click();
	const apart = page.getByTestId('receipt').filter({ hasText: 'recettes différentes' });
	await expect(apart).toBeVisible();
	expect(git('log', '-1', '--format=%s')).toBe('duplicate: 2 pairs');
	await expect(page.locator('li.card[data-pair="figues-confites figues-confites-de-rose"]')).toHaveCount(1);
	// Back as they were, for the next runs.
	await apart.getByRole('button', { name: 'Annuler' }).click();
	await expect(card).toHaveCount(1);
});

test.describe('on a wide screen with a keyboard', () => {
	test.use({ viewport: { width: 1366, height: 900 }, isMobile: false, hasTouch: false });

	test('J / K move from card to card, 1 2 3 open its choices, Échap closes them; « Raccourcis clavier » says so', async ({ page }) => {
		await page.goto('/doublons');
		// The hint behind a small toggle, closed at first.
		await expect(page.getByTestId('keys-hint').getByText('J / K')).toBeHidden();
		await page.getByTestId('keys-hint').getByText('Raccourcis clavier').click();
		await expect(page.getByTestId('keys-hint')).toContainText('J / K');
		const cards = page.locator('ul.cards > li.card');
		test.skip((await cards.count()) < 2, 'needs two cards');
		await page.keyboard.press('j');
		const first = await page.evaluate(() => document.activeElement?.getAttribute('data-group'));
		expect(first).toBeTruthy();
		await page.keyboard.press('j');
		const second = await page.evaluate(() => document.activeElement?.getAttribute('data-group'));
		expect(second).not.toBe(first);
		await page.keyboard.press('k');
		expect(await page.evaluate(() => document.activeElement?.getAttribute('data-group'))).toBe(first);
		await page.keyboard.press('3');
		const card = page.locator(`li.card[data-group="${first}"]`);
		await expect(card.locator('.actions > details').nth(2)).toHaveAttribute('open', '');
		await page.keyboard.press('Escape');
		await expect(card.locator('.actions > details[open]')).toHaveCount(0);
	});
});
