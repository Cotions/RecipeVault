import { expect, test } from '@playwright/test';
import { slugify } from '../../src/lib/vault/slug';
import { file } from './helpers';

// The interface calls a family « Variantes »; the vault keeps `family:` and
// the /famille, /familles and ?famille= addresses (docs/VOCAB.md, "Families").
// The fixture vault's lasagna files are written with `family: lasagna` and
// `source.type: family`, as before the rename: they must group and render.

test('a vault written with family: keys still groups its variants, under « Variantes »', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('navigation', { name: 'Principale' }).getByRole('link', { name: 'Variantes' }).click();
	await expect(page).toHaveURL(/\/familles$/);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Variantes');
	const row = page.locator('li', { has: page.locator('a[href="/famille/lasagna"]') });
	await expect(row).toContainText('3 variantes');
	// One line of facts (count, time span, the most common course), then the variants' labels.
	await expect(row.locator('.n')).toHaveText(/^3 variantes( · [^·]+)? · Plat principal$/);
	await expect(row.locator('.labels')).toContainText('bolognaise');

	await row.getByRole('link').click();
	await expect(page).toHaveURL(/\/famille\/lasagna$/);
	await expect(page.locator('.count')).toHaveText('3 variantes');
	for (const slug of ['lasagna-bolognaise', 'lasagna-courgettes', 'lasagna-epinards-ricotta']) {
		await expect(page.locator(`.variants a[href="/r/${slug}"]`)).toBeVisible();
	}
	await expect(page.getByRole('heading', { name: 'Ce qui les distingue' })).toBeVisible();
	// ✓ / – with a legend, not a lone dot (usability round 4).
	await expect(page.getByTestId('diff-legend')).toHaveText('✓ : dans cette variante · – : absent');
	await expect(page.locator('td.yes').first()).toContainText('✓');

	await page.goto('/r/lasagna-bolognaise');
	await expect(page.locator('.family a[href="/famille/lasagna"]')).toBeVisible();
	// The variant's own label after the family link.
	await expect(page.getByTestId('own-variant')).toHaveText(/^\s*— bolognaise$/);
	await expect(page.locator('.related')).toContainText('Autres variantes');

	// The filter keeps its address; its heading and the source type read the new way.
	await page.goto('/?famille=lasagna');
	await expect(page.getByText('3 recettes', { exact: true })).toBeVisible();
	await expect(page.locator('.facets')).toContainText('Variantes');
	await page.goto('/');
	await expect(page.locator('.facets')).toContainText('Recette personnelle');
});

test('« Grouper avec… » from a recipe’s ⋯ menu, then « + Ajouter une recette à ce groupe »', async ({ page, baseURL }) => {
	const run = Date.now().toString(36);
	const [a, b, c] = [`Biscuits mélasse ${run}`, `Biscuits à la mélasse de Gisèle ${run}`, `Biscuits mélasse du dépanneur ${run}`];
	const slug = slugify;
	const saved = await page.request.post('/api/save', {
		headers: { origin: baseURL! },
		data: { files: [a, b, c].map((x) => ({ text: file(x) })) }
	});
	expect(saved.ok()).toBe(true);

	await page.goto(`/r/${slug(b)}`);
	await page.getByTestId('recipe-actions').click();
	await page.getByTestId('group-with').click();
	await expect(page).toHaveURL(`/familles?grouper=${slug(b)}`);
	const panel = page.getByTestId('grouper');
	// Before she types: the likest group or recipe, one click away.
	await expect(panel.getByTestId('group-suggestion')).toContainText('Suggestion :');
	await panel.getByTestId('group-search').fill(`mélasse ${run}`);
	await page.getByRole('option', { name: new RegExp(`^${a}`) }).click();
	// The group's name: the shorter title.
	await expect(panel.getByLabel('Nom du groupe')).toHaveValue(a);
	await panel.getByLabel(`Ce qui distingue « ${b} »`).fill('de Gisèle');
	await panel.getByLabel(`Ce qui distingue « ${a} »`).fill('classique');
	await panel.getByRole('button', { name: 'Grouper' }).click();
	await expect(page).toHaveURL(`/famille/${slug(a)}`);
	await expect(page.getByTestId('toast')).toContainText('sont maintenant des variantes');
	await expect(page.locator('.count')).toHaveText('2 variantes');

	// One more from the group's page.
	await page.getByTestId('family-add').locator('summary').click();
	await page.getByTestId('family-add-search').fill(`dépanneur ${run}`);
	await page.getByRole('option', { name: new RegExp(`^${c}`) }).click();
	await page.locator('#family-add-variant').fill('du dépanneur');
	await page.getByRole('button', { name: 'Ajouter au groupe' }).click();
	await expect(page.getByTestId('toast')).toContainText('est maintenant une variante');
	await expect(page.locator('.count')).toHaveText('3 variantes');

	// « Renommer » on its line of /familles: her words for the group's name.
	await page.goto('/familles');
	const row = page.locator('li', { has: page.locator(`a[href="/famille/${slug(a)}"]`) });
	await row.getByRole('button', { name: /^Renommer/ }).click();
	await row.getByLabel(/^Nouveau nom pour/).fill(`Galettes mélasse ${run}`);
	await row.getByRole('button', { name: 'Enregistrer le nom' }).click();
	await expect(page.getByTestId('toast')).toContainText('Nom du groupe enregistré.');
	await expect(row.locator('.name')).toHaveText(`Galettes mélasse ${run}`);
});

test('« Grouper avec… » says the ingredients in common, warns when few; « Annuler » says « Groupe défait » and the page follows', async ({ page, baseURL }) => {
	const run = Date.now().toString(36);
	const ing = (...names: string[]) => names.map((n) => `      - { qty: 1, unit: cup, name: ${n} }`).join('\n');
	const [a, b] = [`Tourte aux poireaux ${run}`, `Pâté à la viande ${run}`];
	const saved = await page.request.post('/api/save', {
		headers: { origin: baseURL! },
		data: { files: [{ text: file(a, '', ing('poireaux', 'crème 35 %', 'gruyère', 'farine')) }, { text: file(b, '', ing('porc haché', 'clou de girofle moulu', 'pommes de terre', 'farine')) }] }
	});
	expect(saved.ok()).toBe(true);

	await page.goto(`/familles?grouper=${slugify(a)}`);
	const panel = page.getByTestId('grouper');
	await panel.getByTestId('group-search').fill(`viande ${run}`);
	await page.getByRole('option', { name: new RegExp(`^${b}`) }).click();
	// Flour is a staple: left out of both counts.
	await expect(panel.getByTestId('group-overlap')).toHaveText(/^0 ingrédient en commun sur 3/);
	await expect(panel.getByTestId('group-few')).toBeVisible();
	await panel.getByLabel('Nom du groupe').fill(`Tourtes ${run}`);
	await panel.getByLabel(`Ce qui distingue « ${a} »`).fill('aux poireaux');
	await panel.getByLabel(`Ce qui distingue « ${b} »`).fill('à la viande');
	await panel.getByRole('button', { name: 'Grouper' }).click();
	await expect(page.locator('.count')).toHaveText('2 variantes');
	// The group was made by this grouping: undone, it is gone, so the recipe's page.
	await page.getByTestId('toast').getByRole('button', { name: 'Annuler' }).click();
	await expect(page.getByTestId('toast')).toContainText(`Groupe défait : « ${a} » n’en fait plus partie.`);
	await expect(page).toHaveURL(`/r/${slugify(a)}`);
});
