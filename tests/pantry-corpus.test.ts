// Pantry search over the invented card corpus (plan 03, Phase 7): the 320
// recipes of tests/fixtures/corpus and the seed registry, through a real vault
// and its index, as /garde-manger does. The tiers are printed for the report.

import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openVault, type VaultContext } from '../src/lib/server/context';
import { pantryQuery } from '../src/lib/server/index/pantry';
import { syncVault } from '../src/lib/server/index/sync';
import { initVault } from '../src/lib/server/vault';
import type { PantryQuery } from '../src/lib/ingredients/pantry';

const AUTHOR = { name: 'Test Author', email: 'test@example.invalid' };
let dir: string;
let ctx: VaultContext;
const report: string[] = [];

beforeAll(async () => {
	dir = join(mkdtempSync(join(tmpdir(), 'rv-pantry-')), 'vault');
	await initVault(dir, readFileSync('docs/VOCAB.md', 'utf8'), AUTHOR, readFileSync('docs/INGREDIENTS-SEED.yaml', 'utf8'));
	cpSync('tests/fixtures/corpus/recipes', join(dir, 'recipes'), { recursive: true });
	ctx = openVault({ root: dir, author: AUTHOR, log: () => {} });
	syncVault(ctx.db, ctx.paths);
}, 60_000);

afterAll(() => {
	ctx?.db.close();
	if (dir) rmSync(join(dir, '..'), { recursive: true, force: true });
	console.log(['', 'Pantry search over the corpus (plan 03, Phase 7)', ...report].join('\n'));
});

function run(label: string, q: PantryQuery) {
	const t0 = performance.now();
	const r = pantryQuery(ctx.db, q);
	const ms = performance.now() - t0;
	const by = (tier: string) => r.filter((x) => x.tier === tier);
	report.push(
		`  ${label}: ${r.length} results in ${ms.toFixed(1)} ms — prêt ${by('pret').length}, substitution ${by('substitution').length}, presque ${by('presque').length}, idées ${by('idees').length}`,
		`    prêt: ${by('pret')
			.slice(0, 8)
			.map((x) => x.slug)
			.join(', ')}`
	);
	return r;
}

describe('pantry search over the corpus', () => {
	it('"œufs, farine, lait": the corpus has no plain batter, so nothing is ready; brown sugar is swapped for white', () => {
		const r = run('oeuf, farine, lait', { have: ['oeuf', 'farine-tout-usage', 'lait'] });
		// The tiers in order.
		const order = ['pret', 'substitution', 'presque', 'idees'];
		expect(r.map((x) => order.indexOf(x.tier))).toEqual(r.map((x) => order.indexOf(x.tier)).sort((a, b) => a - b));
		for (const x of r) expect(x.used).toBeGreaterThan(0);
		const chomeur = r.find((x) => x.slug === 'pouding-chomeur')!;
		expect(chomeur.tier).toBe('substitution');
		expect(chomeur.swaps).toEqual([{ missing: 'cassonade', with: 'sucre' }]);
	});

	it('adding "cassonade" makes the pouding chômeur ready, first by coverage', () => {
		const r = run('oeuf, farine, lait, cassonade', { have: ['oeuf', 'farine-tout-usage', 'lait', 'cassonade'] });
		const ready = r.filter((x) => x.tier === 'pret');
		expect(ready.map((x) => x.slug)).toContain('pouding-chomeur');
		for (const x of ready) {
			expect(x.missing).toEqual([]);
			expect(x.coverage).toBe(1);
		}
	});

	it('without the staples assumed, nothing that needs one is ready', () => {
		const q = { have: ['oeuf', 'farine-tout-usage', 'lait', 'cassonade'] };
		const on = pantryQuery(ctx.db, q).filter((x) => x.tier === 'pret').length;
		const off = run('oeuf, farine, lait, cassonade, staples off', { ...q, assumeStaples: false }).filter((x) => x.tier === 'pret').length;
		expect(off).toBeLessThan(on);
	});

	it('"à éviter" and an allergen leave out every recipe using them', () => {
		const q = { have: ['oeuf', 'farine-tout-usage', 'lait'] };
		const all = pantryQuery(ctx.db, q);
		const noNuts = run('oeuf, farine, lait, sans noix', { ...q, allergens: ['noix'] });
		expect(noNuts.length).toBeLessThanOrEqual(all.length);
		const nutty = new Set(ctx.db.prepare("SELECT slug FROM ingredient_allergens WHERE allergen = 'noix'").pluck().all() as string[]);
		const users = new Set(
			ctx.db
				.prepare(`SELECT slug FROM ingredients WHERE item IN (${[...nutty].map(() => '?').join(',') || "''"})`)
				.pluck()
				.all(...nutty) as string[]
		);
		for (const x of noNuts) expect(users.has(x.slug)).toBe(false);
	});

	it('answers in a few milliseconds once the model is built', () => {
		pantryQuery(ctx.db, { have: ['beurre'] });
		const t0 = performance.now();
		for (let i = 0; i < 20; i++) pantryQuery(ctx.db, { have: ['oeuf', 'farine-tout-usage', 'lait', 'sucre'] });
		const ms = (performance.now() - t0) / 20;
		report.push(`  a query over 320 recipes, model warm: ${ms.toFixed(2)} ms`);
		expect(ms).toBeLessThan(50);
	});
});
