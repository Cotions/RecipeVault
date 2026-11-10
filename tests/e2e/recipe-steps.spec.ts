import { expect, test } from '@playwright/test';

test('steps show as bullets; the numbered choice is kept on the device, in print too', async ({ page }) => {
	// Written with `-` bullets; lasagna-bolognaise is written numbered.
	await page.goto('/r/feves-au-lard');
	const steps = page.locator('.method .steps > li');
	await expect(steps).toHaveCount(4);
	await expect(page.locator('.method ul.steps')).toHaveCount(1);
	await expect(page.locator('.method ol')).toHaveCount(0);
	// Author and type, nothing else: no dangling dash after the name.
	await expect(page.locator('.source')).toHaveText(/Mémère Alma\s*$/);

	await page.goto('/r/lasagna-bolognaise');
	await expect(page.locator('.method ol.steps')).toHaveCount(0);
	// Both choices in sight, « Puces » pressed by default; « Numéros » numbers them.
	const style = page.getByRole('group', { name: 'Présentation des étapes' });
	const bullets = style.getByRole('button', { name: 'Puces' });
	const numbers = style.getByRole('button', { name: 'Numéros' });
	await expect(bullets).toHaveAttribute('aria-pressed', 'true');
	await numbers.click();
	await expect(numbers).toHaveAttribute('aria-pressed', 'true');
	await expect(bullets).toHaveAttribute('aria-pressed', 'false');
	await expect(page.locator('.method ol.steps').first()).toBeVisible();
	await expect(page.locator('.method .steps > li').first()).toHaveAttribute('value', '1');

	await page.goto('/r/feves-au-lard');
	await expect(numbers).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('.method ol.steps > li')).toHaveCount(4);
	await expect(page.locator('.method .steps > li').last()).toHaveAttribute('value', '4');
	await page.emulateMedia({ media: 'print' });
	await expect(page.locator('.step-style')).toBeHidden();
	await expect(page.locator('.method ol.steps')).toBeVisible();
	await page.emulateMedia({ media: 'screen' });

	await bullets.click();
	await page.reload();
	await expect(page.locator('.method ul.steps > li')).toHaveCount(4);
	await expect(bullets).toHaveAttribute('aria-pressed', 'true');
});

test('ingredients tick off for the session: the box or the row’s plain text, not an amount', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise');
	const rows = page.locator('.ingredients li');
	const first = rows.first();
	await expect(page.getByRole('button', { name: 'Tout décocher' })).toHaveCount(0);
	await first.getByRole('checkbox').check();
	await expect(first).toHaveClass(/\bdone\b/);
	// An amount still scales: it opens « J'en ai … » and ticks nothing.
	const second = rows.nth(1);
	await second.getByRole('button').first().click();
	await expect(page.locator('form.ask')).toBeVisible();
	await expect(second).not.toHaveClass(/\bdone\b/);
	await page.locator('form.ask').getByRole('button', { name: 'Annuler' }).click();
	// Kept on reload (this tab), gone with « Tout décocher ».
	await page.reload();
	await expect(rows.first()).toHaveClass(/\bdone\b/);
	await expect(page.locator('.ticks')).toContainText('1 ingrédient coché');
	await page.getByRole('button', { name: 'Tout décocher' }).click();
	await expect(page.locator('.ingredients li.done')).toHaveCount(0);
	// Never printed.
	await first.getByRole('checkbox').check();
	await page.emulateMedia({ media: 'print' });
	await expect(first.getByRole('checkbox')).toBeHidden();
	await expect(first.locator('.line')).toHaveCSS('text-decoration-line', 'none');
	await page.emulateMedia({ media: 'screen' });
	await page.getByRole('button', { name: 'Tout décocher' }).click();
});

test('a line is one tick target: its name ticks it, its link is after it', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise');
	const row = page.locator('.ingredients li').filter({ hasText: 'tomates concassées' });
	await expect(row).toBeVisible();
	expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
	await row.locator('.name').click();
	await expect(row).toHaveClass(/\bdone\b/);
	await expect(page).toHaveURL(/\/r\/lasagna-bolognaise$/);
	await row.locator('.name').click();
	await expect(row).not.toHaveClass(/\bdone\b/);
	await expect(row.locator('a.go.item')).toHaveAttribute('href', '/ingredients/tomates-concassees');
});

test('a phone keeps « Ingrédients | Préparation » at the top, the section in view marked', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/r/lasagna-bolognaise');
	const bar = page.getByTestId('jumpbar');
	await expect(bar.getByRole('link', { name: 'Ingrédients' })).toHaveAttribute('aria-current', 'location');
	await bar.getByRole('link', { name: 'Préparation' }).click();
	await expect(page.locator('#preparation')).toBeInViewport();
	await expect(bar).toBeInViewport();
	await expect(bar.getByRole('link', { name: 'Préparation' })).toHaveAttribute('aria-current', 'location');
	await bar.getByRole('link', { name: 'Ingrédients' }).click();
	await expect(page.locator('#ingredients-title')).toBeInViewport();
	await expect(bar.getByRole('link', { name: 'Ingrédients' })).toHaveAttribute('aria-current', 'location');
	// Two columns: both in sight, no bar.
	await page.setViewportSize({ width: 1366, height: 900 });
	await expect(bar).toBeHidden();
});

test('the keeper sees what the review state means, and settles it in one click when nothing is uncertain', async ({ page }) => {
	await page.goto('/r/lasagna-courgettes');
	// One quiet line under the red rule, the keeper's only (usability round 3).
	const upkeep = page.locator('.upkeep');
	await expect(upkeep.locator('.badge')).toHaveText('Brouillon');
	// Short (usability round 6): « Brouillon · pas encore relue contre la fiche · Marquer vérifiée », the button's words never in the sentence.
	await expect(upkeep.locator('.status-why')).toHaveText('pas encore relue contre la fiche');
	await expect(upkeep.locator('.status-why')).not.toContainText('Marquer vérifiée');
	await expect(upkeep.getByRole('button', { name: 'Marquer vérifiée' })).toBeVisible();
	// An uncertain reading: said, and no button until it is settled.
	await page.goto('/r/soupe-aux-pois');
	await expect(upkeep.locator('.badge')).toHaveText('À relire');
	await expect(upkeep.locator('.status-why')).toHaveText('lectures incertaines à vérifier sur l’original');
	await expect(upkeep.getByRole('button', { name: 'Marquer vérifiée' })).toHaveCount(0);
	// A draft with no card behind it (invented source, no photo) says so; its status stays « draft ».
	await page.goto('/r/sauce-tomate-maison');
	await expect(upkeep.locator('.badge')).toHaveText('Saisie sans fiche d’origine');
	await expect(upkeep.locator('.status-why')).toHaveText('pas encore relue');
});

test('a new tag at the foot is one line to act on; the code waits behind « Détails » (usability round 6)', async ({ page }) => {
	// The fixture's pending `cabane-a-sucre` (etiquettes.spec.ts leaves it alone).
	await page.goto('/r/tarte-au-sucre');
	const vocab = page.getByTestId('vocab');
	const row = vocab.locator('li', { hasText: 'Étiquette nouvelle : cabane-a-sucre' });
	await expect(row.getByRole('link', { name: 'Décider dans Étiquettes ›' })).toHaveAttribute('href', '/etiquettes');
	// No file name or code in sight until « Détails » opens.
	await expect(vocab.getByText('vocab/tags.yaml')).toBeHidden();
	await expect(vocab.getByText('W501')).toBeHidden();
	await vocab.getByText('Détails', { exact: true }).click();
	await expect(vocab.getByText('W501').first()).toBeVisible();
});

test('[+] reads as an « ajouté » chip, explained in the legend', async ({ page }) => {
	// « 2. Piler les patates avec le beurre et le lait. [+] »
	await page.goto('/r/pate-chinois');
	const added = page.locator('.method mark.mk-added');
	await expect(added.first()).toHaveText('ajouté');
	await expect(added.first()).toHaveAttribute('title', /Ajouté à la transcription/);
	await expect(page.locator('.legend')).toContainText('absent de l’original, ajouté à la transcription');
});
