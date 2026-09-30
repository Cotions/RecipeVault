import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { fenced, file, paste } from './helpers';

// W505 in the paste box (issue #13): two copies inside one paste, and
// "Mettre en famille" putting both recipes in the family in one commit.
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
	// Nothing in the vault is close: no link, no family offer.
	await expect(files.nth(1).getByTestId('close-recipes')).toHaveCount(0);
	await files.nth(1).getByText(/^Avertissements/).click();
	await expect(files.nth(1).getByText('W505')).toBeVisible();
});

test('"Mettre en famille" from the paste box puts both recipes in the family, one commit', async ({ page, baseURL }) => {
	const saved = await page.request.post('/api/save', { headers: { origin: baseURL! }, data: { files: [{ text: file('Carrés aux figues de Gisèle', '', FIGUES) }] } });
	expect(saved.ok()).toBe(true);

	await page.goto('/ajouter');
	await paste(page, fenced('Figues en carrés de Paulette', '', FIGUES));
	await expect(page.getByTestId('close-recipes')).toContainText('Carrés aux figues de Gisèle');
	await page.getByLabel('C’est une autre version du même plat : la mettre dans une famille ?').check();
	await page.getByLabel('Famille', { exact: true }).fill('carres-aux-figues');
	await page.getByLabel('Version', { exact: true }).fill('de Paulette');
	await page.getByLabel('Version de « Carrés aux figues de Gisèle »').fill('de Gisèle');
	await expect(page.getByText('« Carrés aux figues de Gisèle » est mise dans la même famille, dans le même enregistrement.')).toBeVisible();
	await page.getByRole('button', { name: /Enregistrer/ }).click();
	await expect(page.locator('.toast')).toContainText('Recette enregistrée');

	expect(git('log', '-1', '--format=%s|%an')).toBe('add: Figues en carrés de Paulette; edit: Carrés aux figues de Gisèle|Proprio Inventé');
	expect(git('show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual(['recipes/carres-aux-figues-de-gisele.md', 'recipes/figues-en-carres-de-paulette.md']);
	expect(readFileSync(`${VAULT}/recipes/carres-aux-figues-de-gisele.md`, 'utf8')).toMatch(/^variant: de Gisèle$/m);

	await page.goto('/famille/carres-aux-figues');
	await expect(page.getByRole('link', { name: /Carrés aux figues de Gisèle/ })).toBeVisible();
	await expect(page.getByRole('link', { name: /Figues en carrés de Paulette/ })).toBeVisible();
});

test('"Mettre en famille" refused when the other recipe changed: nothing saved, said on the file', async ({ page, baseURL }) => {
	const saved = await page.request.post('/api/save', {
		headers: { origin: baseURL! },
		data: { files: [{ text: file('Bouchées aux dattes et gingembre', '', lines('gingembre confit', 'dattes hachées', 'sirop de riz brun', 'zeste de lime')) }] }
	});
	expect(saved.ok()).toBe(true);
	await page.goto('/ajouter');
	await paste(page, fenced('Bouchées gingembre de Rita', '', lines('gingembre confit', 'dattes hachées', 'sirop de riz brun', 'zeste de lime')));
	await expect(page.getByTestId('close-recipes')).toBeVisible();
	await page.getByLabel('C’est une autre version du même plat : la mettre dans une famille ?').check();
	await page.getByLabel('Version', { exact: true }).fill('de Rita');
	await page.getByLabel('Version de « Bouchées aux dattes et gingembre »').fill('originale');
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
