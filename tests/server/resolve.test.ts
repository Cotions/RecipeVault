import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../../src/lib/server/app';
import { browse, familyDiff } from '../../src/lib/server/index/query';
import { syncVault } from '../../src/lib/server/index/sync';
import { loadRecipePage } from '../../src/lib/server/pages';
import { serverCheck } from '../../src/lib/server/paste';
import { save } from '../../src/lib/server/save';
import { fixtureVault, type TempVault } from '../helpers/vault';

let v: TempVault;
beforeEach(async () => {
	v = await fixtureVault();
});
afterEach(() => v.cleanup());

type Row = { name: string; key: string; item: string | null; resolution: string; qty_s: string | null; to_taste: number; buy_instead: number };
const line = (slug: string, name: string) =>
	v.ctx.db.prepare('SELECT name, key, item, resolution, qty_s, to_taste, buy_instead FROM ingredients WHERE slug = ? AND name = ?').get(slug, name) as Row;
const app = () => ({ ctx: v.ctx }) as App;

const CELERI = `---
slug: celeri
category: legume
names:
  fr: [céleri]
  en: [celery]
substitutes: []
allergens: []
---
`;

describe('resolution in the index', () => {
	it('stores the lookup key, the item and how it was found', () => {
		expect(line('muffins-bleuets', 'œuf')).toMatchObject({ key: 'oeuf', item: 'oeuf', resolution: 'alias' });
		expect(line('muffins-bleuets', 'huile')).toMatchObject({ key: 'huile', item: null, resolution: 'ambiguous' });
		expect(line('soupe-aux-pois', 'carottes')).toMatchObject({ item: 'carotte', resolution: 'plural' });
		expect(line('tarte-au-sucre', 'pâte brisée')).toMatchObject({ item: null, resolution: 'recipe' });
		expect(line('soupe-aux-pois', 'sarriette [illisible]')).toMatchObject({ key: 'sarriette', resolution: 'none' });
		expect(line('muffins-bleuets', 'bleuets')).toMatchObject({ qty_s: '1', resolution: 'alias' });
		expect(v.ctx.db.prepare("SELECT name, key, resolution FROM ingredient_or WHERE slug = 'tarte-au-sucre' ORDER BY position").all()).toEqual([
			{ name: 'mélasse', key: 'melasse', resolution: 'none' },
			{ name: 'fécule de maïs', key: 'fecule de mais', resolution: 'none' }
		]);
	});

	it('re-resolves every row from its key when the registry changes, without reading a recipe file', () => {
		writeFileSync(join(v.dir, 'ingredients/celeri.md'), CELERI);
		const f = join(v.dir, 'ingredients/huile-vegetale.md');
		writeFileSync(f, readFileSync(f, 'utf8').replace('[huile végétale, huile]', '[huile végétale]'));
		const r = syncVault(v.ctx.db, v.ctx.paths);
		expect(r.indexed).toBe(0);
		expect(r.registry.changed).toBe(true);
		expect(line('bouillon-de-legumes', 'céleri')).toMatchObject({ item: 'celeri', resolution: 'alias' });
		expect(line('muffins-bleuets', 'huile')).toMatchObject({ item: 'huile-d-olive', resolution: 'alias' });
		// Sub-recipe lines are left alone.
		expect(line('tarte-au-sucre', 'pâte brisée')).toMatchObject({ resolution: 'recipe' });
	});

	it('the family table groups unresolved lines by key, then by item once resolved', () => {
		const before = familyDiff(v.ctx.db, 'lasagna')!;
		expect(before.common).toContain('feuilles de lasagne');
		expect(before.rows.find((x) => x.label === 'muscade')?.item).toBe('k:muscade');
		writeFileSync(join(v.dir, 'ingredients/muscade.md'), CELERI.replace('slug: celeri', 'slug: muscade').replace('[céleri]', '[muscade]').replace('[celery]', '[nutmeg]').replace('legume', 'epice'));
		syncVault(v.ctx.db, v.ctx.paths);
		expect(familyDiff(v.ctx.db, 'lasagna')!.rows.find((x) => x.label === 'muscade')?.item).toBe('muscade');
	});
});

describe('unresolved ingredients in the app', () => {
	it('browse filters and counts recipes with an unlinked ingredient', () => {
		const all = browse(v.ctx.db, {}).total;
		const r = browse(v.ctx.db, { unresolved: 'non', pageSize: 100 });
		expect(r.total).toBeGreaterThan(0);
		expect(r.total).toBeLessThan(all);
		expect(r.items.map((c) => c.slug)).toContain('muffins-bleuets');
		expect(r.items.map((c) => c.slug)).not.toContain('tarte-aux-pommes-grand-mere');
		expect(browse(v.ctx.db, {}).facets.unresolved).toEqual([{ value: 'non', count: r.total }]);
	});

	it('the recipe page lists them; the status stays as written', () => {
		const p = loadRecipePage(app(), 'muffins-bleuets')!;
		expect(p.recipe.status).toBe('verified');
		expect(p.unresolved.map((d) => [d.code, d.path])).toEqual([
			['W305', 'ingredients[0].items[2].name'],
			['W305', 'ingredients[0].items[5].name']
		]);
		expect(loadRecipePage(app(), 'tarte-aux-pommes-grand-mere')!.unresolved).toEqual([]);
	});

	it('the paste check and the save result carry W303 / W305 / W307; the status ignores them', async () => {
		const text = `---\nschema: 3\ntitle: Essai\ningredients:\n  - items:\n      - { qty: 1, unit: cup, name: farine }\n      - { qty: 1, unit: cup, name: xylophage }\n      - { qty: 1, unit: cup, name: sucre, item: sucre-de-lune }\nextracted_by: ai\n---\n\n## Préparation\n\n1. Mélanger.\n`;
		const codes = serverCheck(app(), [text])[0].diagnostics.map((d) => d.code);
		expect(codes).toContain('W303');
		expect(codes).toContain('W307');
		const r = await save(v.ctx, [{ text }]);
		const f = r.files[0];
		expect(f.status).toBe('saved');
		if (f.status !== 'saved') return;
		expect(f.recipeStatus).toBe('draft');
		expect(f.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['W303', 'W307']));
		expect(line('essai', 'sucre')).toMatchObject({ item: 'sucre-de-lune', resolution: 'override' });
	});
});
