// Duplicate detection over the invented card corpus (plan 05, Phases 0 and 5):
// the 320 cards of tests/fixtures/corpus with the seed registry, through a
// real vault and its index, their dish key (expected-dishes.yaml) and the
// planted duplicates built here (tests/helpers/duplicates.ts). Public test
// data: runs in the normal suite. D0–D4 and the threshold sweep are printed
// for the report.

import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DUPLICATE_THRESHOLD, rarityWeights, similarPairsBrute, weightOf, type SimPair } from '../src/lib/ingredients/similar';
import { openVault, type VaultContext } from '../src/lib/server/context';
import { duplicateModel, pairDetail, pairsFor } from '../src/lib/server/index/similar';
import { getResolver } from '../src/lib/server/index/resolve';
import { syncVault } from '../src/lib/server/index/sync';
import { initVault } from '../src/lib/server/vault';
import { loadVocab } from '../src/lib/server/vocab';
import { checkFile } from '../src/lib/vault/check';
import { CORPUS_DIR, loadCorpus } from './helpers/corpus';
import { loadDishes, plantDuplicates, plantSample, type Planted } from './helpers/duplicates';

const AUTHOR = { name: 'Test Author', email: 'test@example.invalid' };
const texts = new Map(
	readdirSync(join(CORPUS_DIR, 'recipes'))
		.filter((f) => f.endsWith('.md'))
		.sort()
		.map((f) => [f.slice(0, -3), readFileSync(join(CORPUS_DIR, 'recipes', f), 'utf8')] as const)
);
const dishes = loadDishes();
const report: string[] = [];

let dir: string;
let ctx: VaultContext;
let planted: Planted[];
/** Every pair ≥ 0.3 with the page's rules (family pairs out, Q16 C), and with every pair in (raw similarity). */
let low: SimPair[];
let raw: SimPair[];
const dishOf = (slug: string) => dishes.get(slug) ?? dishes.get(planted.find((p) => p.slug === slug)?.original ?? '');
const isPlanted = (slug: string) => !dishes.has(slug);
const langOf = new Map<string, string>();

beforeAll(async () => {
	dir = join(mkdtempSync(join(tmpdir(), 'rv-dup-')), 'vault');
	await initVault(dir, readFileSync('docs/VOCAB.md', 'utf8'), AUTHOR, readFileSync('docs/INGREDIENTS-SEED.yaml', 'utf8'));
	cpSync(join(CORPUS_DIR, 'recipes'), join(dir, 'recipes'), { recursive: true });
	ctx = openVault({ root: dir, author: AUTHOR, log: () => {} });
	syncVault(ctx.db, ctx.paths);
	// The swap in (b) takes a form the vault resolves to the same entry.
	const resolver = getResolver(ctx.db, () => loadVocab(ctx.paths.vocab));
	const same = (a: string, b: string, lang: string) => {
		const x = resolver.resolve({ name: a }, lang).item;
		return !!x && x === resolver.resolve({ name: b }, lang).item;
	};
	planted = plantDuplicates(texts, plantSample(texts), loadCorpus().key, same);
	for (const p of planted) writeFileSync(join(dir, 'recipes', `${p.slug}.md`), p.text);
	syncVault(ctx.db, ctx.paths);
	for (const r of ctx.db.prepare('SELECT slug, lang FROM recipes').all() as { slug: string; lang: string }[]) langOf.set(r.slug, r.lang);
	low = duplicateModel(ctx.db, 0.3).pairs;
	const m = duplicateModel(ctx.db, 0.3);
	const list = [...m.recipes.values()].map((r) => ({ ...r, family: null }));
	const w = rarityWeights(list);
	raw = similarPairsBrute(list, (e) => weightOf(w, list.length, e), 0.3);
}, 120_000);

afterAll(() => {
	ctx?.db.close();
	if (dir) rmSync(join(dir, '..'), { recursive: true, force: true });
	console.log(['', 'Duplicate detection over the corpus (plan 05, Phase 5)', ...report].join('\n'));
});

const key = (p: { a: string; b: string }) => (p.a < p.b ? `${p.a} ${p.b}` : `${p.b} ${p.a}`);
const pct = (x: number) => `${(100 * x).toFixed(1)} %`;

interface Metrics {
	t: number;
	d0: number;
	d0Missed: string[];
	flagged: number;
	precision: number;
	recallFr: number;
	recallAll: number;
	per100: number;
}

/** D0–D2 and D4 at threshold `t`, from the pairs at ≥ 0.3. */
function metrics(pairs: SimPair[], t: number): Metrics {
	// Flagged at t: above it, or (the second signal, issue #13) above METHOD_FLOOR with the same method.
	const at = pairs.filter((p) => p.score >= t - 1e-9 || p.method);
	const flaggedKeys = new Set(at.map(key));
	const missed = planted.filter((p) => !flaggedKeys.has(key({ a: p.slug, b: p.original })));
	// D1 and D2 on the corpus alone: planted copies left out.
	const corpus = at.filter((p) => !isPlanted(p.a) && !isPlanted(p.b));
	const good = corpus.filter((p) => dishOf(p.a) === dishOf(p.b));
	// Same-dish pairs of the corpus, all of them and French–French only.
	const slugs = [...dishes.keys()].filter((s) => langOf.has(s));
	let sameAll = 0;
	let sameFr = 0;
	let hitFr = 0;
	for (let i = 0; i < slugs.length; i++)
		for (let j = i + 1; j < slugs.length; j++) {
			if (dishes.get(slugs[i]) !== dishes.get(slugs[j])) continue;
			sameAll++;
			const fr = langOf.get(slugs[i]) === 'fr' && langOf.get(slugs[j]) === 'fr';
			if (fr) {
				sameFr++;
				if (flaggedKeys.has(key({ a: slugs[i], b: slugs[j] }))) hitFr++;
			}
		}
	return {
		t,
		d0: (planted.length - missed.length) / planted.length,
		d0Missed: missed.map((p) => `${p.kind} ${p.original}`),
		flagged: corpus.length,
		precision: corpus.length ? good.length / corpus.length : 1,
		recallFr: sameFr ? hitFr / sameFr : 0,
		recallAll: sameAll ? good.length / sameAll : 0,
		per100: (100 * corpus.length) / slugs.length
	};
}

describe('duplicate detection over the corpus (Phase 5)', () => {
	it('sweeps the threshold (for the report)', () => {
		report.push(`  ${texts.size} cards + ${planted.length} planted copies of ${planted.length / 3} cards; weights ln(1 + N/df)`);
		report.push('  t     D0 planted   flagged  D1 precision  D2 recall fr–fr / all  D4 per 100   (page rules; raw similarity: flagged, precision)');
		for (let t = 0.4; t <= 0.951; t += 0.05) {
			const m = metrics(low, t);
			const r = metrics(raw, t);
			report.push(
				`  ${t.toFixed(2)}  ${pct(m.d0).padStart(8)}   ${String(m.flagged).padStart(7)}  ${pct(m.precision).padStart(12)}  ${pct(m.recallFr).padStart(9)} / ${pct(m.recallAll).padEnd(9)}  ${m.per100.toFixed(1).padStart(10)}   (${r.flagged}, ${pct(r.precision)})`
			);
		}
	});

	it(`D0: every planted copy is found at the threshold (${DUPLICATE_THRESHOLD})`, () => {
		const m = metrics(low, DUPLICATE_THRESHOLD);
		report.push('', `  At the threshold ${DUPLICATE_THRESHOLD}:`, `  D0 planted pairs found: ${pct(m.d0)}${m.d0Missed.length ? ` — missed: ${m.d0Missed.join(', ')}` : ''}`);
		const byKind = (k: string) => planted.filter((p) => p.kind === k);
		for (const k of ['title', 'reorder', 'minus-one']) {
			const scores = byKind(k).map((p) => low.find((q) => key(q) === key({ a: p.slug, b: p.original }))?.score ?? 0);
			report.push(`    ${k}: lowest score ${Math.min(...scores).toFixed(3)}`);
		}
		report.push(`    reorder copies with a swapped form: ${byKind('reorder').filter((p) => p.swapped).length} of ${byKind('reorder').length}`);
		expect(m.d0Missed).toEqual([]);
	});

	it('D1: at least 90 % of the flagged corpus pairs are one dish; D2, D4 reported', () => {
		const m = metrics(low, DUPLICATE_THRESHOLD);
		report.push(
			`  D1 precision: ${pct(m.precision)} of ${m.flagged} flagged corpus pairs`,
			`  D2 recall: French–French ${pct(m.recallFr)}, any language ${pct(m.recallAll)}`,
			`  D4: ${m.per100.toFixed(1)} pairs per 100 recipes`
		);
		const wrong = low.filter((p) => (p.score >= DUPLICATE_THRESHOLD || p.method) && !isPlanted(p.a) && !isPlanted(p.b) && dishOf(p.a) !== dishOf(p.b));
		const byMethod = low.filter((p) => p.method && p.score < DUPLICATE_THRESHOLD && !isPlanted(p.a) && !isPlanted(p.b));
		report.push(`  of which below ${DUPLICATE_THRESHOLD}, flagged by the same method (issue #13): ${byMethod.length}, ${byMethod.filter((p) => dishOf(p.a) === dishOf(p.b)).length} one dish`);
		if (wrong.length) report.push(`  flagged pairs of two dishes: ${wrong.map((p) => `${p.a} ~ ${p.b} (${p.score.toFixed(2)})`).join('; ')}`);
		expect(m.precision).toBeGreaterThanOrEqual(0.9);
	});

	it('D3: the 20 highest-scoring different-dish pairs, with what they share (report)', () => {
		const m = duplicateModel(ctx.db, 0.3);
		const top = raw.filter((p) => !isPlanted(p.a) && !isPlanted(p.b) && dishOf(p.a) !== dishOf(p.b)).slice(0, 20);
		report.push('', '  D3 highest different-dish pairs (raw similarity):');
		for (const p of top) report.push(`    ${p.score.toFixed(2)} ${p.a} (${dishOf(p.a)}) ~ ${p.b} (${dishOf(p.b)}): ${pairDetail(m, p).shared.join(', ')}`);
		expect(top.length).toBeGreaterThan(0);
	});

	it('pairsFor finds each planted copy as a paste would, before it is saved', () => {
		const vocab = () => loadVocab(ctx.paths.vocab);
		const missed: string[] = [];
		for (const p of planted) {
			const recipe = checkFile(p.text).recipe!;
			// As a paste: the copy itself is left out (it is in this index; a real paste is not).
			const found = pairsFor(ctx.db, vocab, recipe, { own: p.slug });
			if (!found.some((f) => f.slug === p.original)) missed.push(`${p.kind} ${p.original}`);
		}
		expect(missed).toEqual([]);
	});
});

describe('duplicate answer keys (Phase 0)', () => {
	it('the dish key covers every card', () => {
		expect([...dishes.keys()].sort()).toEqual([...texts.keys()].sort());
	});

	it('plants three copies of each sampled card, each checking, none a corpus slug', () => {
		const sample = plantSample(texts);
		expect(sample.length).toBeGreaterThanOrEqual(20);
		expect(planted.length).toBe(sample.length * 3);
		for (const p of planted) expect(texts.has(p.slug)).toBe(false);
		// Most reordered copies also swap a written form.
		expect(planted.filter((p) => p.kind === 'reorder' && p.swapped).length).toBeGreaterThan(sample.length / 2);
	});
});
