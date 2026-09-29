import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { devices, expect, test } from '@playwright/test';

// Plan 04, Phase 7: the history page and "Revenir à cette version", on a
// phone-sized screen (her device), signed in as the invented owner.
test.use({ ...devices['Pixel 7'] });

const VAULT = '/tmp/rv-e2e/vault';
const SLUG = 'soupe-aux-pois';
const FILE = `${VAULT}/recipes/${SLUG}.md`;
const ORIGIN = { origin: 'http://127.0.0.1:3398' };
const last = () => execFileSync('git', ['log', '-1', '--format=%s|%an'], { cwd: VAULT, encoding: 'utf8' }).trim();
const read = () => readFileSync(FILE, 'utf8');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

test('history lists a save in words; going back and undoing it are new commits by the signed-in person', async ({ page }) => {
	const original = read();
	const title = /^title: (.+)$/m.exec(original)![1];
	const edited = original.replace(`title: ${title}`, `title: ${title} du dimanche`);
	const res = await page.request.post('/api/save', { headers: ORIGIN, data: { files: [{ text: edited, overwrite: sha(original) }] } });
	expect(res.ok()).toBe(true);
	const saved = read();

	await page.goto(`/r/${SLUG}`);
	await page.getByRole('link', { name: 'Historique' }).click();
	await expect(page).toHaveURL(`/r/${SLUG}/historique`);
	const versions = page.locator('.versions > li');
	await expect(versions.first()).toContainText('Proprio Inventé');
	await expect(versions.first()).toContainText(`Titre : « ${title} » devient « ${title} du dimanche »`);
	await expect(versions.first()).toContainText('Version actuelle');
	await expect(page.locator('main')).not.toContainText('---');

	// Back to the first version: the confirm says what will change.
	const first = versions.last();
	await first.getByText('Revenir à cette version', { exact: true }).click();
	await expect(first.locator('.confirm')).toContainText('Ce retour changera');
	await expect(first.locator('.confirm')).toContainText(`devient « ${title} »`);
	await first.getByRole('button', { name: 'Oui, revenir à cette version' }).click();
	await expect(page.locator('.flash')).toContainText('La recette est revenue à cette version.');
	expect(last()).toMatch(new RegExp(`^restore: ${title} \\(version du \\d{4}-\\d\\d-\\d\\d\\)\\|Proprio Inventé$`));

	// "Annuler ce retour": an undo, itself a new commit.
	await page.getByRole('button', { name: 'Annuler ce retour' }).click();
	await expect(page.locator('.flash')).toContainText('Modification annulée.');
	expect(read()).toBe(saved);
	expect(last()).toBe(`undo: ${title} du dimanche|Proprio Inventé`);
	await expect(versions.first()).toContainText('Version actuelle');

	// Leave the vault as found for the other specs (and that is one more undo).
	await page.getByRole('button', { name: 'Rétablir' }).click();
	await expect(page.locator('.flash')).toContainText('Modification annulée.');
	const h = await page.request.post(`/r/${SLUG}/historique?/revenir`, {
		headers: ORIGIN,
		form: { commit: execFileSync('git', ['log', '--format=%H', '-1', '--diff-filter=A', '--follow', '--', `recipes/${SLUG}.md`], { cwd: VAULT, encoding: 'utf8' }).trim(), hash: sha(read()) }
	});
	expect(h.ok()).toBe(true);
	expect(read()).toBe(original);
});

test('a restore from a stale page is refused and changes nothing', async ({ page }) => {
	await page.goto(`/r/${SLUG}/historique`);
	const before = read();
	const commit = execFileSync('git', ['log', '--format=%H', '-1', '--', `recipes/${SLUG}.md`], { cwd: VAULT, encoding: 'utf8' }).trim();
	const res = await page.request.post(`/r/${SLUG}/historique?/revenir`, { headers: ORIGIN, form: { commit, hash: 'not-the-current-hash' } });
	expect(await res.text()).toContain('modifiée entre-temps');
	expect(read()).toBe(before);
});

test('an unknown recipe has no history page', async ({ page }) => {
	const res = await page.goto('/r/nulle-part-inventee/historique');
	expect(res?.status()).toBe(404);
});
