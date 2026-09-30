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
	await page.getByRole('navigation', { name: 'Principale' }).getByRole('link', { name: /^Doublons \(\d+\)$/ }).click();
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
	await abricots.getByText('Deux versions de la même recette').click();
	await expect(abricots.getByLabel('Famille', { exact: true })).toHaveValue('abricots-au-four');
	await abricots.getByLabel('Nom de la version « Abricots au four »').fill('au four');
	await abricots.getByLabel('Nom de la version « Abricots rôtis de tante Zoé »').fill('de tante Zoé');
	await abricots.getByRole('button', { name: 'En faire deux versions' }).click();
	await expect(page.getByTestId('flash')).toContainText('versions de la famille « abricots-au-four »');
	expect(git('log', '-1', '--format=%s|%an')).toBe('edit: Abricots au four; edit: Abricots rôtis de tante Zoé|Proprio Inventé');
	expect(git('show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual([
		'recipes/abricots-au-four.md',
		'recipes/abricots-rotis-de-tante-zoe.md',
		'vocab/families.yaml'
	]);
	expect(readFileSync(`${VAULT}/recipes/abricots-rotis-de-tante-zoe.md`, 'utf8')).toContain('family: abricots-au-four');
	// Identical ingredients in one family: still listed (Q16 C), without the offer.
	const versions = abricots.locator('details').first();
	if (!(await versions.evaluate((d) => (d as HTMLDetailsElement).open))) await versions.locator('summary').click();
	await expect(abricots.getByText('Déjà dans la même famille')).toBeVisible();

	// "Même recette": the other to the trash, then "Annuler".
	const avoine = page.locator('li.card[data-pair="barres-a-l-avoine-de-lise barres-avoine"]');
	await avoine.getByText('C’est la même recette').click();
	await avoine.getByLabel('Garder « Barres à l’avoine de Lise »').check();
	await avoine.getByRole('button', { name: 'Mettre l’autre à la corbeille' }).click();
	await expect(page.getByTestId('flash')).toContainText('« Barres avoine » est dans la corbeille.');
	expect(git('log', '-1', '--format=%s')).toBe('delete: Barres avoine');
	expect(existsSync(`${VAULT}/recipes/barres-avoine.md`)).toBe(false);
	await expect(avoine).toHaveCount(0);
	await page.getByTestId('flash').getByRole('button', { name: 'Annuler' }).click();
	await expect(page.getByTestId('flash')).toHaveText('Annulé.');
	expect(git('log', '-1', '--format=%s')).toBe('restore: Barres avoine');
	expect(existsSync(`${VAULT}/recipes/barres-avoine.md`)).toBe(true);
	await expect(avoine).toHaveCount(1);

	// "Recettes différentes": the pair written to vocab/distinct.yaml, gone from the list.
	const dattes = page.locator('li.card[data-pair="carres-aux-dattes carres-magiques"]');
	await dattes.getByText('Recettes différentes', { exact: true }).click();
	await dattes.getByRole('button', { name: 'Ce sont deux recettes différentes' }).click();
	await expect(page.getByTestId('flash')).toHaveText(/Paire écartée/);
	await expect(dattes).toHaveCount(0);
	expect(git('log', '-1', '--format=%s|%an')).toBe('duplicate: carres-aux-dattes ≠ carres-magiques|Proprio Inventé');
	expect(git('show', '--name-only', '--format=', 'HEAD')).toBe('vocab/distinct.yaml');
	expect(readFileSync(`${VAULT}/vocab/distinct.yaml`, 'utf8')).toContain('- [carres-aux-dattes, carres-magiques]');
	await page.getByTestId('flash').getByRole('button', { name: 'Annuler' }).click();
	await expect(dattes).toHaveCount(1);
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
});
