// Kitchen mode, round 2: the cook chip on other pages, the screen-awake
// indicator, range timers with their check, « Recommencer » and its confirm,
// the checklist's tap target. Invented fixture vault (pouding-chomeur's
// step 5 is « Cuire 35 à 40 minutes »).
import { expect, test } from '@playwright/test';
import { FIXTURE_USERS } from '../../scripts/fixture-vault';

const STEP5 = '/r/pouding-chomeur/cuisine?etape=5';

test('a range runs to its upper bound and says « vérifier » at the lower one', async ({ page }) => {
	await page.clock.install();
	await page.goto(STEP5);
	await expect(page.getByText(/Étape 5 sur/)).toBeVisible();
	// `?etape=` is dropped from the address once read.
	await expect(page).toHaveURL(/\/cuisine$/);
	await page.getByRole('button', { name: /35 à 40/ }).click();
	await expect(page.getByRole('timer')).toHaveText(/^(40:00|39:\d\d)$/);
	// On its own step: under the step text only, its range beside the time.
	await expect(page.locator('.steptimer .tlabel')).toContainText('35–40');
	await expect(page.locator('.dock')).toHaveCount(0);
	await page.clock.runFor('35:01');
	await expect(page.locator('.steptimer.check')).toBeVisible();
	await expect(page.locator('.steptimer .tcheck')).toHaveText('35 min : vérifier la cuisson');
	await page.clock.runFor('05:00');
	await expect(page.getByRole('timer')).toHaveText('Terminé');
	await expect(page.locator('.steptimer.check')).toHaveCount(0);
});

test('a running timer follows her to other pages as a chip that leads back to its step', async ({ page }) => {
	await page.goto(STEP5);
	await page.getByRole('button', { name: /35 à 40/ }).click();
	await expect(page.getByRole('timer')).toBeVisible();
	// Not inside kitchen mode itself.
	await expect(page.getByTestId('cook-chip')).toHaveCount(0);

	await page.locator('a.quit').click();
	await expect(page).toHaveURL(/\/r\/pouding-chomeur(\?.*)?$/);
	const chip = page.getByTestId('cook-chip');
	await expect(chip).toBeVisible();
	await expect(chip).toContainText('Pouding chômeur');
	await expect(chip.getByRole('timer')).toHaveText(/^\d{1,2}:\d\d$/);
	await expect(chip.getByRole('link')).toHaveAttribute('href', '/r/pouding-chomeur/cuisine?etape=5');

	// On every page, in the header's flow.
	await page.goto('/');
	await expect(chip).toBeVisible();
	await chip.getByRole('link').click();
	await expect(page.getByText(/Étape 5 sur/)).toBeVisible();
	await expect(page.getByTestId('cook-chip')).toHaveCount(0);
});

test('the header says when the screen is kept on, and lets it sleep', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'wakeLock', {
			configurable: true,
			value: {
				request: () =>
					Promise.resolve({
						released: false,
						release() {
							this.released = true;
							return Promise.resolve();
						},
						addEventListener() {}
					})
			}
		});
	});
	await page.goto('/r/lasagna-bolognaise/cuisine');
	const wake = page.locator('button.wake');
	await expect(wake).toHaveAttribute('aria-pressed', 'true');
	await expect(wake).toContainText('Écran allumé');
	await wake.click();
	await expect(wake).toHaveAttribute('aria-pressed', 'false');
	await expect(wake).toContainText('Garder allumé');
	await wake.click();
	await expect(wake).toHaveAttribute('aria-pressed', 'true');
});

test('« Recommencer » in the ⋯ menu asks first while a timer runs', async ({ page }) => {
	await page.goto(STEP5);
	await page.getByRole('button', { name: /35 à 40/ }).click();
	// Not beside the step count: the step area is a tap zone (PLANNING.md, kitchen mode).
	await expect(page.locator('.stage').getByRole('button', { name: 'Recommencer' })).toHaveCount(0);
	const restart = async () => {
		await page.locator('header details.more summary').click();
		await page.locator('header details.more').getByRole('button', { name: 'Recommencer' }).click();
	};
	await restart();
	const confirm = page.locator('.confirm');
	await expect(confirm).toContainText('Un minuteur en marche');
	await confirm.getByRole('button', { name: 'Annuler' }).click();
	await expect(confirm).toHaveCount(0);
	await expect(page.getByRole('timer')).toBeVisible();
	await restart();
	await confirm.getByRole('button', { name: 'Recommencer quand même' }).click();
	await expect(page.getByRole('heading', { name: 'Ingrédients' })).toBeVisible();
	await expect(page.getByRole('timer')).toHaveCount(0);
	await expect(page.locator('li.ticked')).toHaveCount(0);
});

test('a checklist row is a large target with a visible box', async ({ page }) => {
	await page.goto('/r/pouding-chomeur/cuisine');
	const box = (await page.locator('.ingredients li input[type="checkbox"]').first().boundingBox())!;
	expect(box.width).toBeGreaterThanOrEqual(47.5);
	expect(box.height).toBeGreaterThanOrEqual(47.5);
	const row = (await page.locator('.ingredients li label').first().boundingBox())!;
	expect(row.height).toBeGreaterThanOrEqual(47.5);
});

// Round 3: two recipes on the go, a rung timer put away, sign-out.

test('another recipe’s timer shows in the dock and leads to its kitchen; « +1 » lists both elsewhere', async ({ page }) => {
	await page.goto(STEP5);
	await page.getByRole('button', { name: /35 à 40/ }).click();
	await expect(page.getByRole('timer')).toBeVisible();
	await page.goto('/r/lasagna-bolognaise/cuisine?etape=3');
	await expect(page.getByText('Étape 3 sur 7')).toBeVisible();
	const other = page.locator('.dock .tm.other a');
	await expect(other).toContainText('Pouding chômeur');
	await expect(other).toHaveAttribute('href', '/r/pouding-chomeur/cuisine?etape=5');
	await page.getByRole('button', { name: '25 min', exact: true }).click();
	// This recipe's own timer is under its step, not in the strip; the other recipe's stays there.
	await expect(page.locator('.steptimer')).toHaveCount(1);
	await expect(page.locator('.dock .tm:not(.other)')).toHaveCount(0);
	await expect(other).toBeVisible();

	await page.goto('/');
	const chip = page.getByTestId('cook-chip');
	await expect(chip).toBeVisible();
	const more = chip.locator('details.others');
	await expect(more.locator('summary')).toHaveText('+1');
	await more.locator('summary').click();
	const list = more.getByRole('link');
	await expect(list).toHaveCount(2);
	// Inside the viewport, over nothing it should not be.
	const box = (await more.locator('.others-panel').boundingBox())!;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
	await page.keyboard.press('Escape');
	await expect(more).not.toHaveAttribute('open', '');
	// Each cook has « × Terminer » (round 4): that session goes, the other stays.
	await more.locator('summary').click();
	await more.getByRole('button', { name: /Terminer la cuisson — Pouding chômeur/ }).click();
	await expect(chip.locator('details.others')).toHaveCount(0);
	expect(await page.evaluate(() => localStorage.getItem('rv-kitchen:pouding-chomeur'))).toBeNull();
	await expect(chip).toBeVisible();
});

test('a rung timer’s chip pulses, then rests, and its × puts it away', async ({ page }) => {
	await page.clock.install();
	await page.goto('/r/lasagna-bolognaise/cuisine?etape=3');
	await page.getByRole('button', { name: '25 min', exact: true }).click();
	await page.locator('a.quit').click();
	const chip = page.getByTestId('cook-chip');
	await expect(chip).toBeVisible();
	await page.clock.runFor('25:01');
	await expect(chip).toHaveClass(/ring/);
	await expect(chip).toHaveClass(/pulse/);
	await page.clock.runFor(31_000);
	await expect(chip).not.toHaveClass(/pulse/);
	await chip.getByRole('button', { name: /Masquer « Terminé »/ }).click();
	await expect(chip).toHaveCount(0);
	const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rv-kitchen:lasagna-bolognaise')!));
	expect(saved.timers[0].seen).toBe(true);
	// Seen stays seen; the step left to resume is not offered on the recipe's own page.
	await page.reload();
	await expect(page.getByTestId('cook-chip')).toHaveCount(0);
});

test.describe('signed in on this test only', () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test('signing out clears the kitchen sessions and the chip', async ({ page }) => {
		const { cook } = FIXTURE_USERS;
		await page.goto('/connexion');
		await page.getByLabel('Identifiant').fill(cook.login);
		await page.getByLabel('Mot de passe').fill(cook.password);
		await page.getByRole('button', { name: 'Se connecter' }).click();
		await expect(page.locator('header .who')).toHaveText(cook.name);
		await page.goto(STEP5);
		await page.getByRole('button', { name: /35 à 40/ }).click();
		await page.locator('a.quit').click();
		await expect(page.getByTestId('cook-chip')).toBeVisible();
		await page.getByTestId('more').click();
		await page.getByRole('button', { name: 'Se déconnecter' }).click();
		await expect(page.getByRole('link', { name: 'Se connecter' })).toBeVisible();
		await expect(page.getByTestId('cook-chip')).toHaveCount(0);
		expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('rv-kitchen:')))).toEqual([]);
	});
});
