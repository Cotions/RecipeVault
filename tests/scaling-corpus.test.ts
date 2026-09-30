// Scaling over the invented card corpus and the fixture vault (plan 05). The
// hard gate: at factor 1 every recipe displays exactly what it displayed before
// scaling was built (tests/fixtures/scaling-baseline.txt). Public test data:
// runs in the normal suite.

import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { BASELINE, baselineText, loadDisplayRecipes } from './helpers/display';

const recipes = loadDisplayRecipes();

describe('scaling harness (plan 05, Phase 0)', () => {
	it('reads every corpus card and fixture recipe', () => {
		expect(recipes.filter((r) => r.file.startsWith('corpus/'))).toHaveLength(320);
		expect(recipes.filter((r) => r.file.startsWith('vault/')).length).toBeGreaterThanOrEqual(20);
	});

	it('the scaling table reads', () => {
		const table = parse(readFileSync('tests/fixtures/scaling.yaml', 'utf8'), { version: '1.2' }) as { cases: unknown[]; lines: unknown[] };
		expect(table.cases.length).toBeGreaterThan(40);
		expect(table.lines.length).toBeGreaterThan(5);
	});

	it('factor 1 displays exactly the baseline', () => {
		const want = readFileSync(BASELINE, 'utf8').split('\n');
		const got = baselineText(recipes).split('\n');
		const diff = got.map((l, i) => (l === want[i] ? null : `- ${want[i]}\n+ ${l}`)).filter(Boolean);
		expect(diff.slice(0, 10)).toEqual([]);
		expect(got.length).toBe(want.length);
	});
});
