import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// The e2e vault (tests/e2e/serve.ts → scripts/fixture-vault.ts).
const VAULT = '/tmp/rv-e2e/vault';
const lastCommit = () => execFileSync('git', ['log', '-1', '--format=%s'], { cwd: VAULT, encoding: 'utf8' }).trim();

async function setLabel(page: import('@playwright/test').Page, label: string) {
	await page.goto('/famille/lasagna');
	await page.getByText('Changer le nom de la famille').click();
	await page.getByLabel('Nom affiché').fill(label);
	await page.getByRole('button', { name: 'Enregistrer le nom' }).click();
	await expect(page.locator('.flash')).toHaveText('Nom de la famille enregistré.');
}

test('a family gets a display name, saved to the vault and shown everywhere', async ({ page }) => {
	await page.goto('/famille/lasagna');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lasagna');

	await setLabel(page, 'Lasagnes de la maison');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lasagnes de la maison');
	expect(readFileSync(`${VAULT}/vocab/families.yaml`, 'utf8')).toContain('lasagna: { fr: Lasagnes de la maison }');
	expect(lastCommit()).toBe('family: lasagna → Lasagnes de la maison');

	await page.goto('/familles');
	await expect(page.getByRole('link', { name: 'Lasagnes de la maison' })).toBeVisible();
	await page.goto('/r/lasagna-bolognaise');
	await expect(page.locator('.family')).toContainText('Lasagnes de la maison');
	await page.goto('/?famille=lasagna');
	await expect(page.locator('.facets')).toContainText('Lasagnes de la maison');

	// Cleared: back to the name from the slug.
	await setLabel(page, '');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lasagna');
	expect(lastCommit()).toBe('family: lasagna (label removed)');
	expect(readFileSync(`${VAULT}/vocab/families.yaml`, 'utf8')).not.toContain('lasagna');
});

test('a family name from a stale page is refused', async ({ page, request }) => {
	await page.goto('/famille/lasagna');
	const res = await request.post('/famille/lasagna?/label', {
		headers: { origin: 'http://127.0.0.1:3398' },
		form: { label: 'Autre nom', hash: 'not-the-current-hash' }
	});
	expect(await res.text()).toContain('rechargez');
	expect(readFileSync(`${VAULT}/vocab/families.yaml`, 'utf8')).not.toContain('Autre nom');
});
