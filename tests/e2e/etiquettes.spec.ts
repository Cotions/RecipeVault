import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { devices, expect, test } from '@playwright/test';
import { file } from './helpers';

// Pending tags, /etiquettes (plan 04, Phase 8; Q11 B), on a phone. Adds its own
// invented recipes; leaves the fixture's pending `cabane-a-sucre` alone.
const VAULT = '/tmp/rv-e2e/vault';
const git = (...args: string[]) => execFileSync('git', args, { cwd: VAULT, encoding: 'utf8' }).trim();
const { defaultBrowserType: _, ...phone } = devices['Pixel 7'];
test.use(phone);

test('pending tags are settled on /etiquettes: new tag, alias, removal — one commit each', async ({ page, baseURL }) => {
	const saved = await page.request.post('/api/save', {
		headers: { origin: baseURL! },
		data: {
			files: [
				{ text: file('Maïs soufflé du ciné', 'tags: [Soirée cinéma, dessert]\n') },
				{ text: file('Nachos du ciné', 'tags: [soirée cinéma, dessertt]\n') },
				{ text: file('Sandwichs du pique-nique', 'tags: [Pique-nique inventé]\n') },
				{ text: file('Tire inventée de la cabane', 'tags: [erable]\n', '      - { qty: 1, unit: cup, name: sirop d’érable }') }
			]
		}
	});
	expect(saved.ok()).toBe(true);

	await page.goto('/');
	await page.getByTestId('more').click();
	const link = page.getByRole('link', { name: /^Étiquettes · \d+ à décider$/ });
	await link.click();
	await expect(page).toHaveURL('/etiquettes');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Étiquettes en attente');

	// New tag, with its French label.
	const cine = page.locator('li.row[data-tag="soiree-cinema"]');
	await expect(cine.locator('.count')).toHaveText('2 recettes');
	// No close existing tag: « Garder » is the row's main answer, under the name it will show (docs/VOCAB.md, preselection).
	await expect(cine.getByLabel('Nom affiché', { exact: true })).toBeHidden();
	await expect(cine.getByLabel('Nom affiché', { exact: true })).toHaveValue('Soirée cinéma');
	await cine.getByRole('button', { name: 'Garder « Soirée cinéma »' }).click();
	await expect(page.getByTestId('toast')).toContainText('« Soirée cinéma » est maintenant une étiquette du vocabulaire.');
	await expect(cine).toHaveCount(0);
	expect(git('log', '-1', '--format=%s|%an')).toBe('tag: new soiree-cinema → Soirée cinéma|Proprio Inventé');
	expect(git('show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual(['vocab/tag-labels.yaml', 'vocab/tags.yaml']);
	expect(readFileSync(`${VAULT}/vocab/tag-labels.yaml`, 'utf8')).toContain('soiree-cinema: { fr: Soirée cinéma }');

	// "C'est comme…" with the suggestion already chosen: one letter off a tag (docs/VOCAB.md, "Tags").
	const desert = page.locator('li.row[data-tag="dessertt"]');
	await expect(desert.locator('.near')).toHaveText('Proche de « Dessert »');
	// « C'est comme… » is already open: the suggestion is preselected.
	await expect(desert.getByRole('button', { name: 'Relier' })).toBeVisible();
	await expect(desert.getByLabel('Étiquette existante')).toHaveValue('dessert');
	await desert.getByRole('button', { name: 'Relier' }).click();
	await expect(page.getByTestId('toast')).toContainText('« dessertt » est reliée à « Dessert ».');
	await expect(desert).toHaveCount(0);
	expect(git('log', '-1', '--format=%s')).toBe('tag: dessertt → dessert');
	expect(git('show', '--name-only', '--format=', 'HEAD')).toBe('vocab/tags.yaml');
	// « Annuler » in the toast: the alias taken back, one commit, the tag pending again.
	await page.getByTestId('toast').getByRole('button', { name: 'Annuler' }).click();
	await expect(desert).toHaveCount(1);
	expect(git('log', '-1', '--format=%s')).toBe('undo: tag: dessertt → dessert');
	// « C'est comme… » is already open: the suggestion is preselected.
	await expect(desert.getByRole('button', { name: 'Relier' })).toBeVisible();
	await desert.getByRole('button', { name: 'Relier' }).click();
	await expect(desert).toHaveCount(0);

	// Removal: the only action that rewrites recipes.
	const picnic = page.locator('li.row[data-tag="pique-nique-invente"]');
	await picnic.getByRole('button', { name: 'Retirer de la recette' }).click();
	await expect(page.getByTestId('toast')).toContainText('« Pique-nique inventé » a été retirée de 1 recette.');
	expect(git('log', '-1', '--format=%s')).toBe('tag: drop pique-nique-invente');
	expect(readFileSync(`${VAULT}/recipes/sandwichs-du-pique-nique.md`, 'utf8')).not.toContain('Pique-nique');

	// A tag written without its accent gets the one the recipe writes (« sirop d’érable »); ✎ changes the name first.
	const erable = page.locator('li.row[data-tag="erable"]');
	await expect(erable.getByRole('button', { name: 'Garder « Érable »' })).toBeVisible();
	await erable.getByLabel('Changer le nom affiché').click();
	await erable.getByLabel('Nom affiché', { exact: true }).fill('Érable (sirop)');
	await erable.getByRole('button', { name: 'Garder « Érable (sirop) »' }).click();
	await expect(page.getByTestId('toast')).toContainText('« Érable (sirop) » est maintenant une étiquette du vocabulaire.');
	await expect(erable).toHaveCount(0);

	// The label shows in the filters.
	await page.goto('/?tag=soiree-cinema');
	await expect(page.locator('.count')).toHaveText('2 recettes');
	// A wide screen shows the filters beside the list; a narrow one behind « Filtres ».
	const filtrer = page.getByRole('button', { name: /^Filtres/ });
	if (await filtrer.isVisible()) await filtrer.click();
	// The active tag is listed without opening « + n autres » (issue #11), though it sorts past the first four.
	const current = page.locator('.facets a[aria-current="true"]');
	await expect(current).toHaveCount(1);
	await expect(current).toBeVisible();
	await expect(current).toContainText('Soirée cinéma');
	const tagFacet = page.locator('.facets section').filter({ has: page.locator('a[aria-current="true"]') });
	// Counts follow the list now (docs/DATA-FLOW.md): the short list holds at most the first four plus the active one.
	expect(await tagFacet.locator('li').count()).toBeLessThanOrEqual(5);
	await expect(tagFacet.getByRole('button', { name: /autres/ })).toBeVisible();
});

test('a tag write from a stale page is refused and changes nothing', async ({ page, baseURL }) => {
	const head = git('rev-parse', 'HEAD');
	const res = await page.request.post('/etiquettes?/map', {
		headers: { origin: baseURL! },
		form: { tag: 'cabane-a-sucre', canonical: 'dessert', version: 'not:current' }
	});
	expect(await res.text()).toContain('rechargez');
	expect(git('rev-parse', 'HEAD')).toBe(head);
});

test('« Plus » keeps its queue rows in place: the backlogs with their totals, what is new after', async ({ page }) => {
	await page.goto('/');
	await page.getByTestId('more').click();
	// À relier and Doublons: their totals, quiet (UI round 2); Étiquettes and Doublons: what waits, or nothing.
	await expect(page.getByRole('link', { name: /^À relier( · \d+)?$/ })).toBeVisible();
	await expect(page.getByRole('link', { name: /^Étiquettes( · \d+ à décider)?$/ })).toBeVisible();
	await expect(page.getByRole('link', { name: /^Doublons( · \d+)?( · \d+ nouveaux?)?$/ })).toBeVisible();
});
