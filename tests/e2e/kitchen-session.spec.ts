// Kitchen mode sessions and offline use (review fixes). Invented fixture vault.
import { expect, test } from '@playwright/test';

test('the recipe page amount wins over an old session, and a reload keeps the kitchen one', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise/cuisine');
	await page.getByRole('button', { name: 'Plus de portions' }).click();
	await page.getByRole('button', { name: 'Plus de portions' }).click();
	await expect(page.locator('.scaler output')).toContainText('8');

	await page.goto('/r/lasagna-bolognaise');
	await page.getByRole('link', { name: 'Cuisiner' }).click();
	await expect(page.locator('.kitchen')).toBeVisible();
	await expect(page.locator('.scaler output')).toContainText('6');
	await expect(page).toHaveURL(/\/cuisine$/);

	await page.getByRole('button', { name: 'Plus de portions' }).click();
	await page.reload();
	await expect(page.locator('.scaler output')).toContainText('7');
});

test('an old or finished session is not resumed; Recommencer starts over', async ({ page }) => {
	await page.goto('/r/crepes/cuisine');
	await page.locator('li label').first().click();
	await expect(page.locator('li.ticked')).toHaveCount(1);
	// Make the session 13 hours old.
	await page.evaluate(() => {
		const s = JSON.parse(localStorage.getItem('rv-kitchen:crepes')!);
		localStorage.setItem('rv-kitchen:crepes', JSON.stringify({ ...s, at: Date.now() - 13 * 3600 * 1000 }));
	});
	await page.reload();
	await expect(page.locator('li.ticked')).toHaveCount(0);

	// Another recipe file: ticks by position must not land on other items.
	await page.locator('li label').first().click();
	await page.evaluate(() => {
		const s = JSON.parse(localStorage.getItem('rv-kitchen:crepes')!);
		localStorage.setItem('rv-kitchen:crepes', JSON.stringify({ ...s, v: 'other' }));
	});
	await page.reload();
	await expect(page.locator('li.ticked')).toHaveCount(0);

	// The last step's button is « Terminé ✓ »: « Bon appétit », then back to the
	// recipe by itself; the finished session is not resumed.
	await page.locator('li label').first().click();
	await page.getByRole('button', { name: 'Commencer →' }).click();
	while (await page.getByRole('button', { name: /Étape suivante/ }).isVisible()) await page.getByRole('button', { name: /Étape suivante/ }).click();
	await page.getByRole('button', { name: 'Terminé ✓' }).click();
	await expect(page.getByText('Bon appétit !')).toBeVisible();
	await expect(page).toHaveURL(/\/r\/crepes$/, { timeout: 10_000 });
	await page.goto('/r/crepes/cuisine');
	await expect(page.getByRole('heading', { name: 'Ingrédients' })).toBeVisible();
	await expect(page.locator('li.ticked')).toHaveCount(0);

	// « Recommencer » on the « Bon appétit » screen stays in kitchen mode.
	await page.getByRole('button', { name: 'Commencer →' }).click();
	while (await page.getByRole('button', { name: /Étape suivante/ }).isVisible()) await page.getByRole('button', { name: /Étape suivante/ }).click();
	await page.getByRole('button', { name: 'Terminé ✓' }).click();
	await page.getByRole('button', { name: 'Recommencer' }).click();
	await expect(page.getByRole('heading', { name: 'Ingrédients' })).toBeVisible();
	await page.waitForTimeout(3500);
	await expect(page).toHaveURL(/\/r\/crepes\/cuisine$/);
});

test('kitchen mode entered from the recipe page reloads offline', async ({ page, context }) => {
	await page.goto('/r/pizza-maison');
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
		if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
	});
	await page.getByRole('link', { name: 'Cuisiner' }).click();
	await expect(page).toHaveURL(/\/r\/pizza-maison\/cuisine/);
	await expect(page.locator('.kitchen')).toBeVisible();
	await expect
		.poll(() => page.evaluate(async () => !!(await caches.match('/r/pizza-maison/cuisine', { ignoreSearch: true, ignoreVary: true }))))
		.toBe(true);

	await context.setOffline(true);
	try {
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Ingrédients' })).toBeVisible();
		await expect(page.locator('.ingredients .dish')).toContainText('Pizza maison');
		// Offline for real: a page never opened in kitchen mode is not there.
		const other = await page.evaluate(() => fetch('/r/soupe-aux-pois').then(() => 'fetched', () => 'failed'));
		expect(other).toBe('failed');
	} finally {
		await context.setOffline(false);
	}
});

test('a resumed session says where it is, for a few seconds, with « Recommencer »', async ({ page }) => {
	await page.clock.install();
	await page.goto('/r/lasagna-bolognaise/cuisine');
	await page.getByRole('button', { name: 'Commencer →' }).click();
	await page.getByRole('button', { name: /Étape suivante/ }).click();
	await page.getByRole('button', { name: /Étape suivante/ }).click();
	await expect(page.getByText('Étape 3 sur 7')).toBeVisible();
	// Any reload: one small line under the step header says where she is and for how many —
	// in the flow, nothing over the step.
	await page.reload();
	await expect(page.getByText('Étape 3 sur 7')).toBeVisible();
	const line = page.locator('.resumed');
	await expect(line).toContainText('Repris à l’étape 3');
	await expect(line).toContainText('portions');
	await expect(page.locator('.toast')).toHaveCount(0);
	const head = (await page.locator('.stage .count').boundingBox())!;
	const box = (await line.boundingBox())!;
	expect(box.y).toBeGreaterThan(head.y);
	expect(box.y).toBeLessThan((await page.locator('.now').boundingBox())!.y);
	expect(box.height).toBeLessThan(50);
	// It fades by itself after about 5 s, and the step does not move when it does.
	const at = (await page.locator('.now').boundingBox())!.y;
	await page.clock.runFor(6000);
	await expect(line).toBeHidden();
	expect((await page.locator('.now').boundingBox())!.y).toBe(at);
	// Five hours later (still within the 12 h a session lasts): the same line, and « Recommencer » from it.
	await page.evaluate(() => {
		const s = JSON.parse(localStorage.getItem('rv-kitchen:lasagna-bolognaise')!);
		localStorage.setItem('rv-kitchen:lasagna-bolognaise', JSON.stringify({ ...s, at: Date.now() - 5 * 3600 * 1000 }));
	});
	await page.reload();
	await expect(line).toContainText('Repris à l’étape 3');
	await line.getByRole('button', { name: 'Recommencer' }).click();
	await expect(page.getByRole('heading', { name: 'Ingrédients' })).toBeVisible();
	await expect(line).toHaveCount(0);
	// What it did, said (usability round 4); the steps' tab still counts out of the total.
	await expect(page.locator('.restarted')).toHaveText('Cuisine recommencée');
	await expect(page.getByRole('tab', { name: /Étapes/ })).toContainText('0/7');
	// Twice is the same fresh cook.
	await page.locator('header details.more summary').click();
	await page.locator('header details.more').getByRole('button', { name: 'Recommencer' }).click();
	await expect(page.locator('.restarted')).toHaveText('Cuisine recommencée');
	await expect(page.getByRole('tab', { name: /Étapes/ })).toContainText('0/7');
});

test('« Reprendre » from a page she rescaled carries her amount; the step, ticks and timers go on (Q1 A, round 4)', async ({ page }) => {
	// A cook at 8 portions, at step 3, a box ticked and a timer on.
	await page.goto('/r/lasagna-bolognaise/cuisine?portions=8');
	await page.locator('li label').first().click();
	await page.getByRole('button', { name: 'Commencer →' }).click();
	await page.getByRole('button', { name: /Étape suivante/ }).click();
	await page.getByRole('button', { name: /Étape suivante/ }).click();
	await page.getByRole('button', { name: '25 min', exact: true }).click();
	await expect(page.getByText('Étape 3 sur 7')).toBeVisible();

	// The recipe page, untouched: the session's amount, named on the button.
	await page.goto('/r/lasagna-bolognaise');
	const cook = page.getByTestId('cook');
	await expect(cook).toHaveText('Reprendre · étape 3 · 8 portions');
	await expect(cook).toHaveAttribute('href', '/r/lasagna-bolognaise/cuisine');

	// She sets 10 here: the button says 10 and kitchen mode opens at 10, where she was.
	await page.getByRole('button', { name: 'Plus de portions' }).first().click();
	await page.getByRole('button', { name: 'Plus de portions' }).first().click();
	await page.getByRole('button', { name: 'Plus de portions' }).first().click();
	await page.getByRole('button', { name: 'Plus de portions' }).first().click();
	await expect(page).toHaveURL(/\?portions=10$/);
	await expect(cook).toHaveText('Reprendre · étape 3 · 10 portions');
	await expect(cook).toHaveAttribute('href', '/r/lasagna-bolognaise/cuisine?portions=10');
	await cook.click();
	await expect(page.getByText('Étape 3 sur 7')).toBeVisible();
	await expect(page.locator('.scaler output')).toContainText('10');
	await expect(page.locator('.resumed')).toContainText('Repris à l’étape 3 · 10 portions (avant : 8)');
	await expect(page.getByRole('timer').first()).toHaveText(/^2[45]:\d\d$/);
	await expect(page.getByRole('tab', { name: /Ingrédients/ })).toContainText('1/');
});

test('a timer that finished before this visit says so, with « Relancer » and « Effacer » (round 4)', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise/cuisine?etape=3');
	await page.getByRole('button', { name: '25 min', exact: true }).click();
	await expect(page.getByRole('timer').first()).toBeVisible();
	await page.evaluate(() => {
		const s = JSON.parse(localStorage.getItem('rv-kitchen:lasagna-bolognaise')!);
		s.timers = s.timers.map((x: { end: number }) => ({ ...x, end: Date.now() - 12 * 60_000 }));
		localStorage.setItem('rv-kitchen:lasagna-bolognaise', JSON.stringify(s));
	});
	await page.reload();
	await expect(page.locator('.steptimer')).toContainText('Minuteur terminé il y a 12 min');
	// Said once, under its step: not in the strip too.
	await expect(page.locator('.dock')).toHaveCount(0);
	await page.locator('.steptimer').getByRole('button', { name: 'Relancer' }).click();
	await expect(page.getByRole('timer').first()).toHaveText(/^2[45]:\d\d$/);
	await expect(page.locator('.steptimer.away')).toHaveCount(0);
});
