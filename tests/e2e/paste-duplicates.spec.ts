import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { fenced, file, paste } from './helpers';

// W505 in the paste box (issue #13): two copies inside one paste, and
// « Regrouper avec … » putting both recipes in the family in one commit.
// Invented recipes, on ingredients no other spec uses.
const VAULT = '/tmp/rv-e2e/vault';
const git = (...args: string[]) => execFileSync('git', args, { cwd: VAULT, encoding: 'utf8' }).trim();

const lines = (...names: string[]) => names.map((n, i) => `      - { qty: ${i + 1}, unit: cup, name: ${n} }`).join('\n');
const FIGUES = lines('figues séchées', 'sirop de bouleau', 'pacanes grillées', 'graines de pavot');
const PRUNEAUX = lines('pruneaux dénoyautés', 'sirop de maïs doré', 'noix de Grenoble', 'clou de girofle moulu');

test('two copies in one paste: the second names the first by its place', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, fenced('Carrés aux pruneaux de Gilberte', '', PRUNEAUX) + '\n' + fenced('Pruneaux en carrés', '', PRUNEAUX));
	const files = page.locator('section.file');
	await expect(files).toHaveCount(2);
	await expect(files.nth(1).getByTestId('close-batch')).toContainText('le fichier n° 1 de ce collage (« Carrés aux pruneaux de Gilberte »)');
	await expect(files.nth(0).getByTestId('close-batch')).toHaveCount(0);
	// Nothing in the vault is close: no recipe to group with, no question.
	await expect(files.nth(1).getByTestId('group-targets')).toHaveCount(0);
	await files.nth(1).getByText(/^\d+ remarques?$/).click();
	// The code waits behind the file's one « Détails pour le dépannage », not on the remark.
	const w505 = files.nth(1).locator('.diag.warning .diag-item', { hasText: 'presque les mêmes ingrédients' });
	await expect(w505).not.toContainText('W505');
	const trouble = files.nth(1).getByTestId('trouble');
	await trouble.getByText('Détails pour le dépannage').click();
	await expect(trouble.locator('.code', { hasText: 'W505' })).toBeVisible();
});

test('"Mettre en famille" from the paste box puts both recipes in the family, one commit', async ({ page, baseURL }) => {
	const saved = await page.request.post('/api/save', { headers: { origin: baseURL! }, data: { files: [{ text: file('Carrés aux figues de Gisèle', '', FIGUES) }] } });
	expect(saved.ok()).toBe(true);

	await page.goto('/ajouter');
	await paste(page, fenced('Figues en carrés de Paulette', '', FIGUES));
	// The recipe it may join, with why it is asked; the answer names it.
	const targets = page.getByTestId('group-targets');
	await expect(targets).toContainText('Carrés aux figues de Gisèle');
	await expect(targets).toContainText('presque les mêmes ingrédients');
	await expect(page.getByText('Une autre variante du même plat ?')).toBeVisible();
	// The save names the answer it will act on: saved apart until "Même plat" is chosen.
	await expect(page.getByRole('button', { name: /^Enregistrer sans regrouper/ })).toBeVisible();
	await page.getByRole('button', { name: /^Regrouper avec Carrés aux figues de Gisèle/ }).click();
	// Grouping needs the version name: the save waits for it.
	await expect(page.getByRole('button', { name: /^Enregistrer dans « / })).toBeDisabled();
	await expect(page.getByRole('button', { name: 'Nommez la variante pour regrouper' })).toBeVisible();
	// The group by its name, never a slug: prefilled from the titles, its slug made on save.
	await expect(page.getByLabel('Groupe de variantes', { exact: true })).toHaveValue('Carrés aux figues de Gisèle');
	await page.getByLabel('Groupe de variantes', { exact: true }).fill('Carrés aux figues');
	await page.getByLabel('Variante', { exact: true }).fill('de Paulette');
	await page.getByLabel('Ce qui distingue « Carrés aux figues de Gisèle »').fill('de Gisèle');
	await expect(page.getByText('« Carrés aux figues de Gisèle » est regroupée avec celle-ci, dans le même enregistrement.')).toBeVisible();
	await expect(page.getByRole('button', { name: /^Enregistrer dans « Carrés aux figues »/ })).toBeEnabled();
	await page.getByRole('button', { name: /Enregistrer/ }).click();
	await expect(page.getByTestId('saved-card')).toContainText('Recette enregistrée');

	expect(git('log', '-1', '--format=%s|%an')).toBe('add: Figues en carrés de Paulette; edit: Carrés aux figues de Gisèle|Proprio Inventé');
	expect(git('show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual(['recipes/carres-aux-figues-de-gisele.md', 'recipes/figues-en-carres-de-paulette.md']);
	expect(readFileSync(`${VAULT}/recipes/carres-aux-figues-de-gisele.md`, 'utf8')).toMatch(/^variant: de Gisèle$/m);

	await page.goto('/famille/carres-aux-figues');
	await expect(page.locator('.variants').getByRole('link', { name: /Carrés aux figues de Gisèle/ })).toBeVisible();
	await expect(page.locator('.variants').getByRole('link', { name: /Figues en carrés de Paulette/ })).toBeVisible();
});

test('"Mettre en famille" refused when the other recipe changed: nothing saved, said on the file', async ({ page, baseURL }) => {
	const saved = await page.request.post('/api/save', {
		headers: { origin: baseURL! },
		data: { files: [{ text: file('Bouchées aux dattes et gingembre', '', lines('gingembre confit', 'dattes hachées', 'sirop de riz brun', 'zeste de lime')) }] }
	});
	expect(saved.ok()).toBe(true);
	await page.goto('/ajouter');
	await paste(page, fenced('Bouchées gingembre de Rita', '', lines('gingembre confit', 'dattes hachées', 'sirop de riz brun', 'zeste de lime')));
	await expect(page.getByTestId('group-targets')).toContainText('Bouchées aux dattes et gingembre');
	await expect(page.getByText('Une autre variante du même plat ?')).toBeVisible();
	await page.getByRole('button', { name: /^Regrouper avec Bouchées aux dattes et gingembre/ }).click();
	await page.getByLabel('Variante', { exact: true }).fill('de Rita');
	await page.getByLabel('Ce qui distingue « Bouchées aux dattes et gingembre »').fill('originale');
	// Someone edits the other recipe meanwhile.
	const head = git('rev-parse', 'HEAD');
	const path = `${VAULT}/recipes/bouchees-aux-dattes-et-gingembre.md`;
	const changed = await page.request.post('/api/save', {
		headers: { origin: baseURL! },
		data: { files: [{ text: readFileSync(path, 'utf8').replace('## Préparation', '## Préparation\n\nNote ajoutée.'), overwrite: sha(path) }] }
	});
	expect(changed.ok()).toBe(true);
	const after = git('rev-parse', 'HEAD');
	expect(after).not.toBe(head);
	await page.getByRole('button', { name: /Enregistrer/ }).click();
	await expect(page.getByTestId('stale')).toContainText('« Bouchées aux dattes et gingembre » a changé');
	expect(git('rev-parse', 'HEAD')).toBe(after);
});

function sha(path: string): string {
	return execFileSync('sha256sum', [path], { encoding: 'utf8' }).split(' ')[0];
}
