import { readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openIndex } from '../../src/lib/server/index/db';
import { registryEntries } from '../../src/lib/server/registry';
import { seedVault } from '../../src/lib/server/seed';
import { syncVault } from '../../src/lib/server/index/sync';
import { initVault } from '../../src/lib/server/vault';
import { Watcher } from '../../src/lib/server/watcher';
import { AUTHOR, fixtureVault, tempVault, VOCAB_DOC, type TempVault } from '../helpers/vault';

const SEED = readFileSync('docs/INGREDIENTS-SEED.yaml', 'utf8');

let v: TempVault;
afterEach(() => v.cleanup());

const names = (key: string) =>
	(v.ctx.db.prepare('SELECT DISTINCT slug FROM ingredient_names WHERE key = ? ORDER BY slug').pluck().all(key) as string[]);
const row = (slug: string) => v.ctx.db.prepare('SELECT * FROM registry WHERE slug = ?').get(slug) as Record<string, unknown> | undefined;

describe('registry sync', () => {
	beforeEach(async () => {
		v = await fixtureVault();
	});

	it('indexes every entry, its names, substitutes and allergens; lists the broken file and the collision', () => {
		const r = syncVault(v.ctx.db, v.ctx.paths, { force: true });
		expect(r.registry.files).toBe(37);
		expect(v.ctx.db.prepare('SELECT count(*) FROM registry').pluck().get()).toBe(36);
		expect(row('oeuf')).toMatchObject({ name: 'œuf', category: 'frais', staple: 1, default_unit: 'piece' });
		expect(JSON.parse(row('oeuf')!.entry_json as string).weights).toEqual({ piece: 55 });
		expect(row('farine')).toMatchObject({ density: 0.53, staple: 1 });
		expect(names('oeufs')).toEqual(['oeuf']);
		expect(names('huile')).toEqual(['huile-d-olive', 'huile-vegetale']);
		// The singular key, from vocab/normalize.yaml.
		expect(v.ctx.db.prepare("SELECT skey FROM ingredient_names WHERE name = 'tomates fraîches'").pluck().get()).toBe('tomate fraiche');
		expect(v.ctx.db.prepare("SELECT substitute FROM substitutes WHERE slug = 'beurre'").pluck().all()).toEqual(['margarine']);
		expect(v.ctx.db.prepare("SELECT allergen FROM ingredient_allergens WHERE slug = 'farine'").pluck().all()).toEqual(['gluten']);
		expect(r.registry.problems).toEqual([
			{ file: 'ingredients/casse.md', broken: true, codes: ['E803'] },
			{ file: 'ingredients/huile-d-olive.md', broken: false, codes: ['W810'] },
			{ file: 'ingredients/huile-vegetale.md', broken: false, codes: ['W810'] }
		]);
		// Recipe problems are reported apart.
		expect(r.problems).toEqual([]);
	});

	it('skips an unchanged registry, and reads only the changed file', () => {
		const again = syncVault(v.ctx.db, v.ctx.paths);
		expect(again.registry).toMatchObject({ changed: false, loaded: 0 });
		const f = join(v.dir, 'ingredients/sucre.md');
		writeFileSync(f, readFileSync(f, 'utf8').replace('[sucre, sucre blanc]', '[sucre, sucre blanc, sucre granulé]'));
		const r = syncVault(v.ctx.db, v.ctx.paths);
		expect(r.registry).toMatchObject({ changed: true, loaded: 1 });
		expect(names('sucre granule')).toEqual(['sucre']);
	});

	it('keeps the last good rows of an entry that breaks, and drops the rows of a deleted file', () => {
		const f = join(v.dir, 'ingredients/sucre.md');
		writeFileSync(f, readFileSync(f, 'utf8').replace('category: epicerie', 'category: sucreries'));
		const r = syncVault(v.ctx.db, v.ctx.paths);
		expect(r.registry.problems.find((p) => p.file === 'ingredients/sucre.md')).toEqual({ file: 'ingredients/sucre.md', broken: true, codes: ['E803'] });
		expect(row('sucre')).toMatchObject({ category: 'epicerie' });
		expect(names('sucre')).toEqual(['sucre']);

		unlinkSync(f);
		const r2 = syncVault(v.ctx.db, v.ctx.paths);
		expect(r2.registry.removed).toBe(1);
		expect(row('sucre')).toBeUndefined();
		expect(names('sucre')).toEqual([]);
		expect(r2.registry.problems.map((p) => p.file)).not.toContain('ingredients/sucre.md');
	});

	it('re-reads every entry when the plural rules or the allergen list change', () => {
		writeFileSync(join(v.dir, 'vocab/allergens.yaml'), 'lait: { fr: Lait }\n');
		const r = syncVault(v.ctx.db, v.ctx.paths);
		expect(r.registry.loaded).toBe(37);
		expect(r.registry.problems.find((p) => p.file === 'ingredients/farine.md')?.codes).toEqual(['W809']);
		writeFileSync(join(v.dir, 'vocab/normalize.yaml'), 'plurals: {}\n');
		syncVault(v.ctx.db, v.ctx.paths);
		expect(v.ctx.db.prepare("SELECT skey FROM ingredient_names WHERE name = 'tomates fraîches'").pluck().get()).toBe('tomates fraiches');
	});

	it('survives a deleted cache', () => {
		v.ctx.db.close();
		rmSync(join(v.dir, 'cache'), { recursive: true });
		v.ctx.db = openIndex(v.ctx.paths.index).db;
		expect(syncVault(v.ctx.db, v.ctx.paths).registry.loaded).toBe(37);
		expect(row('oeuf')).toBeDefined();
	});
});

describe('watcher', () => {
	beforeEach(async () => {
		v = await fixtureVault();
	});

	it('reloads an edited entry and commits it; flags a broken one without committing', async () => {
		const seen: string[] = [];
		const w = new Watcher(v.ctx, { debounceMs: 30, onHandled: (rel, o) => seen.push(`${rel}:${o}`) });
		w.start();
		try {
			const f = join(v.dir, 'ingredients/carotte.md');
			writeFileSync(f, readFileSync(f, 'utf8').replace('fr: [carotte]', 'fr: [carotte, carottes nantaises]'));
			await new Promise((r) => setTimeout(r, 10));
			await w.idle();
			expect(seen).toEqual(['ingredients/carotte.md:committed']);
			expect(v.git('log', '-1', '--format=%s').trim()).toBe('edit (external): ingredients/carotte.md');
			expect(names('carottes nantaises')).toEqual(['carotte']);

			seen.length = 0;
			writeFileSync(f, readFileSync(f, 'utf8').replace('category: legume', 'category: 12'));
			await new Promise((r) => setTimeout(r, 10));
			await w.idle();
			expect(seen).toEqual(['ingredients/carotte.md:flagged']);
			expect(v.git('log', '-1', '--format=%s').trim()).toBe('edit (external): ingredients/carotte.md');
			expect(row('carotte')).toMatchObject({ category: 'legume' });
		} finally {
			w.stop();
		}
	});
});

describe('seed', () => {
	it('vault init writes the seed registry in the first commit', async () => {
		v = await tempVault();
		const dir = join(v.dir, '..', 'seeded');
		await initVault(dir, VOCAB_DOC, AUTHOR, SEED);
		const files = readdirSync(join(dir, 'ingredients')).filter((f) => f.endsWith('.md'));
		expect(files.length).toBeGreaterThan(150);
		expect(readFileSync(join(dir, 'ingredients/sel.md'), 'utf8')).toMatch(/^staple: true$/m);
		expect(readFileSync(join(dir, 'vocab/normalize.yaml'), 'utf8')).toMatch(/plurals:/);
	});

	it('vault ingredients seed adds what is missing, never overwrites, one commit', async () => {
		v = await fixtureVault();
		rmSync(join(v.dir, 'vocab/normalize.yaml'));
		v.git('commit', '-qam', 'drop normalize');
		const before = readFileSync(join(v.dir, 'ingredients/sucre.md'), 'utf8');
		const r = await seedVault(v.ctx, SEED, VOCAB_DOC);
		expect(r.added.length).toBeGreaterThan(100);
		expect(r.added).not.toContain('ingredients/sucre.md');
		expect(readFileSync(join(v.dir, 'ingredients/sucre.md'), 'utf8')).toBe(before);
		expect(v.git('log', '-1', '--format=%s').trim()).toBe(`ingredients: seed (${r.added.length} entries)`);
		expect(v.git('status', '--porcelain').trim()).toBe('');
		expect(v.read('vocab/normalize.yaml')).toMatch(/plurals:/);
		const again = await seedVault(v.ctx, SEED, VOCAB_DOC);
		expect(again).toEqual({ added: [] });
		const s = syncVault(v.ctx.db, v.ctx.paths);
		expect(registryEntries(v.ctx.db).length).toBe(36 + r.added.length);
		// The seed and the fixtures overlap on names: collisions are warnings, never errors.
		expect(s.registry.problems.filter((p) => p.broken).map((p) => p.file)).toEqual(['ingredients/casse.md']);
	});
});
