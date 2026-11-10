import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { fenced, paste } from './helpers';

test('paste a valid recipe: saved, box cleared and refocused, found by search', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, fenced('Galettes à la mélasse inventées'));
	await expect(page.getByText('Valide')).toBeVisible();
	// It passes: the text folded to its summary; Ctrl+Enter saves from anywhere on the page.
	await expect(page.getByLabel('Réponse de l’IA')).toBeHidden();
	await page.keyboard.press('Control+Enter');
	// A card at the top says it, with « Voir la recette » and « Ajouter une autre fiche ».
	const card = page.getByTestId('saved-card');
	await expect(card).toContainText('Recette enregistrée : Galettes à la mélasse inventées');
	await expect(card.getByRole('link', { name: 'Voir la recette' })).toHaveAttribute('href', '/r/galettes-a-la-melasse-inventees');
	await expect(page.getByLabel('Réponse de l’IA')).toHaveValue('');
	await expect(page.getByLabel('Réponse de l’IA')).toBeFocused();
	await card.getByRole('button', { name: 'Ajouter une autre fiche' }).click();
	await expect(card).toHaveCount(0);
	await expect(page.getByLabel('Réponse de l’IA')).toBeFocused();

	await page.goto('/');
	await page.getByRole('searchbox').fill('melasse invent');
	await expect(page).toHaveURL(/q=melasse/);
	await expect(page.locator('.cards')).toContainText('Galettes à la mélasse inventées');
	await page.getByRole('link', { name: 'Galettes à la mélasse inventées' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Galettes à la mélasse inventées');
	// An invented source and no photo: the keeper's line says there is no card to check it against.
	await expect(page.locator('.badge')).toHaveText('Saisie sans fiche d’origine');
});

test('paste an invalid recipe: the fix-request block is copied, with only ai codes', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, fenced('Biscuits cassés', '', '      - { qty: 1, unit: tasse, name: farine }'));
	await expect(page.getByText('À corriger')).toBeVisible();
	await expect(page.getByRole('button', { name: /Enregistrer/ })).toBeDisabled();
	await page.getByRole('button', { name: 'Copier la demande de correction' }).click();
	await expect(page.locator('.toast')).toContainText('Demande copiée');
	const clip = await page.evaluate(() => navigator.clipboard.readText());
	expect(clip).toContain('RECIPEVAULT — FILE REJECTED');
	expect(clip).toContain('[E201]');
	expect(clip).toContain('--- YOUR FILE ---');
	expect(clip).not.toContain('W602');
});

test('an unknown unit is replaced in place from the error, and the file passes', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, fenced('Biscuits à réparer inventés', '', '      - { qty: 1, unit: tasse, name: farine }'));
	await expect(page.getByText('À corriger')).toBeVisible();
	// The count beside Save goes to the first error: its fix, focused.
	await page.getByRole('button', { name: 'Corrigez 1 erreur pour enregistrer' }).click();
	// The alias table has one answer for « tasse »: one tap writes it; the list waits behind "Autre unité…".
	const write = page.locator('.diag.error .quickfix').getByRole('button', { name: 'Écrire cup' });
	await expect(write).toBeFocused();
	await expect(page.locator('.diag.error .quickfix').getByRole('combobox')).toBeHidden();
	await page.locator('.diag.error .quickfix').getByText('Autre unité…').click();
	await expect(page.locator('.diag.error form.quick')).toContainText('Remplacer « tasse » par');
	// Nothing chosen for her in the list: « Écrire cup » is the one answer.
	await expect(page.locator('.diag.error form.quick').getByRole('combobox')).toHaveValue('');
	await write.click();
	await expect(page.getByLabel('Réponse de l’IA')).toHaveValue(/\{ qty: 1, unit: cup, name: farine \}/);
	// Said as what the file now holds, in one line at the top of the result, with its undo.
	const fixes = page.getByTestId('fixes-line');
	await expect(fixes).toContainText('1 correction faite');
	await expect(fixes).toContainText('Unité écrite : cup');
	await expect(fixes.getByRole('button', { name: 'Annuler la dernière' })).toBeVisible();
	await expect(page.getByText('Valide')).toBeVisible();
	await expect(page.getByRole('button', { name: /Enregistrer/ })).toBeEnabled();
});

test('the same unknown unit on several lines: said once, replaced everywhere in one tap', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(
		page,
		fenced('Biscuits à trois tasses inventés', '', ['farine', 'sucre', 'lait'].map((n) => `      - { qty: 1, unit: tasse, name: ${n} }`).join('\n'))
	);
	await expect(page.getByRole('button', { name: 'Corrigez 3 erreurs pour enregistrer' })).toBeVisible();
	const items = page.locator('.diag.error .diag-item');
	await expect(items).toHaveCount(1);
	await expect(items.first()).toContainText('3 fois dans cette recette');
	await expect(items.first().locator('.more')).toHaveText('Aussi : 2e ingrédient (sucre) ; 3e ingrédient (lait)');
	await items.first().getByRole('button', { name: 'Écrire cup partout (3)' }).click();
	await expect(page.getByLabel('Réponse de l’IA')).not.toHaveValue(/unit: tasse/);
	await expect(page.getByText('Valide')).toBeVisible();
});

test('once the AI is opened, a phone shows steps 1–2 as one line; « Coller » reads the clipboard', async ({ page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	// Step 2 opens Claude in a new tab: answered here, nothing leaves the test.
	await context.route('https://claude.ai/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '' }));
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/ajouter');
	await page.evaluate(() => localStorage.removeItem('recipevault:prompt-donne'));
	await page.reload();
	const steps = page.getByRole('list', { name: 'Ajouter une fiche en trois étapes' });
	await expect(steps).toBeVisible();
	await page.getByRole('button', { name: 'Copier les consignes pour l’IA' }).click();
	// « ✓ Copié » on the button; step 1 ticked; the steps stay until step 2 is done.
	await expect(steps.getByRole('button', { name: 'Copié' })).toBeVisible();
	await expect(steps.locator('li.done')).toHaveCount(1);
	await expect(steps).toBeVisible();
	const ai = page.getByRole('link', { name: /^Ouvrir Claude/ });
	await expect(ai).toHaveAttribute('href', 'https://claude.ai/new');
	await expect(ai).toHaveAttribute('target', '_blank');
	const popup = context.waitForEvent('page');
	await ai.click();
	await (await popup).close();
	await expect(steps).toBeHidden();
	await expect(page.locator('.steps-line')).toContainText('Consignes copiées');
	await expect(page.getByRole('button', { name: 'Coller', exact: true })).toHaveClass(/primary/);
	// Remembered on this device; « Revoir » opens them again.
	await page.reload();
	await expect(page.locator('.steps-line')).toContainText('Consignes déjà données');
	await page.getByRole('button', { name: 'Revoir' }).click();
	await expect(steps).toBeVisible();
	await page.evaluate((t) => navigator.clipboard.writeText(t), fenced('Galettes collées inventées'));
	await page.getByRole('button', { name: 'Coller', exact: true }).click();
	await expect(page.getByText('Valide')).toBeVisible();
	await page.evaluate(() => localStorage.removeItem('recipevault:prompt-donne'));
});

test('a paste anywhere on the page goes in the box; a passing paste folds the text to its summary', async ({ page }) => {
	await page.goto('/ajouter');
	// One card for the main path, its three steps, the box the third; nothing said about an empty box.
	await expect(page.getByRole('list', { name: 'Ajouter une fiche en trois étapes' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Copier les consignes pour l’IA' })).toBeVisible();
	await expect(page.getByText('Coller sa réponse ici')).toBeVisible();
	await expect(page.getByText('Aucune recette trouvée')).toHaveCount(0);
	// A web page is the second tab of the same card; typing it by hand, a link in the page head.
	await expect(page.getByRole('tab', { name: 'Une fiche en photo' })).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByLabel('Adresse de la page')).toHaveCount(0);
	await page.getByRole('tab', { name: 'Une page web' }).click();
	await expect(page.getByLabel('Adresse de la page')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Copier les consignes pour l’IA' })).toBeHidden();
	await page.getByRole('tab', { name: 'Une fiche en photo' }).click();
	await expect(page.getByLabel('Réponse de l’IA')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Taper à la main' })).toHaveAttribute('href', '/nouvelle');
	await page.evaluate((text) => {
		const data = new DataTransfer();
		data.setData('text/plain', text);
		document.querySelector('h1')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
	}, fenced('Galettes pliées inventées'));
	await expect(page.getByText('Valide')).toBeVisible();
	await expect(page.getByLabel('Réponse de l’IA')).toBeHidden();
	await expect(page.locator('.status')).toContainText('1 recette trouvée');
	await expect(page.locator('.status')).toContainText('1 ingrédient');
	await expect(page.locator('.status')).toContainText('2 étapes');
	// Step 1 is ticked only once the prompt was copied, shared or the AI opened: not here, and it says what to do.
	await expect(page.locator('.progress .done')).toHaveCount(2);
	await expect(page.locator('.progress li').first()).not.toHaveClass(/done/);
	await expect(page.locator('.progress li').first()).toContainText('Copier les consignes');
	await expect(page.locator('details.preview')).toHaveAttribute('open', '');
	await page.getByRole('button', { name: 'Modifier le texte' }).click();
	await expect(page.getByLabel('Réponse de l’IA')).toBeVisible();
	await expect(page.getByLabel('Réponse de l’IA')).toHaveValue(/Galettes pliées inventées/);
	await expect(page.getByLabel('Réponse de l’IA')).toBeFocused();
});

test('preview: a source with no type, and markers on servings and oven', async ({ page }) => {
	await page.goto('/ajouter');
	const text = fenced('Muffins sans provenance inventés', 'oven: { temp: "375 [?]", unit: F }\n')
		.replace('source: { type: invented }', 'source: { note: coupure de journal }')
		.replace('servings: 4', 'servings: "12 [?]"');
	await paste(page, text);
	await expect(page.getByText('Valide')).toBeVisible();
	const preview = page.locator('details.preview');
	await expect(preview.locator('.source')).toContainText('Type de source inconnu');
	await expect(preview.locator('.source')).toContainText('coupure de journal');
	await expect(preview.locator('.facts')).toContainText('12');
	await expect(preview.locator('.facts mark')).toHaveText(['[?]', '[?]']);
});

test('a slug collision is saved under the suffixed slug', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, fenced('Pâté chinois'));
	await expect(page.getByText('Une recette « pate-chinois » existe déjà.')).toBeVisible();
	await page.getByLabel('Enregistrer comme pate-chinois-2').check();
	await page.getByRole('button', { name: /Enregistrer/ }).click();
	await expect(page.getByTestId('saved-card').getByRole('link', { name: 'Voir la recette' })).toHaveAttribute('href', '/r/pate-chinois-2');
	await page.goto('/r/pate-chinois-2');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pâté chinois');
	// The original is untouched.
	await page.goto('/r/pate-chinois');
	await expect(page.locator('.source')).toContainText('tante Rita');
});

test('delete goes to the trash, restore brings it back', async ({ page }) => {
	await page.goto('/r/salade-de-chou');
	page.once('dialog', (d) => d.accept());
	await page.getByTestId('recipe-actions').click();
	await page.getByRole('button', { name: 'Supprimer' }).click();
	await expect(page).toHaveURL(/\/corbeille/);
	await expect(page.locator('.list')).toContainText('Salade de chou crémeuse');
	expect((await page.request.get('/r/salade-de-chou')).status()).toBe(404);
	await page.getByRole('button', { name: 'Restaurer' }).click();
	await expect(page.getByText('Recette restaurée.')).toBeVisible();
	await page.goto('/r/salade-de-chou');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Salade de chou crémeuse');
});

test('verify a recipe with no uncertain reading', async ({ page }) => {
	await page.goto('/r/crepes');
	// « Marquer vérifiée » sits beside the badge, in the keeper's line under the red rule.
	await page.locator('.status-act').getByRole('button', { name: 'Marquer vérifiée' }).click();
	await expect(page.getByText('Recette marquée vérifiée.')).toBeVisible();
	// Verified is the calm state: the keeper's line under the red rule says nothing more about it.
	await expect(page.locator('.upkeep .badge')).toHaveCount(0);
});

test('browse filters live in the URL and survive the back button', async ({ page }) => {
	await page.goto('/');
	// Étiquettes and Temps total start open; the other groups, Variantes among them, folded.
	await page.locator('.facets summary').filter({ hasText: /^Variantes$/ }).click();
	await page.locator('.facets').getByRole('link', { name: /Lasagnes aux courgettes/ }).click();
	await expect(page).toHaveURL(/famille=lasagna/);
	await expect(page.locator('.count')).toHaveText('3 recettes');
	await page.goBack();
	await expect(page.locator('.count')).not.toHaveText('3 recettes');
});

test('a writing request from another site is refused', async ({ request }) => {
	const res = await request.post('/api/save', {
		headers: { origin: 'http://evil.example', 'content-type': 'application/json' },
		data: { files: [{ text: 'x' }] }
	});
	expect(res.status()).toBe(403);
	const form = await request.post('/r/crepes?/remove', { headers: { origin: 'http://evil.example' }, form: { hash: 'x' } });
	expect(form.status()).toBe(403);
});

test('« Joindre la photo de la fiche » on a pasted card: the photo is on the recipe right after its save', async ({ page }) => {
	// Generated here, never a real picture.
	const jpg = await sharp({ create: { width: 240, height: 160, channels: 3, background: { r: 240, g: 230, b: 200 } } })
		.jpeg()
		.toBuffer();
	await page.goto('/ajouter');
	await paste(page, fenced('Galettes photographiées inventées'));
	await expect(page.getByText('Valide')).toBeVisible();
	await page.getByTestId('card-photo').locator('input[type=file]').setInputFiles({ name: 'fiche.jpg', mimeType: 'image/jpeg', buffer: jpg });
	await expect(page.getByTestId('card-photo')).toContainText('Photo jointe à l’enregistrement.');
	await page.keyboard.press('Control+Enter');
	await expect(page.getByTestId('saved-card')).toContainText('Recette enregistrée');
	await expect(page.locator('.toast')).toContainText('Photo de la fiche jointe.');
	await page.goto('/r/galettes-photographiees-inventees');
	await expect(page.locator('figure.photo img')).toBeVisible();
});

test('no clipboard here (plain http): « Copier les consignes pour l’IA » shows them, selected, to copy by hand', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
		document.execCommand = () => false;
	});
	await page.goto('/ajouter');
	await page.evaluate(() => localStorage.removeItem('recipevault:prompt-donne'));
	await page.getByRole('button', { name: 'Copier les consignes pour l’IA' }).click();
	await expect(page.getByText('Copie automatique impossible ici')).toBeVisible();
	const shown = page.getByRole('textbox', { name: 'Les consignes à donner à l’IA' });
	await expect(shown).toBeVisible();
	await expect(shown).toBeFocused();
	expect(await shown.evaluate((a: HTMLTextAreaElement) => a.selectionEnd - a.selectionStart)).toBeGreaterThan(100);
});

test('a resolved collision is said settled in its choice, not left as an error', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, fenced('Pâté chinois'));
	// Replace, then back: the clash is answered either way, never left in the errors.
	await page.getByLabel('Remplacer').check();
	await expect(page.getByTestId('collision-settled')).toContainText('remplacera');
	// An earlier test saved pate-chinois-2: the free name is the next one.
	await page.getByRole('radio', { name: /^Enregistrer comme pate-chinois-\d+$/ }).check();
	await expect(page.getByTestId('collision-settled')).toContainText(/pate-chinois-\d+/);
	await expect(page.locator('.diag.error')).toHaveCount(0);
});
