// One-tap fixes in the paste box (docs/VALIDATION.md, "Quick fixes"). Invented recipes only.
import { expect, test } from '@playwright/test';
import { file, paste } from './helpers';

const box = (page: import('@playwright/test').Page) => page.getByLabel('Réponse de l’IA');

test('E002: the line of the text, an excerpt, « Réaligner » and what to check next', async ({ page }) => {
	await page.goto('/ajouter');
	// Line 9 of the text: one space too far.
	await paste(page, file('Galette inventée', '', '      - { qty: 1, unit: cup, name: farine }\n       - { qty: 1 1/2 tasse, name: sucre }'));
	const error = page.locator('.diag.error .diag-item').first();
	await expect(error.locator('.sub .where')).toHaveText('Ligne 9 du texte');
	await expect(error.locator('.say')).toContainText('d’un espace de trop');
	await expect(error.getByTestId('excerpt')).toContainText('- { qty: 1 1/2 tasse, name: sucre }');
	await expect(error.getByTestId('excerpt')).toContainText('^');
	// The other problems a real read of the realigned text finds: listed now as rows « à revérifier », counted (E203 beside its E204 once).
	await expect(error.getByTestId('later')).toContainText('1 autre erreur');
	const recheck = page.locator('.diag.error .diag-item.recheck');
	await expect(recheck).toHaveCount(1);
	await expect(recheck).toContainText('à revérifier');
	// Its code only behind « Détails pour le dépannage », at the foot of the file.
	await expect(recheck).not.toContainText('E204');
	await expect(page.getByTestId('trouble')).toContainText('E204');
	await expect(page.locator('.diag.error').getByText('Erreurs (2)')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Corrigez 2 erreurs pour enregistrer' })).toBeVisible();

	await error.getByRole('button', { name: 'Montrer dans le texte' }).click();
	await expect(box(page)).toBeFocused();
	expect(await box(page).evaluate((b: HTMLTextAreaElement) => b.value.slice(b.selectionStart, b.selectionEnd))).toBe('- { qty: 1 1/2 tasse, name: sucre }');

	await error.getByRole('button', { name: 'Réaligner la ligne 9' }).click();
	await expect(box(page)).toHaveValue(/\n {6}- \{ qty: 1 1\/2 tasse, name: sucre \}\n/);
	// E204 now: split « 1 1/2 tasse » into a quantity and a unit; its E203 is not listed apart.
	await expect(page.locator('.diag.error .diag-item')).toHaveCount(1);
	await expect(page.locator('.diag.error').getByText('Erreurs (1)')).toBeVisible();
	await page.getByRole('button', { name: 'Séparer en 1 1/2 + tasse' }).click();
	await expect(box(page)).toHaveValue(/\{ qty: "1 1\/2", unit: cup, name: sucre \}/);
	await expect(page.getByText('Valide')).toBeVisible();
});

test('E002 and the row « à revérifier »: its fix realigns the line first, one tap for both', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, file('Galette inventée', '', '      - { qty: 1, unit: cup, name: farine }\n       - { qty: 1 1/2 tasse, name: sucre }'));
	await page.locator('.diag.error .diag-item.recheck').getByRole('button', { name: 'Séparer en 1 1/2 + tasse' }).click();
	await expect(box(page)).toHaveValue(/\n {6}- \{ qty: "1 1\/2", unit: cup, name: sucre \}\n/);
	await expect(page.getByText('Valide')).toBeVisible();
});

test('E210: an amount written in the name alone is taken out of it in one tap', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, file('Crème inventée', '', '      - { name: 500 ml de lait }'));
	await page.getByRole('button', { name: 'Séparer en 500 ml + lait' }).click();
	await expect(box(page)).toHaveValue(/\{ qty: 500, unit: ml, name: lait \}/);
	await expect(page.getByText('Valide')).toBeVisible();
});

test('E101 and E110: the title, prefilled from the first heading, and the version, one tap each', async ({ page }) => {
	await page.goto('/ajouter');
	const text = file('X', '', '      - { qty: 1, unit: cup, name: farine }')
		.replace('schema: 3\ntitle: X\n', '')
		.replace('## Préparation', '# Tarte inventée du dimanche\n\n## Préparation');
	await paste(page, text);
	const title = page.locator('form.title-fix');
	await expect(title.getByLabel('Titre :')).toHaveValue('Tarte inventée du dimanche');
	// Enter in the field adds it.
	await title.getByLabel('Titre :').press('Enter');
	await expect(box(page)).toHaveValue(/\ntitle: Tarte inventée du dimanche\n/);
	await page.getByRole('button', { name: 'Ajouter la version' }).click();
	await expect(box(page)).toHaveValue(/^---\nschema: 3\n/);
	await expect(page.getByText('Valide')).toBeVisible();
});

test('W401: bare step lines go under Préparation in one tap', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, file('Soupe inventée').replace('## Préparation\n\n1. Mélanger.\n2. Cuire 20 min.\n', '- Mélanger.\n- Cuire 20 min.\n'));
	// No step read: the remark and its fix open above the save, which says so.
	await expect(page.getByTestId('stepless')).toBeVisible();
	await expect(page.getByTestId('paste-save').getByRole('button', { name: /Enregistrer sans étapes/ })).toBeVisible();
	await page.getByTestId('stepless').getByRole('button', { name: 'Ranger ces 2 lignes dans Préparation' }).click();
	await expect(box(page)).toHaveValue(/\n## Préparation\n\n- Mélanger\.\n/);
	await expect(page.locator('.status')).toContainText('2 étapes');
	await expect(page.getByTestId('stepless')).toHaveCount(0);
});

test('W401: lines that look like steps but are not a list: the line named, one tap writes them as steps', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, file('Soupe inventée du midi').replace('## Préparation\n\n1. Mélanger.\n2. Cuire 20 min.\n', 'Étape 1 : Mélanger.\nÉtape 2 : Cuire 20 min.\n'));
	const stepless = page.getByTestId('stepless');
	await expect(stepless).toContainText('Aucune étape n’est lue');
	await expect(stepless).toContainText('Étape 1 : Mélanger.');
	await expect(stepless.locator('.sub .where')).toHaveText(/^Ligne \d+ du texte$/);
	await stepless.getByRole('button', { name: 'En faire 2 étapes' }).click();
	await expect(box(page)).toHaveValue(/\n## Préparation\n\n1\. Mélanger\.\n2\. Cuire 20 min\.\n/);
	await expect(page.locator('.status')).toContainText('2 étapes');
});

test('E207: a line left whole is read in one tap (« Lire comme »), all of them at once, and « Annuler » puts it back', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, file('Pain inventé au lait', '', '      - { qty: 2, unit: cup, name: farine }\n      - 1 1/2 tasse de lait\n      - 2 oeufs'));
	const errors = page.locator('.diag.error .diag-item');
	await expect(errors.first()).toContainText('cette ligne n’est pas découpée');
	await errors.first().getByRole('button', { name: 'Lire comme : 1 ½ tasse · lait' }).click();
	await expect(box(page)).toHaveValue(/\{ qty: "1 1\/2", unit: cup, name: lait \}/);
	// One line says the fixes made, its « Annuler la dernière » the undo (no toast over the save bar).
	await expect(page.getByTestId('fixes-line')).toContainText('1 correction faite');
	await page.getByTestId('fixes-line').getByRole('button', { name: 'Annuler la dernière' }).click();
	await expect(box(page)).toHaveValue(/\n {6}- 1 1\/2 tasse de lait\n/);
	await page.getByRole('button', { name: 'Lire les 2 lignes' }).click();
	await expect(box(page)).toHaveValue(/\{ qty: 2, unit: piece, name: oeufs \}/);
	await expect(page.getByText('Valide')).toBeVisible();
});

test('E106: one button per source type, its code and its name; one tap writes it', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, file('Galettes inventées du dimanche').replace('source: { type: invented }', 'source: { type: card }'));
	const error = page.locator('.diag.error .diag-item').first();
	await expect(error.locator('.say')).toContainText('Type de provenance «\u00a0card\u00a0» inconnu');
	await expect(error.getByRole('button', { name: /^Écrire / })).toHaveCount(6);
	await error.getByRole('button', { name: 'Écrire family (recette personnelle)' }).click();
	await expect(box(page)).toHaveValue(/source: \{ type: family \}/);
	await expect(page.getByTestId('fixes-line')).toContainText('Type de provenance écrit : family.');
	await expect(page.getByText('Valide')).toBeVisible();
});

test('E109: a time read one way only is written in one tap (« Écrire 40m »)', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, file('Pouding inventé du soir', 'times: { prep: 40 min }\n'));
	await page.locator('.diag.error').getByRole('button', { name: 'Écrire 40m' }).click();
	await expect(box(page)).toHaveValue(/times: \{ prep: 40m \}/);
	await expect(page.getByText('Valide')).toBeVisible();
});

test('W302: a preparation word in the name is moved out in one tap', async ({ page }) => {
	await page.goto('/ajouter');
	// « fondu » is in the seeded participle list (docs/VOCAB.md).
	await paste(page, file('Sauce inventée', '', '      - { qty: 2, unit: tbsp, name: beurre fondu }'));
	// Remarks are folded on a paste (open on a web import): open them first.
	await page.getByText(/^\d+ remarques?$/).click();
	await page.getByRole('button', { name: 'Séparer en beurre + fondu' }).click();
	await expect(box(page)).toHaveValue(/\{ qty: 2, unit: tbsp, name: beurre, prep: fondu \}/);
});

test('W401: no step read, the summary says how many lines wait outside Préparation', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, file('Soupe inventée du soir').replace('## Préparation\n\n1. Mélanger.\n2. Cuire 20 min.\n', '- Mélanger.\n- Cuire 20 min.\n- Servir.\n'));
	await expect(page.locator('.status')).toContainText('3 lignes hors Préparation');
	await expect(page.locator('.status')).not.toContainText('0 étape');
});

test('« Recommencer » empties the box, the ways in come back, « Annuler » puts it back', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, file('Tarte inventée à recommencer'));
	await page.reload();
	await expect(page.getByTestId('restart')).toContainText('Texte repris');
	await page.getByRole('button', { name: 'Modifier le texte' }).click();
	await expect(box(page)).toBeVisible();
	await expect(box(page)).toBeFocused();
	await page.getByTestId('restart').getByRole('button', { name: 'Recommencer' }).click();
	await expect(page.getByRole('tab', { name: 'Une fiche en photo' })).toBeVisible();
	await expect(box(page)).toHaveValue('');
	await page.locator('.toast').getByRole('button', { name: 'Annuler' }).click();
	await expect(box(page)).toHaveValue(/Tarte inventée à recommencer/);
});

test('a web import refused: « Voir les consignes » beside « Passer par l’IA » opens the page’s instructions, its address in them', async ({ page }) => {
	await page.route('**/api/import', (route) => route.fulfill({ status: 422, json: { error: 'Ce site refuse la lecture automatique.', kind: 'refused' } }));
	await page.goto('/ajouter');
	await page.getByRole('tab', { name: 'Une page web' }).click();
	await page.getByLabel('Adresse de la page').fill('https://example.invalid/tarte');
	await page.getByLabel('Adresse de la page').press('Enter');
	await expect(page.getByTestId('import-error')).toContainText('Cause probable : le site bloque les lecteurs automatiques');
	await page.getByTestId('import-error').getByRole('button', { name: 'Voir les consignes' }).click();
	// Still the web tab: the AI's steps for this page, its address kept and given for source.url.
	await expect(page.getByRole('tab', { name: 'Une page web' })).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByTestId('ai-page')).toContainText('https://example.invalid/tarte');
	const prompt = page.getByLabel('Les consignes à donner à l’IA').first();
	await expect(prompt).toBeVisible();
	await expect(prompt).toHaveValue(/url: https:\/\/example\.invalid\/tarte\n$/);
	await page.getByTestId('ai-page').getByRole('button', { name: 'Réessayer l’adresse' }).click();
	await expect(page.getByLabel('Adresse de la page')).toHaveValue('https://example.invalid/tarte');
});

test('a web import that fails: the reason stays under the field, plainly, with the ways that still work', async ({ page }) => {
	await page.route('**/api/import', (route) => route.fulfill({ status: 422, json: { error: 'Ce site refuse la lecture automatique.', kind: 'refused' } }));
	await page.goto('/ajouter');
	await page.getByRole('tab', { name: 'Une page web' }).click();
	const field = page.getByLabel('Adresse de la page');
	// No scheme typed, Enter: it is sent all the same.
	await field.fill('example.invalid/tarte');
	await field.press('Enter');
	const err = page.getByTestId('import-error');
	await expect(err).toContainText('Ce site refuse la lecture automatique.');
	await page.waitForTimeout(1500);
	await expect(err).toBeVisible();
	await expect(err.getByRole('link', { name: 'Taper à la main' })).toHaveAttribute('href', '/nouvelle');
	// A new address clears it; the address stays in the field after a refusal.
	await field.fill('https://example.invalid/autre');
	await expect(err).toHaveCount(0);
	await field.press('Enter');
	await expect(err).toBeVisible();
	await expect(field).toHaveValue('https://example.invalid/autre');
	// The AI way: the page's steps on the web tab (a capture or its text), not the card photo's.
	await err.getByRole('button', { name: /Passer par l’IA/ }).click();
	await expect(page.getByRole('tab', { name: 'Une page web' })).toHaveAttribute('aria-selected', 'true');
	await expect(page.locator('.lead-text')).toContainText('capture ou son texte');
	await expect(page.getByTestId('ai-page')).toContainText('https://example.invalid/autre');
});

test('a page read from the web: its own stepper, and an English page flagged', async ({ page }) => {
	await page.route('**/api/import', (route) =>
		route.fulfill({ json: { markdown: file('Invented pie', 'lang: en\n').replace('## Préparation', '## Instructions') } })
	);
	await page.goto('/ajouter');
	await page.getByRole('tab', { name: 'Une page web' }).click();
	await page.getByLabel('Adresse de la page').fill('https://example.invalid/pie');
	await page.getByRole('button', { name: 'Importer' }).click();
	await expect(page.locator('.progress li').first()).toContainText('Page lue');
	await expect(page.locator('.progress li')).toHaveCount(2);
	// The box holds the page's recipe, not an AI's answer: said so.
	await expect(page.getByLabel('Recette lue sur la page')).toHaveValue(/Invented pie/);
	const note = page.getByTestId('english-page');
	await expect(note).toContainText('Page en anglais');
	await expect(note).toContainText('Faire traduire par l’IA');
	// The save is not the main button here: the translation is.
	await expect(page.getByTestId('paste-save').getByRole('button', { name: /Enregistrer/ })).not.toHaveClass(/primary/);
	await note.getByRole('button', { name: 'Copier pour traduire' }).click();
	await expect(note.getByRole('button', { name: /Copié/ })).toBeVisible();
	const copied = await page.evaluate(() => navigator.clipboard.readText());
	expect(copied).toContain('title: Invented pie');
	expect(copied).toContain('lang: fr');
	// The AI's answer, pasted anywhere, takes the imported page's place; the stepper is the AI's again.
	await page.evaluate((text) => {
		const data = new DataTransfer();
		data.setData('text/plain', text);
		document.querySelector('h1')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
	}, file('Tarte traduite inventée'));
	await expect(box(page)).not.toHaveValue(/Invented pie/);
	await expect(page.getByTestId('english-page')).toHaveCount(0);
	await expect(page.locator('.progress .done')).toHaveCount(3);
});

test('a narrow screen: the box does not take the focus by itself (a keyboard would cover steps 1–2)', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/ajouter');
	await expect(box(page)).toBeVisible();
	await page.waitForTimeout(300);
	await expect(box(page)).not.toBeFocused();
});
