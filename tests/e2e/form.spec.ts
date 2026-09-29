import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

// Plan 04, Phases 4–5: the recipe form on her devices (phone, tablet) and
// the desktop, signed in as the invented owner. The three projects share one
// vault, so every recipe made here has a title of its own per project.

const VAULT = '/tmp/rv-e2e/vault';
const ORIGIN = { origin: 'http://127.0.0.1:3398' };
const git = (...args: string[]) => execFileSync('git', args, { cwd: VAULT, encoding: 'utf8' }).trim();
const read = (slug: string) => readFileSync(`${VAULT}/recipes/${slug}.md`, 'utf8');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** A title unique to this project and test. */
function title(base: string): string {
	const p = test.info().project.name;
	return `${base} ${p === 'desktop' ? 'bureau' : p === 'phone' ? 'téléphone' : 'tablette'}`;
}
const slugOf = (t: string) =>
	t
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

async function row(page: Page, i: number, qty: string, unit: string, name: string) {
	const r = page.getByTestId('item-row').nth(i);
	await r.getByTestId('qty').first().fill(qty);
	await r.getByTestId('unit').first().selectOption(unit);
	await r.getByTestId('name').first().fill(name);
	return r;
}

async function saveAndLand(page: Page, slug: string) {
	await page.getByTestId('save').click();
	await expect(page).toHaveURL(`/r/${slug}`);
	await expect(page.getByTestId('toast')).toContainText('Recette enregistrée.');
}

test('a new recipe: two groups, a fraction, a range, three steps — saved canonical, hers, findable', async ({ page }) => {
	const t = title('Gâteau du formulaire');
	const slug = slugOf(t);
	await page.goto('/nouvelle');
	await expect(page.getByTestId('save')).toBeDisabled();
	await expect(page.getByTestId('savebar')).toContainText('donnez un titre');

	await page.getByTestId('title').fill(t);
	// A fraction from the chips a phone keyboard lacks.
	const first = page.getByTestId('item-row').first();
	await first.getByTestId('qty').fill('1');
	await first.getByRole('button', { name: '½' }).click();
	await expect(first.getByTestId('qty')).toHaveValue('1 ½');
	await first.getByTestId('unit').selectOption('cup');
	await first.getByTestId('name').fill('farine');
	// Enter in a name adds the next row, its quantity focused.
	await first.getByTestId('name').press('Enter');
	await expect(page.getByTestId('item-row')).toHaveCount(2);
	await expect(page.getByTestId('item-row').nth(1).getByTestId('qty')).toBeFocused();
	await row(page, 1, '2', 'piece', 'œufs');

	await page.getByTestId('add-group').click();
	await page.getByTestId('group-name').nth(0).fill('Gâteau');
	await page.getByTestId('group-name').nth(1).fill('Glaçage');
	const r = await row(page, 2, '1', 'tbsp', 'beurre');
	await r.getByRole('button', { name: 'Détails' }).click();
	await r.getByTestId('qty-max').fill('2');

	await page.getByTestId('step').first().fill('Mélanger la farine et les œufs.');
	await page.getByTestId('add-step').click();
	await page.getByTestId('step').nth(1).fill('Cuire 30 min.');
	await page.getByTestId('add-step').click();
	await page.getByTestId('step').nth(2).fill('Glacer.');

	await saveAndLand(page, slug);
	await expect(page.locator('main')).toContainText('Glaçage');

	const text = read(slug);
	expect(text).toContain(`title: ${t}`);
	expect(text).toContain('qty: "1 1/2"');
	expect(text).toContain('qty_max: 2');
	expect(text).toContain('group: Glaçage');
	expect(text).toMatch(/1\. Mélanger la farine et les œufs\.\n2\. Cuire 30 min\.\n3\. Glacer\./);
	expect(git('log', '-1', '--format=%an')).toBe('Proprio Inventé');
	expect(git('status', '--porcelain')).toBe('');

	await page.goto(`/?q=${encodeURIComponent(t)}`);
	await expect(page.locator('.cards')).toContainText(t);
});

test('an edit: reorder a step, save; an unchanged form writes nothing', async ({ page }) => {
	const t = title('Tarte à réordonner');
	const slug = slugOf(t);
	await page.goto('/nouvelle');
	await page.getByTestId('title').fill(t);
	await row(page, 0, '2', 'cup', 'farine');
	for (const [i, s] of ['Un.', 'Deux.', 'Trois.'].entries()) {
		if (i) await page.getByTestId('add-step').click();
		await page.getByTestId('step').nth(i).fill(s);
	}
	await saveAndLand(page, slug);
	const commits = git('rev-list', '--count', 'HEAD');

	// Unchanged: no commit.
	await page.getByTestId('edit').click();
	await expect(page).toHaveURL(`/r/${slug}/modifier`);
	await expect(page.getByTestId('title')).toHaveValue(t);
	await page.getByTestId('save').click();
	await expect(page.getByTestId('toast')).toContainText('Rien n’a changé');
	expect(git('rev-list', '--count', 'HEAD')).toBe(commits);

	await page.goto(`/r/${slug}/modifier`);
	await page.getByRole('button', { name: 'Monter — Étape 3' }).click();
	await expect(page.getByTestId('step').nth(1)).toHaveValue('Trois.');
	await saveAndLand(page, slug);
	expect(read(slug)).toMatch(/1\. Un\.\n2\. Trois\.\n3\. Deux\./);
	expect(git('log', '-1', '--format=%an')).toBe('Proprio Inventé');

	// "Annuler" in the toast: the edit undone as a new commit.
	await page.getByTestId('toast').getByRole('button', { name: 'Annuler' }).click();
	await expect(page.getByTestId('toast')).toContainText('Modification annulée.');
	expect(read(slug)).toMatch(/1\. Un\.\n2\. Deux\.\n3\. Trois\./);
});

test('a stale save shows both versions; "Garder ma version" saves hers', async ({ page }) => {
	const t = title('Soupe concurrente');
	const slug = slugOf(t);
	await page.goto('/nouvelle');
	await page.getByTestId('title').fill(t);
	await row(page, 0, '1', 'l', 'bouillon');
	await saveAndLand(page, slug);

	await page.goto(`/r/${slug}/modifier`);
	await page.getByTestId('title').fill(`${t} à moi`);
	// Someone else saves meanwhile.
	const theirs = read(slug).replace(`title: ${t}`, `title: ${t} à l’autre`);
	const res = await page.request.post('/api/save', { headers: ORIGIN, data: { files: [{ text: theirs, overwrite: sha(read(slug)) }] } });
	expect(res.ok()).toBe(true);

	await page.getByTestId('save').click();
	const stale = page.getByTestId('stale');
	await expect(stale).toContainText('modifiée entre-temps');
	await expect(stale).toContainText(`${t} à moi`);
	await expect(stale).toContainText(`${t} à l’autre`);
	await stale.getByRole('button', { name: 'Garder ma version' }).click();
	await expect(page).toHaveURL(`/r/${slug}`);
	expect(read(slug)).toContain(`title: ${t} à moi`);
});

test('reloading mid-typing offers the draft back', async ({ page }) => {
	const t = title('Brouillon gardé');
	await page.goto('/nouvelle');
	await page.getByTestId('title').fill(t);
	await page.getByTestId('name').first().fill('sucre');
	await expect.poll(() => page.evaluate(() => localStorage.getItem('recipevault:draft::nouvelle') ?? '')).toContain(t);
	await page.reload();
	await expect(page.getByTestId('draft-banner')).toBeVisible();
	await page.getByRole('button', { name: 'Reprendre le brouillon' }).click();
	await expect(page.getByTestId('title')).toHaveValue(t);
	await expect(page.getByTestId('name').first()).toHaveValue('sucre');
	// Starting over clears it.
	await page.reload();
	await page.getByRole('button', { name: 'Repartir de zéro' }).click();
	await expect(page.getByTestId('title')).toHaveValue('');
	await page.reload();
	await expect(page.getByTestId('draft-banner')).toHaveCount(0);
});

test('a preparation word in the name moves to préparation in one tap', async ({ page }) => {
	await page.goto('/nouvelle');
	const r = page.getByTestId('item-row').first();
	await r.getByTestId('name').fill('oignon haché');
	await expect(r.getByTestId('name-hint')).toContainText('« haché » dit comment le préparer');
	await r.getByRole('button', { name: 'Utiliser « haché »' }).click();
	await expect(r.getByTestId('name')).toHaveValue('oignon');
	await expect(r.getByTestId('name-hint')).toHaveCount(0);
	await expect(r.getByLabel('Préparation')).toHaveValue('haché');
	await page.evaluate(() => localStorage.clear());
});

test('a new recipe joins an existing family and shows on the family page', async ({ page }) => {
	// Not « lasagna »: other specs count that family's recipes.
	const t = title('Tarte aux pommes du formulaire');
	const slug = slugOf(t);
	await page.goto('/nouvelle');
	await page.getByTestId('title').fill(t);
	await row(page, 0, '6', 'piece', 'pommes');
	await page.getByTestId('family-search').fill('tarte aux pom');
	await page.getByRole('option', { name: /Tarte aux pommes/ }).first().click();
	await expect(page.getByTestId('family-name')).toHaveText('Tarte aux pommes');
	// The variant is required, pre-filled from the title's other words.
	await expect(page.locator('#variant')).toHaveValue(/^du formulaire/);
	await saveAndLand(page, slug);
	expect(read(slug)).toContain('family: tarte-aux-pommes');
	await page.goto('/famille/tarte-aux-pommes');
	await expect(page.locator('main')).toContainText(t);
});

test('the family picker offers a new family only when none is close', async ({ page }) => {
	await page.goto('/nouvelle');
	await page.getByTestId('family-search').fill('Lasagnaa');
	await expect(page.getByRole('option', { name: /Lasagna/ })).toBeVisible();
	await expect(page.getByRole('option', { name: /Nouvelle famille/ })).toHaveCount(0);
	await page.getByTestId('family-search').fill('Pouding inventé');
	await expect(page.getByRole('option', { name: 'Nouvelle famille « Pouding inventé »' })).toBeVisible();
	await page.evaluate(() => localStorage.clear());
});

test('undoing a new recipe sends it to the trash', async ({ page }) => {
	const t = title('Recette annulée');
	const slug = slugOf(t);
	await page.goto('/nouvelle');
	await page.getByTestId('title').fill(t);
	await row(page, 0, '1', 'cup', 'riz');
	await saveAndLand(page, slug);
	await page.getByTestId('toast').getByRole('button', { name: 'Annuler' }).click();
	await expect(page).toHaveURL('/corbeille');
	await expect(page.getByTestId('toast')).toContainText('mise à la corbeille');
	// "Rétablir" brings it back (and leaves the trash as the other specs expect it).
	await page.getByTestId('toast').getByRole('button', { name: 'Rétablir' }).click();
	await expect(page).toHaveURL(`/r/${slug}`);
	await expect(page.getByTestId('toast')).toContainText('sortie de la corbeille');
});

test('a new recipe with a photo and a tag of her own: the photo is sent after the first save, the tag waits', async ({ page }) => {
	const t = title('Tarte photographiée');
	const slug = slugOf(t);
	const jpg = await sharp({ create: { width: 120, height: 80, channels: 3, background: { r: 200, g: 150, b: 60 } } })
		.jpeg()
		.toBuffer();
	await page.goto('/nouvelle');
	await page.getByTestId('title').fill(t);
	await row(page, 0, '1', 'cup', 'sucre');
	await page.getByTestId('photo-input').setInputFiles({ name: 'plat.jpg', mimeType: 'image/jpeg', buffer: jpg });
	await expect(page.locator('main')).toContainText('Photo choisie : plat.jpg');
	await expect(page.locator('main')).toContainText('Le brouillon garde tout sauf la photo');
	const tag = `goûter inventé ${test.info().project.name}`;
	await page.getByTestId('tag-search').fill(tag);
	await page.getByTestId('tag-search').press('Enter');
	await expect(page.getByTestId('tags')).toContainText('nouvelle, en attente');
	await saveAndLand(page, slug);
	const text = read(slug);
	expect(text).toMatch(/media: \{ final: [^}]+\}|final: /);
	expect(text).toContain(tag);
	await expect(page.locator('figure.photo')).toHaveCount(1);
	// Two commits: the recipe, then its photo; both hers.
	expect(git('log', '-2', '--format=%an')).toBe('Proprio Inventé\nProprio Inventé');
});
