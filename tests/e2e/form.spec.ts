import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { file } from './helpers';

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
	// A phone folds a filled row it is not working on to one line: touched, it opens.
	const line = r.getByTestId('item-line');
	if (await line.isVisible()) await line.click();
	await r.getByTestId('qty').first().fill(qty);
	await r.getByTestId('unit').first().selectOption(unit);
	await r.getByTestId('name').first().fill(name);
	return r;
}

/** « Classement » is folded on a new recipe until there is something in it. */
async function openClass(page: Page) {
	const toggle = page.getByTestId('class-toggle');
	if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

async function saveAndLand(page: Page, slug: string) {
	// An edit says « Modifications enregistrées. », a new recipe « Recette enregistrée. ».
	const edit = page.url().endsWith('/modifier');
	await page.getByTestId('save').click();
	await expect(page).toHaveURL(`/r/${slug}`);
	await expect(page.getByTestId('toast')).toContainText(edit ? 'Modifications enregistrées.' : 'Recette enregistrée.');
}

test('a new recipe: two groups, a fraction, a range, three steps — saved canonical, hers, findable', async ({ page }) => {
	const t = title('Gâteau du formulaire');
	const slug = slugOf(t);
	await page.goto('/nouvelle');
	await expect(page.getByTestId('save')).toBeDisabled();
	await expect(page.getByTestId('savebar')).toContainText('Il manque : un titre');
	// Three empty rows of each to type in at once; the quick Save says how much is left.
	await expect(page.getByTestId('item-row')).toHaveCount(3);
	await expect(page.getByTestId('step')).toHaveCount(3);
	await expect(page.getByTestId('save-count')).toHaveText('2 à compléter');

	await page.getByTestId('title').fill(t);
	// A fraction from the chips a phone keyboard lacks.
	const first = page.getByTestId('item-row').first();
	await first.getByTestId('qty').fill('1');
	await first.getByRole('button', { name: '½' }).click();
	await expect(first.getByTestId('qty')).toHaveValue('1 ½');
	await first.getByTestId('unit').selectOption('cup');
	await first.getByTestId('name').fill('farine');
	// Enter in a name goes to the next row (the empty one already there), its quantity focused.
	await first.getByTestId('name').press('Enter');
	await expect(page.getByTestId('item-row')).toHaveCount(3);
	await expect(page.getByTestId('item-row').nth(1).getByTestId('qty')).toBeFocused();
	await row(page, 1, '2', 'piece', 'œufs');
	// The last row filled, Enter adds one.
	await row(page, 2, '1', 'tsp', 'vanille');
	await page.getByTestId('item-row').nth(2).getByTestId('name').first().press('Enter');
	await expect(page.getByTestId('item-row')).toHaveCount(4);
	await expect(page.getByTestId('item-row').nth(3).getByTestId('qty')).toBeFocused();

	await page.getByTestId('add-group').click();
	await page.getByTestId('group-name').nth(0).fill('Gâteau');
	await page.getByTestId('group-name').nth(1).fill('Glaçage');
	// The first group's empty fourth row is left as is (not written); the new group's row is the fifth.
	const r = await row(page, 4, '1', 'tbsp', 'beurre');
	// The row's ⋯ → Détails → « Ajouter un détail » → Jusqu’à.
	await r.getByTestId('item-menu').first().click();
	await r.getByRole('button', { name: 'Détails' }).click();
	await r.getByTestId('add-detail').selectOption({ label: 'Jusqu’à' });
	await r.getByTestId('qty-max').fill('2');
	// Closed again, the row says what its details hold.
	await r.getByRole('button', { name: 'Moins' }).click();
	await expect(r.getByTestId('item-summary')).toContainText('jusqu’à 2');

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
	expect(text).toContain('{ qty: 1, unit: tsp, name: vanille }');
	// Empty rows are not written.
	expect(text).not.toMatch(/\{ \}|name: ""|name: ''/);
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
	// « Modifier »: a button on a wide screen, an item of the ⋯ menu on a phone.
	const edit = page.locator('[data-testid="edit"]:visible');
	if (!(await edit.count())) await page.getByTestId('recipe-actions').click();
	await edit.click();
	await expect(page).toHaveURL(`/r/${slug}/modifier`);
	await expect(page.getByTestId('title')).toHaveValue(t);
	await page.getByTestId('save').click();
	await expect(page.getByTestId('toast')).toContainText('Rien n’a changé');
	expect(git('rev-list', '--count', 'HEAD')).toBe(commits);

	await page.goto(`/r/${slug}/modifier`);
	// Each step's ⋯ menu moves it; « Monter » on the third.
	await page.getByTestId('step-row').nth(2).getByTestId('step-menu').click();
	await page.getByTestId('step-row').nth(2).getByRole('button', { name: 'Monter' }).click();
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

test('« Coller une liste » fills the rows with what it read; « Donne » takes a free yield', async ({ page }) => {
	const t = title('Biscuits collés');
	const slug = slugOf(t);
	await page.goto('/nouvelle');
	await page.getByTestId('title').fill(t);
	// Classement waits folded, saying it is empty.
	await expect(page.getByTestId('class-summary')).toBeVisible();
	await expect(page.getByTestId('family-search')).toBeHidden();

	await page.getByTestId('paste-items').click();
	await page.getByTestId('list-paste-text').fill('2 tasses de farine\n1 c. à thé de sel\n3 gousses d’ail hachées 500 g\n');
	await expect(page.getByTestId('list-paste-item')).toHaveCount(3);
	await expect(page.getByTestId('list-paste-item').nth(2)).toContainText('à vérifier');
	await page.getByTestId('list-paste-add').click();
	await expect(page.getByTestId('toast')).toContainText('3 ingrédients ajoutés.');
	await expect(page.getByTestId('item-row')).toHaveCount(3);
	const first = page.getByTestId('item-row').first();
	await expect(first.getByTestId('qty').first()).toHaveValue('2');
	await expect(first.getByTestId('unit').first()).toHaveValue('cup');
	await expect(first.getByTestId('name').first()).toHaveValue('farine');
	// The line it could not read is the whole name, to fix by hand.
	await expect(page.getByTestId('item-row').nth(2).getByTestId('name').first()).toHaveValue('3 gousses d’ail hachées 500 g');
	await row(page, 2, '3', 'clove', 'ail');

	// One « Donne » field: a number is portions, words are the yield.
	await page.getByTestId('yield').fill('8');
	await expect(page.locator('#gives-as')).toContainText('portions');
	await page.getByTestId('yield').fill('24 biscuits');
	await expect(page.locator('#gives-as')).toHaveText('Ce que donne la recette, tel qu’écrit.');
	await saveAndLand(page, slug);
	const text = read(slug);
	expect(text).toMatch(/^yield: "?24 biscuits"?$/m);
	expect(text).not.toMatch(/^servings:/m);
	expect(text).toContain('{ qty: 2, unit: cup, name: farine }');
});

test('the save bar names what is missing; Save, tapped too early, goes to it', async ({ page }) => {
	await page.goto('/nouvelle');
	// The sentence as shown (not the hidden description): a list joined as French joins it.
	await expect(page.getByTestId('save-sentence')).toHaveText('Il manque : un titre et un ingrédient.');
	// Not ready: Save still a button, aria-disabled, and it takes her to the first missing field.
	await page.getByTestId('save').click({ force: true });
	await expect(page.getByTestId('title')).toBeFocused();
	await expect(page).toHaveURL('/nouvelle');
	await page.getByTestId('title').fill(title('Presque prête'));
	await expect(page.getByTestId('save-sentence')).toHaveText('Il manque : un ingrédient.');
	await page.evaluate(() => localStorage.clear());
});

// ---------------------------------------------------------------- UI pass 3

test('the parts of the form: a dot says what is filled; a link goes there, opening Classement', async ({ page }) => {
	await page.goto('/nouvelle');
	const nav = page.getByTestId('form-nav');
	await expect(nav.getByTestId('nav-title')).toContainText('(vide)');
	await page.getByTestId('title').fill(title('Recette du rail'));
	await expect(nav.getByTestId('nav-title')).toContainText('(rempli)');
	await expect(page.getByTestId('class-summary')).toBeVisible();
	// A phone has the parts as one picker; a wider screen, links.
	const picker = nav.getByTestId('nav-select');
	if (await picker.isVisible()) await picker.selectOption('class');
	else await nav.getByTestId('nav-class').click();
	await expect(page.getByTestId('class-toggle')).toHaveAttribute('aria-expanded', 'true');
	await expect(page.locator('#sec-class')).toBeFocused();
	await expect(nav.getByTestId('nav-class')).toHaveAttribute('aria-current', 'location');
	// Notes wait folded on one line too; « Ajouter » opens them, the box focused.
	await expect(page.getByTestId('notes-summary')).toHaveText('Aucune note');
	await page.getByTestId('notes-toggle').click();
	await expect(page.getByTestId('text-notes')).toBeFocused();
	await page.evaluate(() => localStorage.clear());
});

test('the quick Save is in reach and covers nothing; not ready, it goes to what is missing', async ({ page }) => {
	await page.goto('/nouvelle');
	// A phone: Enregistrer is in the bar at the bottom of the screen (round 3); wider, in the rail or the strip.
	const phone = page.viewportSize()!.width <= 600;
	const quick = phone ? page.getByTestId('save') : page.getByTestId('save-quick');
	await expect(quick).toBeVisible();
	await expect(quick).toHaveAttribute('aria-disabled', 'true');
	// aria-disabled, not disabled: it still answers, by going to what is missing.
	await quick.click({ force: true });
	await expect(page.getByTestId('title')).toBeFocused();
	await page.getByTestId('title').fill(title('Rapide'));
	await expect(page.getByTestId('save-count')).toHaveText('1 à compléter');
	// Nothing floats over the cards: the page is as wide as the screen, whatever has the focus.
	const width = page.viewportSize()!.width;
	for (const el of [page.getByTestId('qty').first(), page.locator('#time-prep'), page.getByTestId('step').first()]) {
		await el.focus();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
	}
	await page.evaluate(() => localStorage.clear());
});

test('an edit opens Notes and Classement folded to one line each, saying what they hold', async ({ page }) => {
	const t = title('Galette pliée');
	const slug = slugOf(t);
	await page.goto('/nouvelle');
	await page.getByTestId('title').fill(t);
	await row(page, 0, '1', 'cup', 'farine');
	await page.getByTestId('notes-toggle').click();
	await page.getByTestId('text-notes').fill('Meilleure le lendemain.');
	await saveAndLand(page, slug);
	await page.goto(`/r/${slug}/modifier`);
	await expect(page.getByTestId('notes-summary')).toHaveText('Meilleure le lendemain.');
	await expect(page.getByTestId('text-notes')).toBeHidden();
	await expect(page.getByTestId('class-summary')).toBeVisible();
	await page.getByTestId('notes-toggle').click();
	await expect(page.getByTestId('text-notes')).toHaveValue('Meilleure le lendemain.');
});

test('provenance names its fields for the kind of source; « + Repos, total » until asked for', async ({ page }) => {
	await page.goto('/nouvelle');
	await expect(page.getByLabel('De qui')).toHaveAttribute('placeholder', 'ex. Tante Irène');
	await page.getByTestId('src-type').selectOption('book');
	await expect(page.getByLabel('Auteur ou éditeur')).toBeVisible();
	await expect(page.getByLabel('Titre du livre')).toBeVisible();
	await page.getByTestId('src-type').selectOption('magazine');
	await expect(page.getByLabel('Numéro / page')).toBeVisible();
	await page.getByTestId('src-type').selectOption('website');
	await expect(page.getByLabel('Site', { exact: true })).toBeVisible();
	await expect(page.getByLabel('Adresse', { exact: true })).toBeVisible();
	// Préparation and cuisson with an example; repos and total behind one link, on every screen.
	await expect(page.locator('#time-prep')).toHaveAttribute('placeholder', 'ex. 20 min');
	await expect(page.locator('#time-rest')).toBeHidden();
	await page.getByTestId('add-times').click();
	await expect(page.locator('#time-rest')).toBeFocused();
	await page.evaluate(() => localStorage.clear());
});

test('a phone shows filled rows as one line each; a touch or Enter opens one, the one before folds back', async ({ page }) => {
	test.skip(test.info().project.name !== 'phone', 'the folded lines are the phone layout');
	await page.goto('/nouvelle');
	await page.getByTestId('title').fill(title('Rangs repliés'));
	await page.getByTestId('paste-items').click();
	await page.getByTestId('list-paste-text').fill('2 tasses de farine\n1 c. à thé de sel\n');
	await page.getByTestId('list-paste-add').click();
	const rows = page.getByTestId('item-row');
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(0).getByTestId('item-line')).toContainText('farine');
	await expect(rows.nth(0).getByTestId('qty')).toBeHidden();
	await rows.nth(0).getByTestId('item-line').click();
	await expect(rows.nth(0).getByTestId('qty')).toBeFocused();
	await expect(rows.nth(1).getByTestId('item-line')).toBeVisible();
	await rows.nth(1).getByTestId('item-line').focus();
	await page.keyboard.press('Enter');
	await expect(rows.nth(1).getByTestId('qty')).toBeFocused();
	await expect(rows.nth(0).getByTestId('item-line')).toBeVisible();
	// A new row is open at once.
	await page.getByTestId('add-item').click();
	await expect(rows.nth(2).getByTestId('qty')).toBeFocused();
	await page.evaluate(() => localStorage.clear());
});

test('a new recipe joins an existing family and shows on the family page', async ({ page }) => {
	// Not « lasagna »: other specs count that family's recipes.
	const t = title('Tarte aux pommes du formulaire');
	const slug = slugOf(t);
	await page.goto('/nouvelle');
	await page.getByTestId('title').fill(t);
	await row(page, 0, '6', 'piece', 'pommes');
	await openClass(page);
	await page.getByTestId('family-search').fill('tarte aux pom');
	await page.getByRole('option', { name: /Tarte aux pommes/ }).first().click();
	await expect(page.getByTestId('family-name')).toHaveText('Tarte aux pommes');
	// Before the save it says which group she joins, and who is in it already.
	await expect(page.getByTestId('family-joins')).toContainText(/Elle rejoindra : Tarte aux pommes \(\d+ recettes?\)/);
	// The variant is required; no author here, so it starts empty, examples in the placeholder (never a fragment of the title).
	await expect(page.locator('#variant')).toHaveValue('');
	await expect(page.locator('#variant')).toHaveAttribute('placeholder', /zeste de citron/);
	await page.locator('#variant').fill('du formulaire');
	await saveAndLand(page, slug);
	expect(read(slug)).toContain('family: tarte-aux-pommes');
	await page.goto('/famille/tarte-aux-pommes');
	await expect(page.locator('main')).toContainText(t);
});

test('the family picker offers a new family only when none is close', async ({ page }) => {
	await page.goto('/nouvelle');
	await openClass(page);
	await page.getByTestId('family-search').fill('Lasagnaa');
	await expect(page.getByRole('option', { name: /Lasagna/ })).toBeVisible();
	await expect(page.getByRole('option', { name: /Nouveau groupe/ })).toHaveCount(0);
	await page.getByTestId('family-search').fill('Pouding inventé');
	await expect(page.getByRole('option', { name: 'Nouveau groupe « Pouding inventé »' })).toBeVisible();
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
	await openClass(page);
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

// ---------------------------------------------------------------- P2 review fixes

/** A recipe written straight to the vault (as a paste would), for the form to open. */
async function putRecipe(page: Page, t: string, extra: string, steps: string[]) {
	const text = `---\nschema: 3\ntitle: "${t}"\n${extra}source: { type: invented }\nservings: 4\ningredients:\n  - items:\n      - { qty: 1, unit: cup, name: farine }\nextracted_by: ai\n---\n\n## Préparation\n\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`;
	const res = await page.request.post('/api/save', { headers: ORIGIN, data: { files: [{ text }] } });
	expect(res.ok()).toBe(true);
}

test('"Autre lecture" replaces only the uncertain word; same readings and a repeated tag do not break the form', async ({ page }) => {
	const t = title('Tarte au sucre à relire');
	await putRecipe(page, t.replace('sucre', 'sucre [?: sirop]'), `slug: ${slugOf(t)}\ntags: [dessert, dessert]\n`, ['Ajouter 1 [?: 2] tasse de lait et 1 [?: 2] c. à thé de sel.', 'Cuire.']);
	const slug = slugOf(t);
	await page.goto(`/r/${slug}/modifier`);
	await expect(page.getByTestId('title')).toHaveValue(t);
	// The tag given twice shows twice, and the form renders.
	await expect(page.getByTestId('tags').locator('.chips > li:not(.hint)')).toHaveCount(2);

	const step = page.getByTestId('step').first();
	const stepMarks = page.getByTestId('step-row').first().getByTestId('marks-text');
	await expect(stepMarks.getByRole('button', { name: /2/ })).toHaveCount(2);
	await stepMarks.getByRole('button', { name: /2/ }).nth(1).click();
	await expect(step).toHaveValue('Ajouter 1 tasse de lait et 2 c. à thé de sel.');

	await page.getByTestId('marks-title').getByRole('button', { name: /sirop/ }).click();
	await expect(page.getByTestId('title')).toHaveValue(t.replace(/sucre/, 'sirop'));
	await page.evaluate(() => localStorage.clear());
});

test('Enter in a one-line field does not save the recipe', async ({ page }) => {
	await page.goto('/nouvelle');
	await page.getByTestId('title').fill(title('Pas encore finie'));
	await row(page, 0, '1', 'cup', 'farine');
	await expect(page.getByTestId('save')).toBeEnabled();
	await page.getByTestId('title').press('Enter');
	await openClass(page);
	await page.getByTestId('family-search').fill('Famille pas encore');
	await page.getByTestId('family-search').press('Escape');
	await page.getByTestId('family-search').press('Enter');
	await page.waitForTimeout(500);
	await expect(page).toHaveURL('/nouvelle');
	await page.evaluate(() => localStorage.clear());
});

test('a save right after typing leaves no draft behind', async ({ page }) => {
	const t = title('Sauvée sans brouillon');
	await page.goto('/nouvelle');
	await page.getByTestId('title').fill('x');
	await row(page, 0, '1', 'cup', 'riz');
	await page.getByTestId('title').fill(t);
	await saveAndLand(page, slugOf(t));
	await page.waitForTimeout(800);
	expect(await page.evaluate(() => localStorage.getItem('recipevault:draft::nouvelle'))).toBeNull();
});

test('a suggestion is taken on the tap, not when a finger lands to scroll', async ({ page }) => {
	await page.goto('/nouvelle');
	await openClass(page);
	await page.getByTestId('tag-search').fill('dess');
	const opt = page.locator('#tag-search-list').getByRole('option').first();
	await expect(opt).toBeVisible();
	await opt.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true });
	await opt.dispatchEvent('pointercancel', { pointerType: 'touch', isPrimary: true });
	await expect(page.getByTestId('tags').locator('.chips > li')).toHaveCount(0);
	await page.getByTestId('tag-search').fill('desse');
	await page.locator('#tag-search-list').getByRole('option').first().click();
	await expect(page.getByTestId('tags').locator('.chips > li')).toHaveCount(1);
	await page.evaluate(() => localStorage.clear());
});

test('the draft banner asks before a save; the draft keeps a new family and a time range', async ({ page }) => {
	const t = title('Pâté du brouillon');
	await page.goto('/nouvelle');
	await page.getByTestId('title').fill(t);
	await row(page, 0, '1', 'lb', 'bœuf haché');
	const fam = `Pâté inventé ${test.info().project.name}`;
	await openClass(page);
	await page.getByTestId('family-search').fill(fam);
	await page.getByRole('option', { name: `Nouveau groupe « ${fam} »` }).click();
	await page.locator('#variant').fill('du brouillon');
	// One box per time, read as she types it.
	await page.locator('#time-prep').fill('20 à 30 min');
	// "1,5" with no unit is not a time (1,5 min): what she typed stays, never "NaN".
	await page.locator('#time-cook').fill('1,5');
	await expect(page.locator('#time-cook')).toHaveValue('1,5');
	// Kept in the draft as typed (issue #11): it comes back on resume, and still blocks Save.
	await expect.poll(() => page.evaluate(() => localStorage.getItem('recipevault:draft::nouvelle') ?? '')).toContain('1,5');
	await expect.poll(() => page.evaluate(() => localStorage.getItem('recipevault:draft::nouvelle') ?? '')).toContain(fam);

	await page.reload();
	await expect(page.getByTestId('draft-banner')).toBeVisible();
	// Never a silent dead save (usability round 5): Ctrl+Entrée before she chose asks here, the question focused.
	await page.locator('#time-prep').press('Control+Enter');
	await expect(page.getByTestId('draft-ask')).toContainText('Choisissez d’abord');
	await expect(page.getByRole('button', { name: 'Reprendre le brouillon' })).toBeFocused();
	await page.getByRole('button', { name: 'Reprendre le brouillon' }).click();
	await expect(page.getByTestId('family-name')).toHaveText(fam);
	await expect(page.locator('#time-prep')).toHaveValue('20 à 30 min');
	await expect(page.locator('#time-cook')).toHaveValue('1,5');
	await expect(page.getByTestId('save')).toBeDisabled();
	await page.locator('#time-cook').fill('');
	await saveAndLand(page, slugOf(t));
	expect(read(slugOf(t))).toContain('prep: 20m-30m');
	expect(readFileSync(`${VAULT}/vocab/families.yaml`, 'utf8')).toContain(fam);
});

test('a comma in an ingredient name is named on its row and nothing is saved', async ({ page }) => {
	const commits = git('rev-list', '--count', 'HEAD');
	await page.goto('/nouvelle');
	await page.getByTestId('title').fill(title('Deux en un'));
	const r = await row(page, 0, '1', 'cup', 'farine, sucre');
	await expect(r).toContainText('Un ingrédient par ligne ; une précision va en note ou en préparation.');
	await expect(page.getByTestId('savebar')).toContainText('À corriger : un nom d’ingrédient avec une virgule');
	await expect(page.getByTestId('save')).toBeDisabled();
	await page.getByTestId('title').press('Enter');
	await page.waitForTimeout(300);
	await expect(page).toHaveURL('/nouvelle');
	expect(git('rev-list', '--count', 'HEAD')).toBe(commits);
	// Fixed: the block goes.
	await r.getByTestId('name').first().fill('farine');
	await expect(r).not.toContainText('Un ingrédient par ligne');
	await expect(page.getByTestId('save')).toBeEnabled();
	await page.evaluate(() => localStorage.clear());
});

test('"En faire deux versions": the same title twice makes a family of both, in one commit', async ({ page }) => {
	const t = title('Pouding jumeau');
	const first = slugOf(t);
	await page.goto('/nouvelle');
	await page.getByTestId('title').fill(t);
	await row(page, 0, '2', 'cup', 'lait');
	await saveAndLand(page, first);
	const before = git('rev-parse', 'HEAD');

	// The same title again: the live check offers W608's pair.
	await page.goto('/nouvelle');
	const top = () => page.getByTestId('src-type').evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
	const at = await top();
	await page.getByTestId('title').fill(t);
	await row(page, 0, '1', 'cup', 'cassonade');
	const offer = page.getByTestId('same-title');
	// One line under the title, its room kept: the form does not move when it shows.
	await expect(offer).toBeVisible();
	await expect(offer).toContainText('Ce titre existe déjà.');
	expect(await top()).toBe(at);
	await offer.getByRole('button', { name: 'En faire une variante' }).click();
	await expect(page.getByTestId('pair')).toBeVisible();
	await expect(page.getByTestId('family-name')).toHaveText(t);
	// Both variants are required before Save.
	await page.locator('#variant').fill('à la cassonade');
	await expect(page.getByTestId('save')).toBeDisabled();
	await page.locator('#pair-variant').fill('au lait');
	await page.getByTestId('save').click();
	await expect(page).toHaveURL(new RegExp(`^.*/r/${first}-[a-z0-9-]+$`));
	await expect(page.getByTestId('toast')).toContainText('Recette enregistrée.');
	const second = new URL(page.url()).pathname.split('/').pop()!;

	// One commit: the new recipe, the other one, the family's label.
	expect(git('rev-list', '--count', `${before}..HEAD`)).toBe('1');
	expect(git('show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual([`recipes/${first}.md`, `recipes/${second}.md`, 'vocab/families.yaml'].sort());
	expect(read(first)).toMatch(new RegExp(`\\nfamily: ${first}\\nvariant: au lait\\n`));
	expect(read(second)).toMatch(new RegExp(`\\nfamily: ${first}\\nvariant: à la cassonade\\n`));
	await page.goto(`/famille/${first}`);
	await expect(page.locator('main')).toContainText(/au lait/i);
	await expect(page.locator('main')).toContainText(/à la cassonade/i);
});

test('"Pas encore relié" waits until she leaves the name, and never blocks Save', async ({ page }) => {
	await page.goto('/nouvelle');
	await page.getByTestId('title').fill(title('Recette au nom inconnu'));
	const r = page.getByTestId('item-row').first();
	await r.getByTestId('qty').fill('1');
	await r.getByTestId('unit').selectOption('cup');
	const checked = page.waitForResponse((res) => res.url().endsWith('/api/form/check') && res.request().postData()!.includes('grumpfine'));
	await r.getByTestId('name').pressSequentially('grumpfine inventée');
	await checked;
	// The check answered, but she is still in the field: nothing under it.
	await expect(r.getByTestId('name')).toBeFocused();
	await expect(r.getByTestId('row-hint')).toHaveCount(0);
	await r.getByTestId('name').blur();
	await expect(r.getByTestId('row-hint')).toHaveText(/Pas encore relié/);
	await expect(page.getByTestId('save')).toBeEnabled();
	// Typing again hides it until she leaves the field again.
	await r.getByTestId('name').focus();
	await r.getByTestId('name').press('End');
	await r.getByTestId('name').pressSequentially('s');
	await expect(r.getByTestId('row-hint')).toHaveCount(0);
	await page.evaluate(() => localStorage.clear());
});

test('an error only the server check finds is named above Save, never the generic sentence', async ({ page }) => {
	await page.goto('/nouvelle');
	await page.getByTestId('title').fill(title('Recette refusée par le serveur'));
	await row(page, 0, '1', 'cup', 'farine');
	// What the server answers for a gap in the browser's check (E213: a sub-recipe that uses this one).
	await page.route('**/api/form/save', (route) =>
		route.fulfill({ json: { status: 'invalid', errors: [{ id: 'recipe', field: 'recipe', reason: 'checker', code: 'E213' }] } })
	);
	await page.getByTestId('save').click();
	const msg = page.getByTestId('form-message');
	await expect(msg).toContainText('Rien n’est enregistré.');
	await expect(msg).toContainText('sous-recette');
	await expect(msg).not.toContainText('corrigez les champs signalés');
	await expect(msg).not.toContainText('E213');
	await page.evaluate(() => localStorage.clear());
});

test('W505 in the form: shown for a recipe in a family too, without the pair offer (plan 05, Phase 6)', async ({ page }) => {
	// Ingredients of this project only, so the close recipe is the one planted here.
	const p = test.info().project.name;
	const ing = ['gelée de coings', 'zeste de cédrat', 'pistaches grillées', 'eau de fleur d’oranger']
		.map((n, i) => `      - { qty: ${i + 1}, unit: cup, name: ${n} ${p} }`)
		.join('\n');
	const [a, b] = [title('Carrés au cédrat'), title('Carrés de la voisine')];
	const res = await page.request.post('/api/save', {
		headers: ORIGIN,
		data: { files: [{ text: file(a, '', ing) }, { text: file(b, `family: carres-cedrat-${p}\nvariant: de la voisine\n`, ing) }] }
	});
	expect(res.ok()).toBe(true);
	await page.goto(`/r/${slugOf(b)}/modifier`);
	const hint = page.getByTestId('close-recipe');
	await expect(hint).toBeVisible();
	await expect(hint).toContainText(a);
	await expect(hint.getByRole('link')).toHaveAttribute('href', `/r/${slugOf(a)}`);
	// Already in a family: no "En faire deux versions" here.
	await expect(hint.getByRole('button')).toHaveCount(0);
	await page.evaluate(() => localStorage.clear());
});

test('Ctrl+Entrée saves an edit from any field; the recipe page says « Modifications enregistrées. »', async ({ page }) => {
	const t = title('Biscuits au clavier');
	const slug = slugOf(t);
	expect((await page.request.post('/api/save', { headers: ORIGIN, data: { files: [{ text: file(t) }] } })).ok()).toBe(true);
	await page.goto(`/r/${slug}/modifier`);
	await page.getByTestId('step').nth(1).fill('Cuire 25 min.');
	await page.getByTestId('step').nth(1).press('Control+Enter');
	await expect(page).toHaveURL(`/r/${slug}`);
	await expect(page.getByTestId('toast')).toContainText('Modifications enregistrées.');
	expect(read(slug)).toContain('2. Cuire 25 min.');
});

test('steps under no « Préparation » heading show as « Texte libre », are kept on save, and can be put in Préparation', async ({ page }) => {
	const t = title('Galettes sans titre');
	const slug = slugOf(t);
	const bare = file(t).replace('## Préparation\n\n1. Mélanger.\n2. Cuire 20 min.\n', 'De la boîte bleue.\n\n- Mélanger.\n- Cuire 20 min.\n');
	expect((await page.request.post('/api/save', { headers: ORIGIN, data: { files: [{ text: bare }] } })).ok()).toBe(true);
	await page.goto(`/r/${slug}/modifier`);
	// The form has a Préparation, and the text is there, editable.
	await expect(page.locator('#sec-method')).toBeVisible();
	await expect(page.getByTestId('free-text-box')).toHaveValue(/- Mélanger\.\n- Cuire 20 min\./);
	await page.getByTestId('title').fill(`${t} bis`);
	await page.getByTestId('save').click();
	await expect(page).toHaveURL(`/r/${slug}`);
	expect(read(slug)).toContain('De la boîte bleue.\n\n- Mélanger.\n- Cuire 20 min.');

	// « Ranger ces 2 lignes dans Préparation »: two steps, the sentence before them stays free text.
	await page.goto(`/r/${slug}/modifier`);
	await page.getByTestId('free-to-steps').click();
	await expect(page.getByTestId('step')).toHaveCount(2);
	await expect(page.getByTestId('step').first()).toHaveValue('Mélanger.');
	await expect(page.getByTestId('free-text-box')).toHaveValue('De la boîte bleue.');
	await page.getByTestId('save').click();
	await expect(page).toHaveURL(`/r/${slug}`);
	expect(read(slug)).toMatch(/De la boîte bleue\.\n\n## Préparation\n\n1\. Mélanger\.\n2\. Cuire 20 min\./);
});

test('Enter at the end of a step goes to the next one, adding it after the last; Maj+Entrée keeps a new line', async ({ page }) => {
	await page.goto('/nouvelle');
	await expect(page.getByTestId('step')).toHaveCount(3);
	const steps = page.getByTestId('step');
	await steps.nth(0).fill('Mélanger.');
	await steps.nth(0).press('End');
	await steps.nth(0).press('Enter');
	await expect(steps.nth(1)).toBeFocused();
	await expect(steps.nth(0)).toHaveValue('Mélanger.');
	await steps.nth(1).pressSequentially('Verser');
	await steps.nth(1).press('Shift+Enter');
	await steps.nth(1).pressSequentially('dans le moule.');
	await expect(steps.nth(1)).toHaveValue('Verser\ndans le moule.');
	await steps.nth(2).fill('Cuire.');
	await steps.nth(2).press('End');
	await steps.nth(2).press('Enter');
	await expect(steps).toHaveCount(4);
	await expect(steps.nth(3)).toBeFocused();
	// An empty step: Enter adds nothing.
	await steps.nth(3).press('Enter');
	await expect(steps).toHaveCount(4);
	await expect(steps.nth(3)).toHaveValue('');
	await page.evaluate(() => localStorage.clear());
});

test('an unlinked name a letter off a known one: « Vouliez-vous dire » it, Oui writes it', async ({ page }) => {
	await page.goto('/nouvelle');
	await page.getByTestId('title').fill(title('Recette au nom mal écrit'));
	const r = page.getByTestId('item-row').first();
	await r.getByTestId('qty').fill('1');
	await r.getByTestId('unit').selectOption('piece');
	const checked = page.waitForResponse((res) => res.url().endsWith('/api/form/check') && res.request().postData()!.includes('oigon'));
	await r.getByTestId('name').fill('oigon');
	await checked;
	await r.getByTestId('name').blur();
	await expect(r.getByTestId('name-near')).toContainText('Vouliez-vous dire « oignon » ?');
	await r.getByTestId('name-near-yes').click();
	await expect(r.getByTestId('name')).toHaveValue('oignon');
	await expect(r.getByTestId('name-near')).toHaveCount(0);
	await page.evaluate(() => localStorage.clear());
});

// ---------------------------------------------------------------- usability round 3

test('« N à compléter » takes her to the first field missing, its reason beside it; so does a blocked Ctrl+Entrée', async ({ page }) => {
	await page.goto('/nouvelle');
	const phone = page.viewportSize()!.width <= 600;
	// A required field waits quietly until Save is tried.
	await expect(page.getByTestId('err-title')).toHaveCount(0);
	await page.getByTestId(phone ? 'save-first' : 'save-go').click();
	await expect(page.getByTestId('title')).toBeFocused();
	await expect(page.getByTestId('err-title')).toHaveText('Il manque le titre.');
	await page.getByTestId('title').fill(title('Compteur'));
	await page.getByTestId('step').first().fill('Mélanger.');
	await page.getByTestId('step').first().press('Control+Enter');
	await expect(page.getByTestId('item-row').first().getByTestId('name')).toBeFocused();
	await expect(page.getByTestId('err-ingredients')).toBeVisible();
	await expect(page).toHaveURL('/nouvelle');
	await page.evaluate(() => localStorage.clear());
});

test('a bare count is « à l’unité »; what a row lacks waits until she leaves it', async ({ page }) => {
	const t = title('Patates comptées');
	await page.goto('/nouvelle');
	await page.getByTestId('title').fill(t);
	const r = page.getByTestId('item-row').first();
	await r.getByTestId('qty').fill('3');
	await r.getByTestId('qty').press('Tab');
	await expect(r.getByTestId('unit')).toBeFocused();
	await expect(r.getByTestId('unit')).toHaveValue('piece');
	await expect(r.locator('.err')).toHaveCount(0);
	// Left with no name: now it says so.
	await page.getByTestId('title').click();
	await expect(r.locator('.err')).toHaveText('Il manque le nom de l’ingrédient.');
	await r.getByTestId('name').fill('pommes de terre');
	await saveAndLand(page, slugOf(t));
	expect(read(slugOf(t))).toContain('{ qty: 3, unit: piece, name: pommes de terre }');
});

test('a whole line typed in the name: [Séparer : 1 · pincée · sel] puts the amount in its boxes', async ({ page }) => {
	await page.goto('/nouvelle');
	const r = page.getByTestId('item-row').first();
	await r.getByTestId('name').fill('1 pincée de sel');
	await expect(r.getByTestId('name-split-yes')).toHaveText('Séparer : 1 · pincée · sel');
	await r.getByTestId('name-split-yes').click();
	await expect(r.getByTestId('qty')).toHaveValue('1');
	await expect(r.getByTestId('unit')).toHaveValue('pinch');
	await expect(r.getByTestId('name')).toHaveValue('sel');
	await expect(r.getByTestId('name-split')).toHaveCount(0);
	await page.evaluate(() => localStorage.clear());
});

test('« En faire une variante » of a recipe in a group: « Ce qui distingue » right under the title, focused', async ({ page }) => {
	await page.goto('/nouvelle');
	await page.getByTestId('title').fill('Tarte aux pommes');
	const like = page.getByTestId('like-title');
	await expect(like).toBeVisible();
	await like.getByRole('button', { name: 'En faire une variante' }).click();
	await expect(page.getByTestId('variant-inline')).toBeVisible();
	await expect(page.locator('#variant-inline')).toBeFocused();
	await page.locator('#variant-inline').fill('du test');
	// The same value as Classement's field.
	await openClass(page);
	await expect(page.locator('#variant')).toHaveValue('du test');
	await page.evaluate(() => localStorage.clear());
});

test('a group’s name has a label in sight', async ({ page }) => {
	await page.goto('/nouvelle');
	await page.getByTestId('add-group').click();
	await expect(page.locator('.group-label').first()).toBeVisible();
	await expect(page.getByLabel('Nom du groupe 2')).toBeFocused();
	await page.evaluate(() => localStorage.clear());
});

test('a step’s time changed under Cuisson: « Cuisson : 12 min → 12 à 14 min ? » offered, never done on its own', async ({ page }) => {
	await page.goto('/nouvelle');
	await page.locator('#time-cook').fill('12 min');
	const step = page.getByTestId('step').first();
	await step.fill('Cuire 10 à 12 minutes.');
	await page.getByTestId('title').click();
	await step.fill('Cuire 12 à 14 minutes.');
	await page.getByTestId('title').click();
	await expect(page.getByTestId('time-nudge')).toContainText('Cuisson : 12 min → 12 à 14 min ?');
	await expect(page.locator('#time-cook')).toHaveValue('12 min');
	await page.getByTestId('time-nudge-yes').click();
	await expect(page.locator('#time-cook')).toHaveValue('12 à 14 min');
	await expect(page.getByTestId('time-nudge')).toHaveCount(0);
	await page.evaluate(() => localStorage.clear());
});

test('a save from the keyboard while in a changed step waits once for the time nudge', async ({ page }) => {
	await page.goto('/nouvelle');
	// Ready to save (title and a line), so only the nudge can hold it.
	await page.getByTestId('title').fill(title('Pâté du raccourci'));
	await row(page, 0, '2', 'cup', 'farine');
	await page.locator('#time-cook').fill('30 à 35 min');
	const step = page.getByTestId('step').first();
	await step.fill('Cuire au four 30 à 35 minutes.');
	await page.getByTestId('title').click();
	await step.fill('Cuire au four 35 à 40 minutes.');
	await step.press('Control+Enter');
	await expect(page.getByTestId('time-nudge')).toContainText('Cuisson : 30 à 35 min → 35 à 40 min ?');
	await expect(page.getByTestId('time-nudge-yes')).toBeFocused();
	await expect(page).toHaveURL(/\/nouvelle$/);
	await page.getByTestId('time-nudge-yes').click();
	await expect(page.locator('#time-cook')).toHaveValue('35 à 40 min');
	await page.evaluate(() => localStorage.clear());
});

test('a phone: the save bar stays at the bottom of the screen, and steps back while she types', async ({ page }) => {
	test.skip(page.viewportSize()!.width > 600, 'phone only');
	await page.goto('/nouvelle');
	await page.evaluate(() => window.scrollTo(0, 900));
	const bar = page.getByTestId('savebar');
	const box = (await bar.boundingBox())!;
	expect(box.y + box.height).toBeGreaterThan(page.viewportSize()!.height - 4);
	await expect(page.getByTestId('save-first')).toHaveText(/Il manque : un titre/);
	await page.getByTestId('step').first().focus();
	await expect(bar).toHaveCSS('position', 'relative');
	await page.evaluate(() => localStorage.clear());
});

test('typing past the draft banner of an edit starts from the recipe with her change; the save works and leaves no draft', async ({ page }) => {
	const t = title('Galettes du brouillon oublié');
	const slug = slugOf(t);
	expect((await page.request.post('/api/save', { headers: ORIGIN, data: { files: [{ text: file(t) }] } })).ok()).toBe(true);
	await page.goto(`/r/${slug}/modifier`);
	await page.getByTestId('step').first().fill('Brouillon laissé là.');
	// A draft being kept says so beside Enregistrer.
	await expect(page.getByTestId(page.viewportSize()!.width <= 600 ? 'draft-kept' : 'draft-kept-rail')).toHaveText(/^Brouillon gardé à\s\d{1,2}\sh\s\d{2}$/);
	await page.goto(`/r/${slug}`);
	await page.goto(`/r/${slug}/modifier`);
	await expect(page.getByTestId('draft-banner')).toBeVisible();
	// The form is live: her change answers « Repartir de la recette », the old draft a tap away.
	await page.getByTestId('step').nth(1).fill('Laisser reposer.');
	await expect(page.getByTestId('draft-banner')).toHaveCount(0);
	await expect(page.getByTestId('draft-aside')).toContainText('mis de côté');
	await page.getByTestId('step').nth(1).press('Control+Enter');
	await expect(page).toHaveURL(`/r/${slug}`);
	expect(read(slug)).toContain('Laisser reposer.');
	expect(read(slug)).not.toContain('Brouillon laissé là.');
	expect(await page.evaluate((k) => localStorage.getItem(k), `recipevault:draft:${slug}`)).toBeNull();
	await page.goto(`/r/${slug}/modifier`);
	await expect(page.getByTestId('draft-banner')).toHaveCount(0);
});

test('an empty row never blocks a save; a row with only a quantity takes her to its name, the reason beside it', async ({ page }) => {
	const t = title('Galettes à la ligne vide');
	const slug = slugOf(t);
	expect((await page.request.post('/api/save', { headers: ORIGIN, data: { files: [{ text: file(t) }] } })).ok()).toBe(true);
	await page.goto(`/r/${slug}/modifier`);
	const rows = page.getByTestId('item-row');
	const n = await rows.count();
	await page.getByTestId('add-item').first().click();
	await expect(rows).toHaveCount(n + 1);
	// Partly filled: Ctrl+Entrée goes to the name, its reason under it.
	await rows.nth(n).getByTestId('qty').fill('2');
	await page.getByTestId('step').first().press('Control+Enter');
	await expect(rows.nth(n).getByTestId('name')).toBeFocused();
	await expect(rows.nth(n).locator('.err')).toHaveText('Il manque le nom de l’ingrédient.');
	await expect(page).toHaveURL(`/r/${slug}/modifier`);
	// Emptied: it is ignored, the save goes through.
	await rows.nth(n).getByTestId('qty').fill('');
	await rows.nth(n).getByTestId('unit').selectOption('');
	await page.getByTestId('step').first().fill('Mélanger le tout.');
	await saveAndLand(page, slug);
	expect(read(slug)).toContain('Mélanger le tout.');
});

test('« 21/2 » in a quantity: « = 10 ½ — vouliez-vous 2 ½ ? », one tap writes it', async ({ page }) => {
	await page.goto('/nouvelle');
	const r = page.getByTestId('item-row').first();
	await r.getByTestId('qty').fill('21/2');
	await expect(r.getByTestId('qty-slip')).toContainText('21/2 = 10 ½ — vouliez-vous 2 ½ ?');
	// The fractions sit in the row, under the box: nothing covers the hint.
	await expect(r.getByTestId('fracs')).toBeVisible();
	await r.getByTestId('qty-slip-yes').click();
	await expect(r.getByTestId('qty')).toHaveValue('2 ½');
	await expect(r.getByTestId('qty-slip')).toHaveCount(0);
	await page.evaluate(() => localStorage.clear());
});

test('adding a second group asks the first one’s name first; Entrée goes on to the new one', async ({ page }) => {
	await page.goto('/nouvelle');
	await row(page, 0, '2', 'cup', 'farine');
	await page.getByTestId('add-group').click();
	await expect(page.getByLabel('Nom du groupe 1')).toBeFocused();
	await page.keyboard.type('Pâte');
	await page.keyboard.press('Enter');
	await expect(page.getByLabel('Nom du groupe 2')).toBeFocused();
	await page.keyboard.type('Garniture');
	await expect(page.getByTestId('group-name').nth(0)).toHaveValue('Pâte');
	await expect(page.getByTestId('group-name').nth(1)).toHaveValue('Garniture');
	await page.evaluate(() => localStorage.clear());
});

// ---------------------------------------------------------------- UI council round 1

test('hints never read as values; the line under the title keeps its place; Enregistrer at full strength', async ({ page }) => {
	await page.goto('/nouvelle');
	const phone = page.viewportSize()!.width <= 600;
	// « qté » in every quantity box, the one example in the first row, « ex. 350 » for the oven; upright, not italic.
	const qty = page.getByTestId('qty');
	await expect(qty.first()).toHaveAttribute('placeholder', 'qté');
	await expect(qty.nth(1)).toHaveAttribute('placeholder', 'qté');
	await expect(page.getByTestId('name').first()).toHaveAttribute('placeholder', 'ex. farine');
	await expect(page.getByTestId('name').nth(1)).toHaveAttribute('placeholder', 'ingrédient');
	await expect(page.getByTestId('oven-temp')).toHaveAttribute('placeholder', 'ex. 350');
	expect(await qty.first().evaluate((el) => getComputedStyle(el, '::placeholder').fontStyle)).toBe('normal');
	// No hint yet: the line under the title is empty but keeps its height, so a hint showing up while
	// the title is typed moves nothing below it (see "nothing moves" above).
	await expect(page.locator('.title-note')).toBeEmpty();
	// Not ready, Enregistrer stays at full strength; the sentence says why.
	const save = phone ? page.getByTestId('save') : page.getByTestId('save-quick');
	await expect(save).toHaveCSS('opacity', '1');
	// The column heads (a wider screen): sentence case.
	if (!phone) await expect(page.locator('.cols')).toHaveCSS('text-transform', 'none');
	await page.evaluate(() => localStorage.clear());
});
