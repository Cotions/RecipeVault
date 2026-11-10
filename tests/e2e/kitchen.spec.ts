import { expect, test } from '@playwright/test';

test('kitchen mode: checklist, steps by tap zones, timer, resume after reload', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise/cuisine');
	await expect(page.getByRole('heading', { name: 'Ingrédients' })).toBeVisible();
	await page.getByText('de bœuf haché').click();
	await expect(page.locator('li.ticked')).toHaveCount(1);

	await page.getByRole('button', { name: 'Commencer →' }).click();
	await expect(page.getByText('Étape 1 sur 7')).toBeVisible();

	// Right half of the step area: next. Left half: back. Tapped on the step
	// counter line, clear of the timer buttons in the step text.
	const tap = async (side: number) => {
		const stage = (await page.locator('.stage').boundingBox())!;
		const line = (await page.locator('.stage .count').boundingBox())!;
		await page.mouse.click(stage.x + stage.width * side, line.y + line.height / 2);
	};
	await tap(0.85);
	await expect(page.getByText('Étape 2 sur 7')).toBeVisible();
	await expect(page.locator('.step-ings')).toContainText('bœuf haché');
	// The step's ingredients sit over the instruction, as chips: no tab to flip to.
	expect((await page.locator('.for-step').boundingBox())!.y).toBeLessThan((await page.locator('.now').boundingBox())!.y);
	await tap(0.85);
	await expect(page.getByText('Étape 3 sur 7')).toBeVisible();
	await tap(0.15);
	await expect(page.getByText('Étape 2 sur 7')).toBeVisible();
	await page.getByRole('button', { name: /Étape suivante/ }).click();

	await page.getByRole('button', { name: '25 min', exact: true }).click();
	await expect(page.getByRole('timer')).toHaveText(/^2[45]:\d\d$/);

	// Servings rescale the step's ingredients too.
	await page.getByRole('button', { name: 'Plus de portions' }).click();
	await expect(page.locator('.step-ings')).toContainText('935 g de tomates concassées');

	await page.reload();
	await expect(page.getByText('Étape 3 sur 7')).toBeVisible();
	await expect(page.getByRole('timer')).toHaveText(/^2[45]:\d\d$/);
	await expect(page.locator('.scaler output')).toContainText('7');
	await page.getByRole('button', { name: '← Étape précédente' }).click();
	await page.getByRole('button', { name: '← Étape précédente' }).click();
	await page.getByRole('button', { name: /Ingrédients/ }).click();
	await expect(page.locator('li.ticked')).toHaveCount(1);
});

test('kitchen mode: a sub-recipe expands inline', async ({ page }) => {
	await page.goto('/r/tarte-aux-pommes-grand-mere/cuisine');
	await page.getByRole('button', { name: 'Voir la recette' }).click();
	await expect(page.locator('.sub')).toContainText('Pâte brisée');
	await expect(page.locator('.sub')).toContainText('graisse végétale');
});

test('kitchen mode: bullet steps are shown one at a time', async ({ page }) => {
	await page.goto('/r/feves-au-lard/cuisine');
	await page.getByRole('button', { name: 'Commencer →' }).click();
	await expect(page.getByText('Étape 1 sur 4')).toBeVisible();
	await expect(page.locator('.stage')).toContainText('Faire tremper les fèves');
	await page.getByRole('button', { name: /Étape suivante/ }).click();
	await expect(page.getByText('Étape 2 sur 4')).toBeVisible();
	await expect(page.locator('.stage')).toContainText('égoutter');
});

test('kitchen mode: Space on a focused button presses it; Alt+← is left to the browser', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise/cuisine');
	await page.getByRole('button', { name: 'Commencer →' }).click();
	await page.getByRole('button', { name: /Étape suivante/ }).click();
	await expect(page.getByText('Étape 2 sur 7')).toBeVisible();
	await page.keyboard.press('Space');
	await expect(page.getByText('Étape 3 sur 7')).toBeVisible();
	await page.getByRole('button', { name: '25 min', exact: true }).focus();
	await page.keyboard.press('Space');
	await expect(page.getByRole('timer')).toHaveText(/^2[45]:\d\d$/);
	await expect(page.getByText('Étape 3 sur 7')).toBeVisible();
	await page.getByRole('button', { name: 'Plus de portions' }).focus();
	await page.keyboard.press('Space');
	await expect(page.locator('.scaler output')).toContainText('7');
	await expect(page.getByText('Étape 3 sur 7')).toBeVisible();
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	const prevented = await page.evaluate(() => {
		const e = new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true });
		document.body.dispatchEvent(e);
		return e.defaultPrevented;
	});
	expect(prevented).toBe(false);
	await expect(page.getByText('Étape 3 sur 7')).toBeVisible();
});

test('kitchen mode: a timer counts down and rings; an idle page does not rewrite its session', async ({ page }) => {
	await page.clock.install();
	await page.goto('/r/lasagna-bolognaise/cuisine');
	await page.getByRole('button', { name: 'Commencer →' }).click();
	await page.getByRole('button', { name: /Étape suivante/ }).click();
	await page.getByRole('button', { name: /Étape suivante/ }).click();
	await page.getByRole('button', { name: '25 min', exact: true }).click();
	await expect(page.getByRole('timer')).toHaveText(/^2[45]:\d\d$/);
	await page.clock.runFor('10:00');
	await expect(page.getByRole('timer')).toHaveText(/^1[45]:\d\d$/);

	// Ticking twice a second, with nothing changed, writes nothing.
	await page.evaluate(() => {
		const w = window as unknown as { writes: number };
		w.writes = 0;
		const set = Storage.prototype.setItem;
		Storage.prototype.setItem = function (...a: [string, string]) {
			w.writes++;
			return set.apply(this, a);
		};
	});
	await page.clock.runFor(5000);
	expect(await page.evaluate(() => (window as unknown as { writes: number }).writes)).toBe(0);

	await page.clock.runFor('16:00');
	await expect(page.getByRole('timer')).toHaveText('Terminé');
	// On its own step the timer shows once, under the step: not in the strip too.
	await expect(page.locator('.steptimer.done')).toBeVisible();
	await expect(page.locator('.dock')).toHaveCount(0);
	const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rv-kitchen:lasagna-bolognaise')!));
	expect(saved.timers[0].done).toBe(true);
	// Pinned until stopped; the strip then goes: it is only for running timers.
	await page.clock.runFor('05:00');
	await expect(page.getByRole('timer')).toHaveText('Terminé');
	await page.locator('.steptimer').getByRole('button', { name: 'Arrêter' }).click();
	await expect(page.getByRole('timer')).toHaveCount(0);
	await expect(page.locator('.dock')).toHaveCount(0);
});

test('kitchen mode: the timer tip shows under a duration until the first timer, on two visits at most', async ({ page }) => {
	const tip = page.getByText('Touchez la durée pour lancer un minuteur');
	await page.goto('/r/lasagna-bolognaise/cuisine');
	await page.getByRole('button', { name: 'Commencer →' }).click();
	await expect(page.getByText('Étape 1 sur 7')).toBeVisible();
	await page.getByRole('button', { name: /Étape suivante/ }).click();
	await page.getByRole('button', { name: /Étape suivante/ }).click();
	await expect(page.getByText('Étape 3 sur 7')).toBeVisible();
	// No strip kept free at the bottom: the tip is a caption under the step.
	await expect(tip).toBeVisible();
	await expect(page.locator('.dock')).toHaveCount(0);
	const at = (await page.locator('.now').boundingBox())!.y;
	const pagerAt = (await page.locator('.pager').boundingBox())!.y;
	await page.getByRole('button', { name: '25 min', exact: true }).click();
	await expect(page.getByRole('timer')).toHaveText(/^2[45]:\d\d$/);
	await expect(tip).toHaveCount(0);
	// The step's own timer shows once, large under the step with its controls — no strip
	// repeating it: the pager does not move. The step may scroll, after her tap, just enough
	// to show the timer's « Arrêter » in the pane (PLANNING.md, kitchen).
	await expect(page.locator('.dock')).toHaveCount(0);
	expect((await page.locator('.pager').boundingBox())!.y).toBe(pagerAt);
	await expect(async () => {
		const stop = (await page.locator('.steptimer').getByRole('button', { name: 'Arrêter' }).boundingBox())!;
		expect(stop.y + stop.height).toBeLessThanOrEqual(pagerAt + 1);
	}).toPass();
	await expect(page.locator('.steptimer')).toBeVisible();
	expect((await page.locator('.steptimer').boundingBox())!.y).toBeGreaterThan(at);
	// Seen from the next step, it is a row of the strip over the pager, with its pause and stop.
	await page.getByRole('button', { name: /Étape suivante/ }).click();
	const dock = (await page.locator('.dock').boundingBox())!;
	expect(dock.y + dock.height).toBeLessThanOrEqual(pagerAt + 1);
	await expect(page.locator('.dock .tm')).toContainText('Étape 3');
	await page.locator('.dock').getByRole('button', { name: 'Arrêter · Étape 3' }).click();
	await expect(page.locator('.dock')).toHaveCount(0);
	await page.getByRole('button', { name: /Étape précédente|Précédente/ }).click();
	await expect(page.locator('.steptimer')).toHaveCount(0);
	await page.reload();
	await expect(page.getByText('Étape 3 sur 7')).toBeVisible();
	await expect(tip).toHaveCount(0);

	// Never started a timer: two visits, then no more.
	await page.evaluate(() => localStorage.clear());
	await page.reload();
	await page.getByRole('button', { name: 'Commencer →' }).click();
	await page.getByRole('button', { name: /Étape suivante/ }).click();
	await page.getByRole('button', { name: /Étape suivante/ }).click();
	await expect(tip).toBeVisible();
	await page.reload();
	await expect(page.getByText('Étape 3 sur 7')).toBeVisible();
	await expect(tip).toBeVisible();
	await page.reload();
	await expect(page.getByText('Étape 3 sur 7')).toBeVisible();
	await expect(tip).toHaveCount(0);
});

test('kitchen mode: when the screen cannot stay on, it asks again on the first tap, then says so only in the header', async ({ page }) => {
	await page.addInitScript(() => {
		const w = window as unknown as { wakeTries: number };
		w.wakeTries = 0;
		Object.defineProperty(navigator, 'wakeLock', {
			configurable: true,
			value: {
				request: () => {
					w.wakeTries++;
					return Promise.reject(new Error('refused'));
				}
			}
		});
	});
	const tries = () => page.evaluate(() => (window as unknown as { wakeTries: number }).wakeTries);
	await page.goto('/r/lasagna-bolognaise/cuisine');
	const note = page.locator('.wake-note');
	const sun = page.getByLabel('L’écran peut s’éteindre · Réactiver', { exact: true });
	await expect(page.getByRole('heading', { name: 'Ingrédients' })).toBeVisible();
	await expect.poll(tries).toBe(1);
	// One refusal says nothing yet: some browsers wait for a tap.
	await expect(note).toHaveCount(0);
	await expect(sun).toHaveCount(0);
	await page.locator('.ingredients li label').first().click();
	await expect(page.locator('li.ticked')).toHaveCount(1);
	await expect.poll(tries).toBeGreaterThanOrEqual(2);
	// Refused again: the crossed-out sun in the header says so — and nothing else (no second note at the bottom).
	await expect(sun).toBeVisible();
	await expect(note).toHaveCount(0);
	await expect(page.getByText('touchez-le parfois')).toHaveCount(0);
	// The reason is behind the sun.
	await expect(page.getByText(/a refusé de garder l’écran allumé/)).toBeHidden();
	await sun.click();
	await expect(page.getByText(/a refusé de garder l’écran allumé/)).toBeVisible();
	await page.keyboard.press('Escape');
	// After a reload: the sun again, still alone.
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Ingrédients' })).toBeVisible();
	await page.locator('.ingredients li label').nth(1).click();
	await expect(sun).toBeVisible();
	await expect(note).toHaveCount(0);
});

test('kitchen mode: the step text size, from the ⋯ menu, is kept on the device', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise/cuisine');
	await page.getByRole('button', { name: 'Commencer →' }).click();
	const size = () => page.locator('.now').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
	const before = await size();
	await page.getByLabel('Plus d’options').click();
	await page.getByRole('button', { name: 'Texte plus grand' }).click();
	await page.getByRole('button', { name: 'Texte plus grand' }).click();
	await expect(page.locator('.sizer output')).toContainText('130');
	const after = await size();
	expect(after).toBeGreaterThan(before * 1.25);
	await page.reload();
	await expect(page.getByText('Étape 1 sur 7')).toBeVisible();
	expect(await size()).toBeCloseTo(after, 0);
	await page.getByLabel('Plus d’options').click();
	await page.getByRole('button', { name: 'Texte plus petit' }).click();
	await expect(page.locator('.sizer output')).toContainText('115');
});

test('kitchen mode: a timer pauses, resumes and takes one more minute', async ({ page }) => {
	await page.clock.install();
	await page.goto('/r/lasagna-bolognaise/cuisine');
	await page.getByRole('button', { name: 'Commencer →' }).click();
	await page.getByRole('button', { name: /Étape suivante/ }).click();
	await page.getByRole('button', { name: /Étape suivante/ }).click();
	await page.getByRole('button', { name: '25 min', exact: true }).click();
	// Its controls are under the step, beside its time: no chip to open first.
	await page.locator('.steptimer').getByRole('button', { name: 'Pause' }).click();
	await expect(page.locator('.steptimer .tlabel')).toContainText('En pause');
	await page.clock.runFor('10:00');
	await expect(page.getByRole('timer')).toHaveText(/^2[45]:\d\d$/);
	await page.getByRole('button', { name: 'Reprendre' }).click();
	await page.getByRole('button', { name: '+1 min' }).click();
	await expect(page.getByRole('timer')).toHaveText(/^2[56]:\d\d$/);
	// A finished timer's « +1 min » starts a fresh minute.
	await page.clock.runFor('27:00');
	await expect(page.getByRole('timer')).toHaveText('Terminé');
	await page.getByRole('button', { name: '+1 min' }).click();
	await expect(page.getByRole('timer')).toHaveText(/^[01]:\d\d$/);
});

test('kitchen mode: the last step finishes with « Terminé ✓ »', async ({ page }) => {
	await page.goto('/r/feves-au-lard/cuisine');
	await page.getByRole('button', { name: 'Commencer →' }).click();
	for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /Étape suivante/ }).click();
	await expect(page.getByText('Étape 4 sur 4')).toBeVisible();
	await expect(page.getByRole('button', { name: /Étape suivante/ })).toHaveCount(0);
	await page.getByRole('button', { name: 'Terminé ✓' }).click();
	await expect(page.getByText('Bon appétit !')).toBeVisible();
	await expect(page).toHaveURL(/\/r\/feves-au-lard$/, { timeout: 10_000 });
});

test.describe('on a phone-sized screen', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('kitchen mode: a step that names more than the list matches says so and offers the whole list', async ({ page }) => {
		await page.goto('/r/muffins-bleuets/cuisine');
		await page.getByRole('button', { name: 'Commencer →' }).click();
		await expect(page.getByText('Étape 1 sur 4')).toBeVisible();
		// « les ingrédients secs »: no partial list, the whole one a tap away.
		await expect(page.locator('.step-ings')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Tous les ingrédients →' })).toBeVisible();
		await page.getByRole('button', { name: /Étape suivante/ }).click();
		// What it could match, labelled for what it is.
		await expect(page.locator('.for-label')).toHaveText('Mentionnés');
		await expect(page.locator('.step-ings')).toContainText('lait');
		await page.getByRole('button', { name: 'Tous les ingrédients →' }).click();
		await expect(page.getByRole('heading', { name: 'Ingrédients' })).toBeVisible();
		await page.getByRole('tab', { name: /Étapes/ }).click();
		await expect(page.getByText('Étape 2 sur 4')).toBeVisible();
		await page.getByRole('button', { name: /Étape suivante/ }).click();
		await expect(page.locator('.for-label')).toHaveText('Pour cette étape');
		await expect(page.locator('.step-ings')).toContainText('bleuets');
	});

	test('kitchen mode: running timers are one compact row, each tied to its step', async ({ page }) => {
		await page.goto('/r/lasagna-bolognaise/cuisine');
		// The whole checklist row ticks: 44 px at least.
		expect((await page.locator('.ingredients li label').first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
		await page.getByRole('button', { name: 'Commencer →' }).click();
		await page.getByRole('button', { name: /Étape suivante/ }).click();
		await page.getByRole('button', { name: /Étape suivante/ }).click();
		await page.getByRole('button', { name: '25 min', exact: true }).click();
		for (let i = 0; i < 4; i++) await page.getByRole('button', { name: /Étape suivante/ }).click();
		await expect(page.getByText('Étape 7 sur 7')).toBeVisible();
		await page.getByRole('button', { name: '45 min', exact: true }).click();
		// Two timers, each shown once: step 7's under its text, step 3's in the strip — every row
		// inside the screen, its digits large; the step text ends above it.
		await expect(page.getByRole('timer')).toHaveCount(2);
		await expect(page.locator('.dock .tm')).toHaveCount(1);
		const dock = (await page.locator('.dock').boundingBox())!;
		expect(dock.height).toBeLessThan(110);
		for (const chip of await page.locator('.dock .tm').all()) {
			const b = (await chip.boundingBox())!;
			expect(b.x + b.width).toBeLessThanOrEqual(page.viewportSize()!.width);
		}
		expect(await page.locator('.dock .clock').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(24);
		for (const name of ['Pause · Étape 3', 'Arrêter · Étape 3']) {
			const b = (await page.locator('.dock').getByRole('button', { name }).boundingBox())!;
			expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
		}
		const now = (await page.locator('.now').boundingBox())!;
		expect(now.y + now.height).toBeLessThanOrEqual(dock.y);
		// Step 3's timer, seen from step 7, says so (« Étape 3 · 12:30 »), and the step goes back there.
		await expect(page.locator('.dock .tm').first()).toContainText('Étape 3');
		await page.getByRole('button', { name: /Aller à l’étape 3/ }).click();
		await expect(page.getByText('Étape 3 sur 7')).toBeVisible();
		// On its own step, the timer is under the step: no way back to offer.
		await expect(page.getByRole('button', { name: /Aller à l’étape 3/ })).toHaveCount(0);
		await expect(page.locator('.steptimer')).toHaveCount(1);
		await expect(page.getByRole('button', { name: /Aller à l’étape 7/ })).toBeVisible();
	});

	test('kitchen mode: the scale note is one line, on step 1 and on steps with a time or the oven', async ({ page }) => {
		await page.goto('/r/lasagna-bolognaise/cuisine?portions=8');
		await page.getByRole('button', { name: 'Commencer →' }).click();
		await expect(page.locator('.scale-notice')).toHaveText(/^× \S.* · temps et four inchangés$/);
		expect((await page.locator('.scale-notice').boundingBox())!.height).toBeLessThan(30);
		await page.getByRole('button', { name: /Étape suivante/ }).click();
		await expect(page.getByText('Étape 2 sur 7')).toBeVisible();
		await expect(page.locator('.scale-notice')).toHaveCount(0);
		// « Laisser réduire 25 min »: a time, so the note again.
		await page.getByRole('button', { name: /Étape suivante/ }).click();
		await expect(page.locator('.scale-notice')).toHaveCount(1);
	});

	test('kitchen mode: a swipe moves between steps', async ({ page }) => {
		await page.goto('/r/lasagna-bolognaise/cuisine');
		await page.getByRole('button', { name: 'Commencer →' }).click();
		await expect(page.getByText('Étape 1 sur 7')).toBeVisible();
		const swipe = async (from: number, to: number) => {
			const stage = (await page.locator('.stage').boundingBox())!;
			const y = (await page.locator('.stage .count').boundingBox())!.y + 10;
			await page.mouse.move(stage.x + stage.width * from, y);
			await page.mouse.down();
			await page.mouse.move(stage.x + stage.width * to, y + 8, { steps: 6 });
			await page.mouse.up();
		};
		await swipe(0.8, 0.2);
		await expect(page.getByText('Étape 2 sur 7')).toBeVisible();
		await swipe(0.2, 0.8);
		await expect(page.getByText('Étape 1 sur 7')).toBeVisible();
	});
});

test.describe('on a wide screen', () => {
	test.use({ viewport: { width: 1280, height: 800 } });

	test('kitchen mode: checklist and steps side by side, no « Commencer » gate', async ({ page }) => {
		await page.goto('/r/lasagna-bolognaise/cuisine');
		await expect(page.getByRole('heading', { name: 'Ingrédients' })).toBeVisible();
		await expect(page.getByText('Étape 1 sur 7')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Commencer →' })).toBeHidden();
		await expect(page.getByRole('tab', { name: /Étapes/ })).toBeHidden();
		// Step 1: nothing before it, so « Étape suivante » has the whole row.
		await expect(page.getByRole('button', { name: '← Étape précédente' })).toHaveCount(0);
		const pager = (await page.locator('.pager').boundingBox())!;
		expect((await page.getByRole('button', { name: /Étape suivante/ }).boundingBox())!.width).toBeGreaterThan(pager.width * 0.8);
		await page.locator('.ingredients li label').first().click();
		await page.getByRole('button', { name: /Étape suivante/ }).click();
		await expect(page.getByText('Étape 2 sur 7')).toBeVisible();
		await expect(page.getByRole('button', { name: '← Étape précédente' })).toBeVisible();
		// The list beside the step marks what the step uses: no « Pour cette étape » box.
		await expect(page.locator('.ingredients li.here').filter({ hasText: 'bœuf haché' })).toHaveCount(1);
		await expect(page.locator('.step-ings')).toHaveCount(0);
		await page.reload();
		await expect(page.getByText('Étape 2 sur 7')).toBeVisible();
		await expect(page.locator('li.ticked')).toHaveCount(1);
	});

	test('kitchen mode: a step the list may not fully match marks nothing in the list', async ({ page }) => {
		await page.goto('/r/muffins-bleuets/cuisine');
		await page.getByRole('button', { name: /Étape suivante/ }).click();
		await expect(page.getByText('Étape 2 sur 4')).toBeVisible();
		// « les ingrédients secs »: a partial mark, the rest dimmed, would mislead.
		await expect(page.locator('.ingredients li.here')).toHaveCount(0);
		await expect(page.locator('.ingredients li.dim')).toHaveCount(0);
		await page.getByRole('button', { name: /Étape suivante/ }).click();
		await expect(page.locator('.ingredients li.here').filter({ hasText: 'bleuets' })).toHaveCount(1);
	});

	test('kitchen mode: a running timer sits in the steps column, clear of the checklist', async ({ page }) => {
		await page.goto('/r/lasagna-bolognaise/cuisine');
		await page.getByRole('button', { name: /Étape suivante/ }).click();
		await page.getByRole('button', { name: /Étape suivante/ }).click();
		await page.getByRole('button', { name: '25 min', exact: true }).click();
		// On its step it is under the text; from the next step, a row of the strip in the steps column.
		await expect(page.locator('.dock')).toHaveCount(0);
		await page.getByRole('button', { name: /Étape suivante/ }).click();
		const dock = (await page.locator('.dock').boundingBox())!;
		const list = (await page.locator('.ingredients').boundingBox())!;
		expect(dock.x).toBeGreaterThanOrEqual(list.x + list.width - 1);
		await expect(page.locator('.dock').getByRole('button', { name: 'Arrêter · Étape 3' })).toBeVisible();
	});

	test('kitchen mode: the checklist folds to a rail, remembered on the device', async ({ page }) => {
		await page.goto('/r/lasagna-bolognaise/cuisine');
		await page.getByRole('button', { name: /Étape suivante/ }).click();
		await page.getByRole('button', { name: 'Replier les ingrédients' }).click();
		await expect(page.getByRole('heading', { name: 'Ingrédients' })).toBeHidden();
		const rail = page.getByRole('button', { name: /^Ingrédients \(\d+\)/ });
		await expect(rail).toBeFocused();
		// The list is folded away: the step shows its own ingredients again.
		await expect(page.locator('.step-ings')).toContainText('bœuf haché');
		await page.reload();
		await expect(rail).toBeVisible();
		await rail.click();
		await expect(page.getByRole('heading', { name: 'Ingrédients' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Replier les ingrédients' })).toBeFocused();
	});
});

test('kitchen mode: a step timer just started shows its « Arrêter » in the pane, never cut off by the timer strip', async ({ page }) => {
	await page.goto('/r/lasagna-bolognaise/cuisine');
	// The largest text: the step fills the pane, so the new readout lands at its foot.
	await page.evaluate(() => localStorage.setItem('rv-kitchen-text', '1.5'));
	await page.reload();
	await page.getByRole('button', { name: 'Commencer →' }).click();
	await page.getByRole('button', { name: /Étape suivante/ }).click();
	await page.getByRole('button', { name: /Étape suivante/ }).click();
	await page.getByRole('button', { name: '25 min', exact: true }).click();
	const stop = page.locator('.steptimer .bigstop');
	await expect(stop).toBeVisible();
	await expect
		.poll(async () => {
			const s = await page.locator('.stage').boundingBox();
			const b = await stop.boundingBox();
			return !!s && !!b && b.y + b.height <= s.y + s.height;
		})
		.toBe(true);
});
