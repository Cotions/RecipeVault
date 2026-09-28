import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../../src/lib/server/app';
import { costOfRecipe } from '../../src/lib/server/cost';
import { loadRecipePage } from '../../src/lib/server/pages';
import { appendPrice } from '../../src/lib/server/prices';
import { loadConversions } from '../../src/lib/server/vocab';
import { fixtureVault, type TempVault } from '../helpers/vault';

let v: TempVault;
let app: App;
beforeEach(async () => {
	v = await fixtureVault();
	app = { ctx: v.ctx, config: { locale: 'fr-CA' } } as App;
});
afterEach(() => v.cleanup());

const page = (slug: string) => loadRecipePage(app, slug)!;
const line = (slug: string, name: string) => page(slug).cost!.lines.find((l) => l.name === name)!;

describe('cost on the recipe page', () => {
	it('the worked example, from the vault: 800 g of tomatoes at 0,89 $ per 400 g', () => {
		const d = page('lasagna-bolognaise');
		expect(line('lasagna-bolognaise', 'tomates concassées')).toMatchObject({ item: 'tomates-concassees', counted: true, stale: false });
		expect(line('lasagna-bolognaise', 'tomates concassées').cost).toBeCloseTo(1.78, 10);
		expect(d.cost!.total).toBeCloseTo(1.78, 10);
		expect(d.cost!.perServing).toBeCloseTo(1.78 / 6, 10);
		expect(d.cost!.enough).toBe(false);
		expect(d.money).toEqual({ currency: 'CAD', locale: 'fr-CA' });
	});

	it('links each line: resolved to its entry, unresolved to its queue key', () => {
		const d = page('lasagna-bolognaise');
		const names = d.recipe.ingredients.flatMap((g) => g.items.map((i) => i.name));
		expect(d.links[names.indexOf('tomates concassées')]).toEqual({ item: 'tomates-concassees' });
		expect(d.links[names.indexOf('concentré de tomate')]).toEqual({ key: 'concentre de tomate' });
		expect(line('lasagna-bolognaise', 'concentré de tomate')).toMatchObject({ reason: 'unresolved', key: 'concentre de tomate' });
	});

	it('a price entered is in the next cost; a sub-recipe counts scaled by its yield', async () => {
		expect(line('tarte-aux-pommes-grand-mere', 'farine')).toMatchObject({ reason: 'no-price', via: 'Pâte brisée' });
		await appendPrice(v.ctx, { ingredient: 'farine', amount: 4.99, packQty: 2.5, packUnit: 'kg', date: '2026-09-27' });
		// Two crusts of a recipe that makes two: all of its 2 1/2 cups of flour.
		expect(line('tarte-aux-pommes-grand-mere', 'farine').cost).toBeCloseTo(((2.5 * 250 * 0.53) / 2500) * 4.99);
	});

	it('reads the resolved item from the index, so a new resolution needs no cost change', () => {
		const before = costOfRecipe(v.ctx.db, 'lasagna-epinards-ricotta', loadConversions(v.ctx.paths.vocab), '2026-09-27')!;
		const pos = before.lines.find((l) => l.name === 'épinards')!.position;
		v.ctx.db.prepare("UPDATE ingredients SET item = 'tomates-concassees', resolution = 'alias' WHERE slug = ? AND position = ?").run('lasagna-epinards-ricotta', pos);
		const after = costOfRecipe(v.ctx.db, 'lasagna-epinards-ricotta', loadConversions(v.ctx.paths.vocab), '2026-09-27')!;
		expect(before.lines.find((l) => l.name === 'épinards')).toMatchObject({ reason: 'unresolved' });
		expect(after.lines.find((l) => l.name === 'épinards')).toMatchObject({ item: 'tomates-concassees' });
		expect(after.lines.find((l) => l.name === 'épinards')!.reason).not.toBe('unresolved');
	});

	it('without vocab/conversions.yaml only same-unit prices work', async () => {
		await appendPrice(v.ctx, { ingredient: 'lait', amount: 5.2, packQty: 4, packUnit: 'l', date: '2026-09-27' });
		expect(line('crepes', 'lait').cost).toBeGreaterThan(0);
		rmSync(join(v.dir, 'vocab/conversions.yaml'));
		expect(line('crepes', 'lait').reason).toBe('no-conversion');
		expect(line('lasagna-bolognaise', 'tomates concassées').cost).toBeCloseTo(1.78);
	});

	it('a recipe that is not in the index has no cost', () => {
		expect(costOfRecipe(v.ctx.db, 'nexiste-pas', loadConversions(v.ctx.paths.vocab))).toBeUndefined();
	});
});
