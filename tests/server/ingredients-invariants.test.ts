// Plan 03, "Done when": two invariants across every P1.5 operation.
// - No recipe file is written by resolution, queue actions, price entry,
//   ingredient edits, cost or pantry search (docs/STORAGE.md, "Ingredient
//   resolution is not stored in recipe files").
// - Deleting cache/ and restarting loses nothing: the index is derived from
//   the files (docs/DATA-FLOW.md).

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openVault } from '../../src/lib/server/context';
import { costOfRecipe } from '../../src/lib/server/cost';
import { addAlias, editEntry, ingredientView, mergeEntry } from '../../src/lib/server/ingredient';
import { ingredientIndex } from '../../src/lib/server/ingredients';
import { pantryQuery } from '../../src/lib/server/index/pantry';
import { forgetResolver } from '../../src/lib/server/index/resolve';
import { syncVault } from '../../src/lib/server/index/sync';
import { appendPrice } from '../../src/lib/server/prices';
import { createFromKey, linkKey, resolveQueue } from '../../src/lib/server/queue';
import { loadConversions, loadVocab } from '../../src/lib/server/vocab';
import { AUTHOR, fixtureVault, type TempVault } from '../helpers/vault';

let v: TempVault;
beforeEach(async () => {
	v = await fixtureVault();
});
afterEach(() => v.cleanup());

const TODAY = '2026-09-27';
const vocab = () => loadVocab(v.ctx.paths.vocab);
const hashOf = (slug: string) => v.ctx.db.prepare('SELECT file_hash FROM registry WHERE slug = ?').pluck().get(slug) as string;
const slugs = () => v.ctx.db.prepare('SELECT slug FROM recipes ORDER BY slug').pluck().all() as string[];

/** Every recipe file: content hash and modification time (a rewrite with the same bytes still shows). */
function recipeFiles(): Record<string, string> {
	const dir = join(v.dir, 'recipes');
	return Object.fromEntries(
		readdirSync(dir)
			.sort()
			.map((f) => [f, `${createHash('sha256').update(readFileSync(join(dir, f))).digest('hex')} ${statSync(join(dir, f)).mtimeMs}`])
	);
}

/** Every P1.5 action the app offers, one after the other. */
async function everyAction(): Promise<void> {
	syncVault(v.ctx.db, v.ctx.paths, { force: true });
	const q = resolveQueue(v.ctx.db, vocab(), { limit: 100 }).rows;
	const plain = q.filter((r) => !r.ambiguous);
	expect(plain.length).toBeGreaterThanOrEqual(2);
	await linkKey(v.ctx, plain[0].key, 'sucre');
	await createFromKey(v.ctx, plain[1].key, { slug: 'ingredient-invente', category: 'epicerie', staple: false });
	await appendPrice(v.ctx, { ingredient: 'farine', amount: 4.99, packQty: 2.5, packUnit: 'kg', shop: 'Épicerie inventée', date: TODAY });
	await addAlias(v.ctx, 'sel', hashOf('sel'), 'fr', 'sel de table inventé');
	const e = ingredientView(v.ctx.db, 'sel', vocab())!.entry;
	await editEntry(v.ctx, 'sel', hashOf('sel'), {
		names: e.names,
		category: e.category,
		defaultUnit: e.defaultUnit ?? '',
		staple: e.staple,
		auGout: e.auGout,
		density: '1.2',
		weights: [],
		substitutes: e.substitutes,
		allergens: e.allergens
	});
	await mergeEntry(v.ctx, 'margarine', 'beurre', hashOf('margarine'), hashOf('beurre'));
	const conv = loadConversions(v.ctx.paths.vocab);
	for (const s of slugs()) costOfRecipe(v.ctx.db, s, conv, TODAY);
	pantryQuery(v.ctx.db, { have: ['oeuf', 'farine', 'lait'] });
	ingredientIndex(v.ctx.db, {}, TODAY);
}

describe('no recipe file is written', () => {
	it('by resolution, queue actions, price entry, ingredient edits, cost or pantry search', async () => {
		const before = recipeFiles();
		await everyAction();
		expect(recipeFiles()).toEqual(before);
		// And no commit since the fixtures touched recipes/.
		expect(v.git('log', '--format=%s', 'HEAD', '--', 'recipes').trim().split('\n')[0]).toBe('fixtures');
		expect(v.git('status', '--porcelain').trim()).toBe('');
	});

	it('while every ingredient line and option has a resolution state', () => {
		const states = "('override', 'rule', 'alias', 'plural', 'none', 'ambiguous', 'recipe')";
		for (const t of ['ingredients', 'ingredient_or'])
			expect(v.ctx.db.prepare(`SELECT count(*) FROM ${t} WHERE resolution IS NULL OR resolution NOT IN ${states}`).pluck().get(), t).toBe(0);
		expect(v.ctx.db.prepare('SELECT count(*) FROM ingredients').pluck().get()).toBeGreaterThan(100);
	});
});

describe('deleting cache/ and restarting', () => {
	/** Everything the P1.5 pages show, from the index. */
	function state() {
		const db = v.ctx.db;
		const conv = loadConversions(v.ctx.paths.vocab);
		return {
			rows: db.prepare('SELECT slug, position, key, item, resolution FROM ingredients ORDER BY slug, position').all(),
			or: db.prepare('SELECT slug, position, alt_idx, item, resolution FROM ingredient_or ORDER BY slug, position, alt_idx').all(),
			registry: db.prepare('SELECT slug, file_hash, name, category, staple, au_gout, density FROM registry ORDER BY slug').all(),
			queue: resolveQueue(db, vocab(), { limit: 1000 }).rows.map((r) => [r.key, r.count, r.candidates.map((c) => c.slug)]),
			index: ingredientIndex(db, {}, TODAY),
			prices: db.prepare('SELECT * FROM current_price ORDER BY ingredient').all(),
			cost: slugs().map((s) => costOfRecipe(db, s, conv, TODAY)),
			pantry: pantryQuery(db, { have: ['oeuf', 'farine', 'lait'] }).map((r) => [r.slug, r.tier, r.missing]),
			view: ingredientView(db, 'beurre', vocab(), TODAY)
		};
	}

	it('loses nothing: resolution, queue, prices, cost and pantry come back from the files', async () => {
		await everyAction();
		const before = state();
		v.ctx.db.close();
		rmSync(join(v.dir, 'cache'), { recursive: true });
		const ctx = openVault({ root: v.dir, author: AUTHOR, log: () => {} });
		expect(ctx.fresh).toBe(true);
		v.ctx = ctx;
		forgetResolver(ctx.db);
		const r = syncVault(ctx.db, ctx.paths);
		expect(r.indexed).toBe(slugs().length);
		expect(r.registry.changed).toBe(true);
		expect(state()).toEqual(before);
	});
});
