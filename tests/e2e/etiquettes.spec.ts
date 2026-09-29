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
				{ text: file('Nachos du ciné', 'tags: [soirée cinéma, desertt]\n') },
				{ text: file('Sandwichs du pique-nique', 'tags: [Pique-nique inventé]\n') }
			]
		}
	});
	expect(saved.ok()).toBe(true);

	await page.goto('/');
	const link = page.getByRole('navigation', { name: 'Principale' }).getByRole('link', { name: /^Étiquettes \(\d+\)$/ });
	await link.click();
	await expect(page).toHaveURL('/etiquettes');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Étiquettes en attente');

	// New tag, with its French label.
	const cine = page.locator('li.card[data-tag="soiree-cinema"]');
	await expect(cine.locator('.count')).toHaveText('2 recettes');
	await cine.getByText('Nouvelle étiquette').click();
	await expect(cine.getByLabel('Nom affiché')).toHaveValue('Soirée cinéma');
	await cine.getByRole('button', { name: 'Ajouter au vocabulaire' }).click();
	await expect(page.locator('.flash')).toHaveText('« Soirée cinéma » est maintenant une étiquette du vocabulaire.');
	await expect(cine).toHaveCount(0);
	expect(git('log', '-1', '--format=%s|%an')).toBe('tag: new soiree-cinema → Soirée cinéma|Proprio Inventé');
	expect(git('show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual(['vocab/tag-labels.yaml', 'vocab/tags.yaml']);
	expect(readFileSync(`${VAULT}/vocab/tag-labels.yaml`, 'utf8')).toContain('soiree-cinema: { fr: Soirée cinéma }');

	// "C'est comme…" with the suggestion already chosen.
	const desert = page.locator('li.card[data-tag="desertt"]');
	await expect(desert.locator('.near')).toHaveText('Proche de « Dessert »');
	await desert.getByText('C’est comme…').click();
	await expect(desert.getByLabel('Étiquette existante')).toHaveValue('dessert');
	await desert.getByRole('button', { name: 'Relier' }).click();
	await expect(page.locator('.flash')).toHaveText('« desertt » est reliée à « Dessert ».');
	expect(git('log', '-1', '--format=%s')).toBe('tag: desertt → dessert');
	expect(git('show', '--name-only', '--format=', 'HEAD')).toBe('vocab/tags.yaml');

	// Removal: the only action that rewrites recipes.
	const picnic = page.locator('li.card[data-tag="pique-nique-invente"]');
	await picnic.getByText('Retirer', { exact: true }).click();
	await picnic.getByRole('button', { name: 'Retirer de la recette' }).click();
	await expect(page.locator('.flash')).toHaveText('« pique-nique-invente » a été retirée de 1 recette.');
	expect(git('log', '-1', '--format=%s')).toBe('tag: drop pique-nique-invente');
	expect(readFileSync(`${VAULT}/recipes/sandwichs-du-pique-nique.md`, 'utf8')).not.toContain('Pique-nique');

	// The label shows in the filters.
	await page.goto('/?tag=soiree-cinema');
	await expect(page.locator('.count')).toHaveText('2 recettes');
	await page.getByRole('button', { name: /^Filtrer/ }).click();
	await page.locator('.facets').getByRole('button', { name: /de plus/ }).first().click();
	await expect(page.locator('.facets')).toContainText('Soirée cinéma');
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
