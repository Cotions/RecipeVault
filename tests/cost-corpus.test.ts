// Cost coverage over the invented card corpus (plan 03, Phase 5): the 320
// recipes of tests/fixtures/corpus, the seed registry (docs/INGREDIENTS-SEED.yaml)
// and invented prices for its most used entries (tests/fixtures/prices/corpus.csv).
// Everything goes through a real vault and its index, as the recipe page does.
// The distribution is printed for the report; only hard gates are asserted.

import { copyFileSync, cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RecipeCost } from '../src/lib/ingredients/cost';
import { openVault, type VaultContext } from '../src/lib/server/context';
import { costOfRecipe } from '../src/lib/server/cost';
import { syncVault } from '../src/lib/server/index/sync';
import { loadConversions } from '../src/lib/server/vocab';
import { initVault } from '../src/lib/server/vault';

const AUTHOR = { name: 'Test Author', email: 'test@example.invalid' };
const TODAY = '2026-09-27';
let dir: string;
let ctx: VaultContext;
const costs = new Map<string, RecipeCost>();
let ms = 0;
const report: string[] = [];

beforeAll(async () => {
	dir = join(mkdtempSync(join(tmpdir(), 'rv-cost-')), 'vault');
	await initVault(dir, readFileSync('docs/VOCAB.md', 'utf8'), AUTHOR, readFileSync('docs/INGREDIENTS-SEED.yaml', 'utf8'));
	cpSync('tests/fixtures/corpus/recipes', join(dir, 'recipes'), { recursive: true });
	copyFileSync('tests/fixtures/prices/corpus.csv', join(dir, 'prices.csv'));
	ctx = openVault({ root: dir, author: AUTHOR, log: () => {} });
	syncVault(ctx.db, ctx.paths);
	const conv = loadConversions(ctx.paths.vocab);
	const t0 = performance.now();
	for (const slug of ctx.db.prepare('SELECT slug FROM recipes ORDER BY slug').pluck().all() as string[]) costs.set(slug, costOfRecipe(ctx.db, slug, conv, TODAY)!);
	ms = performance.now() - t0;
}, 60_000);

afterAll(() => {
	ctx?.db.close();
	if (dir) rmSync(join(dir, '..'), { recursive: true, force: true });
	console.log(['', 'Cost over the corpus (plan 03, Phase 5)', ...report].join('\n'));
});

const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(1)} %`;

describe('cost over the corpus', () => {
	it('every recipe is costed, with finite non-negative figures', () => {
		expect(costs.size).toBe(320);
		for (const c of costs.values()) {
			expect(Number.isFinite(c.total) && c.total >= 0).toBe(true);
			for (const l of c.lines) if (l.cost !== undefined) expect(Number.isFinite(l.cost) && l.cost >= 0).toBe(true);
			expect(c.lines.some((l) => l.reason === 'cycle')).toBe(false);
		}
		report.push(`recipes: ${costs.size}; prices: ${ctx.db.prepare('SELECT count(*) FROM current_price').pluck().get()} entries; all costed in ${ms.toFixed(0)} ms (${(ms / costs.size).toFixed(2)} ms per recipe)`);
	});

	it('coverage distribution', () => {
		const all = [...costs.values()];
		const buckets: [string, (c: RecipeCost) => boolean][] = [
			['nothing counts', (c) => c.coverage === null],
			['0 %', (c) => c.coverage === 0],
			['1–49 %', (c) => c.coverage !== null && c.coverage > 0 && c.coverage < 0.5],
			['50–69 %', (c) => c.coverage !== null && c.coverage >= 0.5 && c.coverage < 0.7],
			['70–89 %', (c) => c.coverage !== null && c.coverage >= 0.7 && c.coverage < 0.9],
			['90–99 %', (c) => c.coverage !== null && c.coverage >= 0.9 && c.coverage < 1],
			['100 %', (c) => c.coverage === 1]
		];
		report.push('coverage (priced / counted, staples and to_taste out):');
		for (const [label, f] of buckets) {
			const n = all.filter(f).length;
			report.push(`  ${label.padEnd(15)} ${String(n).padStart(4)}  ${pct(n, all.length)}`);
		}
		const shown = all.filter((c) => c.enough);
		report.push(`figure shown (≥ 70 %, or every line priced when nothing counts): ${shown.length} of ${all.length} (${pct(shown.length, all.length)})`);
		const covs = all.map((c) => c.coverage).filter((c): c is number => c !== null).sort((a, b) => a - b);
		report.push(`median coverage: ${pct(covs[Math.floor(covs.length / 2)], 1)}`);
		const totals = shown.map((c) => c.perServing).filter((x): x is number => x !== null).sort((a, b) => a - b);
		if (totals.length) report.push(`cost per serving where shown (${totals.length} with servings): median ${totals[Math.floor(totals.length / 2)].toFixed(2)} $, max ${totals.at(-1)!.toFixed(2)} $`);
		expect(buckets.reduce((n, [, f]) => n + all.filter(f).length, 0)).toBe(all.length);
	});

	it('why lines stay unpriced', () => {
		const lines = [...costs.values()].flatMap((c) => c.lines);
		const counted = lines.filter((l) => l.counted);
		const tally = new Map<string, number>();
		for (const l of counted) {
			const k = l.cost !== undefined ? 'priced' : (l.reason ?? '?');
			tally.set(k, (tally.get(k) ?? 0) + 1);
		}
		report.push(`counted lines: ${counted.length}`);
		for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1])) report.push(`  ${k.padEnd(15)} ${String(n).padStart(5)}  ${pct(n, counted.length)}`);
		const staples = lines.filter((l) => l.staple && !l.toTaste && l.reason !== 'optional');
		report.push(`staple lines (out of coverage): ${staples.length}, priced ${staples.filter((l) => l.cost !== undefined).length}`);
		const subs = lines.filter((l) => l.via.length);
		const subUnpriced = lines.filter((l) => l.reason === 'no-scale' || l.reason === 'no-recipe');
		report.push(`sub-recipe lines flattened: ${subs.length}; sub-recipes left as one unpriced line: ${subUnpriced.length} (no-scale ${subUnpriced.filter((l) => l.reason === 'no-scale').length})`);
		const conv = new Map<string, number>();
		for (const l of counted.filter((l) => l.reason === 'no-conversion')) conv.set(l.item!, (conv.get(l.item!) ?? 0) + 1);
		report.push(`no-conversion, most frequent: ${[...conv].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, n]) => `${s} ${n}`).join(', ')}`);
		expect(tally.get('priced')).toBeGreaterThan(0);
	});
});
