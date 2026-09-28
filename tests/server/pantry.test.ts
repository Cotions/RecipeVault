// Pantry search over the index (plan 03, Phase 7): needs built from
// `ingredients.item`, `ingredient_or` and sub-recipes, cached until the index changes.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pantryQuery } from '../../src/lib/server/index/pantry';
import { syncVault } from '../../src/lib/server/index/sync';
import { fixtureVault, recipe, type TempVault } from '../helpers/vault';

let v: TempVault;
beforeEach(async () => {
	v = await fixtureVault();
});
afterEach(() => v.cleanup());

const find = (slug: string, q: Parameters<typeof pantryQuery>[1]) => pantryQuery(v.ctx.db, q).find((r) => r.slug === slug);

describe('pantryQuery', () => {
	it('"œufs, farine, lait": the crêpes are ready (salt assumed, butter to taste, the syrup group optional)', () => {
		const r = pantryQuery(v.ctx.db, { have: ['oeuf', 'farine', 'lait'] });
		const crepes = r.find((x) => x.slug === 'crepes')!;
		expect(crepes).toMatchObject({ tier: 'pret', required: 3, matched: 3, used: 3, missing: [] });
		expect(r[0].tier).toBe('pret');
	});

	it('the staples off, the salt is missing', () => {
		expect(find('crepes', { have: ['oeuf', 'farine', 'lait'], assumeStaples: false })).toMatchObject({ tier: 'presque', missing: [['sel']] });
	});

	it('an `or` choice from the index meets the line', () => {
		writeFileSync(
			join(v.dir, 'recipes/galettes.md'),
			recipe('Galettes', 'slug: galettes\n').replace('name: farine }', 'name: cassonade }\n      - { qty: 1, unit: cup, name: margarine, or: [lait] }')
		);
		syncVault(v.ctx.db, v.ctx.paths);
		expect(find('galettes', { have: ['cassonade', 'lait'], assumeStaples: false })).toMatchObject({ tier: 'pret', required: 2 });
		expect(find('galettes', { have: ['cassonade'], assumeStaples: false })).toMatchObject({ missing: [['margarine', 'lait']] });
	});

	it('a sub-recipe is flattened; with `buy_instead`, a registry entry of its slug meets it instead', () => {
		const q = { have: ['pomme', 'cannelle'] };
		// pate-brisee: flour, salt and water are staples; "graisse végétale" is not in the registry.
		expect(find('tarte-aux-pommes-grand-mere', q)).toMatchObject({ tier: 'pret', required: 2, unresolved: 1 });
		writeFileSync(
			join(v.dir, 'ingredients/pate-brisee.md'),
			'---\nslug: pate-brisee\ncategory: surgele\nnames:\n  fr: [pâte brisée du commerce]\ndefault_unit: piece\nstaple: false\nsubstitutes: []\nallergens: [gluten]\n---\n'
		);
		syncVault(v.ctx.db, v.ctx.paths);
		const bought = { have: ['pomme', 'cannelle', 'pate-brisee'] };
		expect(find('tarte-aux-pommes-grand-mere', bought)).toMatchObject({ tier: 'pret', required: 3, matched: 3, used: 3, unresolved: 0 });
		// Not `buy_instead`: the streusel pie still makes its own crust.
		expect(find('tarte-aux-pommes-streusel', bought)?.unresolved ?? 1).toBeGreaterThan(0);
	});

	it('avoiding an allergen leaves out every recipe using an entry that carries it', () => {
		const all = pantryQuery(v.ctx.db, { have: ['farine'] });
		const noEgg = pantryQuery(v.ctx.db, { have: ['farine'], allergens: ['oeuf'] });
		expect(all.some((r) => r.slug === 'crepes')).toBe(true);
		expect(noEgg.some((r) => r.slug === 'crepes')).toBe(false);
		expect(noEgg.length).toBeLessThan(all.length);
	});

	it('a new recipe is found after a sync: the model follows the index', () => {
		expect(find('pain-dore', { have: ['oeuf', 'lait'] })).toBeUndefined();
		writeFileSync(join(v.dir, 'recipes/pain-dore.md'), recipe('Pain doré', 'slug: pain-dore\n').replace('name: farine }', 'name: œufs }'));
		syncVault(v.ctx.db, v.ctx.paths);
		expect(find('pain-dore', { have: ['oeuf', 'lait'] })).toMatchObject({ tier: 'pret' });
	});
});
