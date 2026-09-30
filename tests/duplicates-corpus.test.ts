// Duplicate detection over the invented card corpus (plan 05, Phases 0 and 5):
// the 320 cards of tests/fixtures/corpus, their dish key
// (expected-dishes.yaml) and the planted duplicates built here
// (tests/helpers/duplicates.ts). Public test data: runs in the normal suite.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORPUS_DIR, loadCorpus } from './helpers/corpus';
import { loadDishes, plantDuplicates, plantSample } from './helpers/duplicates';

const texts = new Map(
	readdirSync(join(CORPUS_DIR, 'recipes'))
		.filter((f) => f.endsWith('.md'))
		.sort()
		.map((f) => [f.slice(0, -3), readFileSync(join(CORPUS_DIR, 'recipes', f), 'utf8')] as const)
);
const dishes = loadDishes();

describe('duplicate answer keys (Phase 0)', () => {
	it('the dish key covers every card', () => {
		expect([...dishes.keys()].sort()).toEqual([...texts.keys()].sort());
	});

	it('plants three copies of each sampled card, each checking, none a corpus slug', () => {
		const sample = plantSample(texts);
		expect(sample.length).toBeGreaterThanOrEqual(20);
		const planted = plantDuplicates(texts, sample, loadCorpus().key);
		expect(planted.length).toBe(sample.length * 3);
		for (const p of planted) expect(texts.has(p.slug)).toBe(false);
		// Most reordered copies also swap a written form.
		expect(planted.filter((p) => p.kind === 'reorder' && p.swapped).length).toBeGreaterThan(sample.length / 2);
	});
});
