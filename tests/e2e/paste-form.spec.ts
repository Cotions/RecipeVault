import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { fenced, paste } from './helpers';

// "Relire et modifier": a pasted file opened in the recipe form on the paste
// page, saved from there, on the desktop, a phone and a tablet (the phone and
// tablet projects match `form.spec`). The projects share one vault, so every
// title here is the project's own.

const VAULT = '/tmp/rv-e2e/vault';
const read = (slug: string) => readFileSync(`${VAULT}/recipes/${slug}.md`, 'utf8');

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

test('a pasted recipe edited in the form: saved from there, the others stay in the box', async ({ page }) => {
	const first = title('Galettes relues');
	const second = title('Biscuits restants');
	await page.goto('/ajouter');
	await paste(page, fenced(first) + '\n' + fenced(second));
	await expect(page.getByText('2 recettes trouvées')).toBeVisible();

	await page.getByRole('region', { name: first }).getByTestId('edit-in-form').click();
	await expect(page).toHaveURL(/\/ajouter\?recette=1$/);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Relire la recette');
	await expect(page.getByTestId('title')).toHaveValue(first);
	const row = page.getByTestId('item-row').first();
	await expect(row.getByTestId('qty').first()).toHaveValue('1');
	await expect(row.getByTestId('name').first()).toHaveValue('farine');

	await row.getByTestId('qty').first().fill('2');
	await row.getByTestId('name').first().fill('farine tout usage');
	await page.getByTestId('save').click();

	// Back among the pasted recipes: the one saved has left the box, the toast links it.
	await expect(page).toHaveURL(/\/ajouter$/);
	await expect(page.getByTestId('toast')).toContainText('Recette enregistrée.');
	await expect(page.getByTestId('toast').getByRole('link', { name: first })).toHaveAttribute('href', `/r/${slugOf(first)}`);
	await expect(page.getByText('1 recette trouvée')).toBeVisible();
	await expect(page.getByLabel('Réponse de l’IA')).toHaveValue(new RegExp(second));
	await expect(page.getByLabel('Réponse de l’IA')).not.toHaveValue(new RegExp(first));
	const saved = read(slugOf(first));
	expect(saved).toContain('{ qty: 2, unit: cup, name: farine tout usage }');
	// Still the AI's transcription, never verified by an edit.
	expect(saved).toContain('extracted_by: ai');
	expect(saved).toContain('status: draft');

	// The last one: saved unchanged, the recipe page, and the box is empty next time.
	await page.getByRole('region', { name: second }).getByTestId('edit-in-form').click();
	await page.getByTestId('save').click();
	await expect(page).toHaveURL(`/r/${slugOf(second)}`);
	await expect(page.getByTestId('toast')).toContainText('Recette enregistrée.');
	await page.goto('/ajouter');
	await expect(page.getByLabel('Réponse de l’IA')).toHaveValue('');
});

test('back from the form keeps the paste; the edit waits as a draft', async ({ page }) => {
	const name = title('Tarte à reprendre');
	await page.goto('/ajouter');
	await paste(page, fenced(name));
	await page.getByTestId('edit-in-form').click();
	await page.getByTestId('title').fill(`${name} corrigée`);
	// Past the autosave's pause.
	await page.waitForTimeout(600);
	await page.getByTestId('back-to-paste').click();

	await expect(page).toHaveURL(/\/ajouter$/);
	await expect(page.getByLabel('Réponse de l’IA')).toHaveValue(new RegExp(name));
	await page.getByTestId('edit-in-form').click();
	await expect(page.getByTestId('draft-banner')).toBeVisible();
	await expect(page.getByTestId('title')).toHaveValue(name);
	await page.getByRole('button', { name: 'Reprendre le brouillon' }).click();
	await expect(page.getByTestId('title')).toHaveValue(`${name} corrigée`);

	// Starting over from the pasted text forgets the draft.
	await page.goBack();
	await page.getByTestId('edit-in-form').click();
	await page.getByRole('button', { name: 'Repartir du texte collé' }).click();
	await expect(page.getByTestId('title')).toHaveValue(name);
});

test('a reload keeps the paste, and the form it had open', async ({ page }) => {
	const name = title('Pouding gardé');
	await page.goto('/ajouter');
	await paste(page, fenced(name));
	await page.reload();
	await expect(page.getByLabel('Réponse de l’IA')).toHaveValue(new RegExp(name));
	await page.getByTestId('edit-in-form').click();
	await page.reload();
	await expect(page.getByTestId('title')).toHaveValue(name);
	// Emptied, the box is forgotten too.
	await page.getByTestId('back-to-paste').click();
	await page.getByLabel('Réponse de l’IA').fill('');
	await page.reload();
	await expect(page.getByLabel('Réponse de l’IA')).toHaveValue('');
});

test('a file with errors does not open in the form; it says to ask the AI', async ({ page }) => {
	await page.goto('/ajouter');
	await paste(page, fenced(title('Biscuits brisés'), '', '      - { qty: 1, unit: tasse, name: farine }'));
	await expect(page.getByText('À corriger')).toBeVisible();
	await expect(page.getByTestId('edit-in-form')).toHaveCount(0);
	await expect(page.getByTestId('edit-blocked')).toContainText('Copier la demande de correction');
	// An address naming it opens the list, not the form.
	await page.goto('/ajouter?recette=1');
	await expect(page).toHaveURL(/\/ajouter$/);
	await expect(page.getByTestId('edit-blocked')).toBeVisible();
});
