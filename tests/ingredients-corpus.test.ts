// Ingredient-resolution metrics over the invented card corpus (plan 03,
// Phases 0 and 2: R0–R4 and T). The corpus is public, so this runs in the normal
// suite. The numbers are printed for the report. Only the hard gates are
// asserted: no wrong auto-resolution, no trap resolved to one entry, R0 complete,
// no seed merge. The coverage targets (R1, R2) are printed with their verdict:
// by the plan, precision wins over coverage, so a missed target is reported,
// not tuned away.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';
import { lookupKey, parseNormalizeVocab, type PluralRules } from '../src/lib/ingredients/normalize';
import { parseIngredient } from '../src/lib/ingredients/registry';
import { FUZZY, nameRows, Resolver } from '../src/lib/ingredients/resolve';
import type { RegistryEntry } from '../src/lib/ingredients/types';
import { seedEntries } from '../src/lib/server/seed';
import { seedVocab } from '../src/lib/server/vault';
import { AMBIGUOUS, formLangs, loadCorpus, type Occurrence } from './helpers/corpus';

const VOCAB_DOC = readFileSync('docs/VOCAB.md', 'utf8');
const PLURALS: PluralRules = parseNormalizeVocab(parse(seedVocab(VOCAB_DOC)['normalize.yaml'])).plurals;
const C = loadCorpus();
const LANGS = formLangs(C.occurrences);
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : '—');
const report: string[] = [];

/** A registry of names per id, each name under the language it is written in. */
function entries(names: Map<string, string[]>): Pick<RegistryEntry, 'slug' | 'names'>[] {
	return [...names].map(([slug, ns]) => ({
		slug,
		names: { fr: ns.filter((n) => LANGS.get(n) !== 'en'), en: ns.filter((n) => LANGS.get(n) === 'en') }
	}));
}
const resolverOf = (names: Map<string, string[]>) => new Resolver(nameRows(entries(names), PLURALS), PLURALS);

interface Outcome {
	o: Occurrence;
	expected: string;
	item: string | null;
}
function run(resolver: Resolver, occurrences = C.occurrences): Outcome[] {
	const memo = new Map<string, string | null>();
	return occurrences.map((o) => {
		const id = `${o.lang}\0${o.name}`;
		if (!memo.has(id)) memo.set(id, resolver.resolveKey(lookupKey(o.name), o.lang).item);
		return { o, expected: C.expected.get(o.name)!, item: memo.get(id)! };
	});
}
const wrong = (xs: Outcome[]) => xs.filter((x) => x.item !== null && x.item !== x.expected);
const right = (xs: Outcome[]) => xs.filter((x) => x.item !== null && x.item === x.expected);
const distinct = (xs: Outcome[]) => [...new Map(xs.map((x) => [x.o.name, x])).values()];

describe('corpus harness', () => {
	it('reads every recipe, and the answer key lists every written form once', () => {
		expect(C.unreadable).toEqual([]);
		expect(C.files.length).toBe(C.key.recipes);
		expect(C.occurrences.length).toBe(C.key.occurrences);
		expect(C.duplicates).toEqual([]);
		expect(C.missing).toEqual([]);
	});
});

describe('resolution metrics', () => {
	const firsts = new Map(Object.entries(C.key.ingredients).map(([id, v]) => [id, [v.variants[0]]]));
	const r1 = run(resolverOf(firsts));

	it('R0: every variant as an alias resolves every occurrence, none wrongly; ambiguous forms stay unresolved', () => {
		const all = new Map(Object.entries(C.key.ingredients).map(([id, v]) => [id, v.variants]));
		const xs = run(resolverOf(all));
		const plain = xs.filter((x) => x.expected !== AMBIGUOUS);
		const amb = xs.filter((x) => x.expected === AMBIGUOUS);
		report.push(
			`R0  resolved ${right(plain).length}/${plain.length} (${pct(right(plain).length, plain.length)}), wrong ${wrong(xs).length}, ambiguous forms left unresolved ${amb.filter((x) => !x.item).length}/${amb.length}`
		);
		expect(wrong(xs).map((x) => `${x.o.name} → ${x.item}`)).toEqual([]);
		expect(right(plain).length).toBe(plain.length);
	});

	it('R1: one name per id, by normalization alone — never wrong', () => {
		const others = r1.filter((x) => x.expected !== AMBIGUOUS && !firsts.get(x.expected)!.includes(x.o.name));
		const plain = r1.filter((x) => x.expected !== AMBIGUOUS);
		const d = distinct(others);
		const dv = right(d).length / d.length;
		const ov = right(others).length / others.length;
		report.push(
			`R1  other variants auto-resolved: distinct ${right(d).length}/${d.length} (${pct(right(d).length, d.length)}, target ≥ 60 %: ${dv >= 0.6 ? 'met' : 'NOT MET'}), ` +
				`occurrences ${right(others).length}/${others.length} (${pct(right(others).length, others.length)}, target ≥ 75 %: ${ov >= 0.75 ? 'met' : 'NOT MET'}); ` +
				`all occurrences ${right(plain).length}/${plain.length} (${pct(right(plain).length, plain.length)}); wrong ${wrong(r1).length}`
		);
		const u = d.filter((x) => x.item === null);
		report.push(`    left unresolved: ${u.length} distinct, of which ${u.filter((x) => x.o.lang === 'en').length} on English cards`);
		report.push(`    resolved by normalization: ${right(d).map((x) => `${x.o.name} → ${x.expected}`).join('; ')}`);
		expect(wrong(r1).map((x) => `${x.o.name} → ${x.item} (expected ${x.expected})`)).toEqual([]);
	});

	it('R2: the expected id is among the fuzzy candidates of what R1 left unresolved', () => {
		const resolver = resolverOf(firsts);
		const left = distinct(r1.filter((x) => x.expected !== AMBIGUOUS && x.item === null));
		const hit = (minScore: number, count: number) =>
			left.filter((x) => resolver.candidates(lookupKey(x.o.name), x.o.lang, { minScore, count }).some((c) => c.slug === x.expected));
		const size = (minScore: number) =>
			left.reduce((n, x) => n + resolver.candidates(lookupKey(x.o.name), x.o.lang, { minScore, count: FUZZY.count }).length, 0) / left.length;
		const chosen = hit(FUZZY.minScore, FUZZY.count);
		report.push(
			`R2  expected id in the top ${FUZZY.count} (min score ${FUZZY.minScore}): ${chosen.length}/${left.length} (${pct(chosen.length, left.length)}, target ≥ 85 %: ${chosen.length / left.length >= 0.85 ? 'met' : 'NOT MET'})`
		);
		report.push(
			'    sweep (min score: hit rate, mean candidates shown): ' +
				[0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4].map((s) => `${s}: ${pct(hit(s, FUZZY.count).length, left.length)}, ${size(s).toFixed(2)}`).join(' · ')
		);
		const missed = left.filter((x) => !chosen.includes(x));
		report.push(`    missed (${missed.length}): ${missed.map((x) => `${x.o.name} → ${x.expected}`).join('; ')}`);
		expect(chosen.length).toBeGreaterThan(0);
	});

	it('R3: the shipped seed registry — coverage, and no seed entry merging two ids', () => {
		const seed = seedEntries(readFileSync('docs/INGREDIENTS-SEED.yaml', 'utf8'));
		const xs = run(new Resolver(nameRows(seed, PLURALS), PLURALS));
		const ids = new Map<string, Set<string>>();
		for (const x of xs) if (x.item && x.expected !== AMBIGUOUS) (ids.get(x.item) ?? ids.set(x.item, new Set()).get(x.item)!).add(x.expected);
		const merges = [...ids].filter(([, s]) => s.size > 1).map(([slug, s]) => `${slug} ← ${[...s].sort().join(' + ')}`);
		const resolved = xs.filter((x) => x.item);
		const amb = xs.filter((x) => x.expected === AMBIGUOUS && x.item);
		const plain = distinct(xs.filter((x) => x.expected !== AMBIGUOUS));
		report.push(
			`R3  seed (${seed.length} entries): occurrences auto-resolved ${resolved.length}/${xs.length} (${pct(resolved.length, xs.length)}), ` +
				`distinct forms ${plain.filter((x) => x.item).length}/${plain.length}, ids reached ${new Set(resolved.map((x) => x.expected)).size}/${Object.keys(C.key.ingredients).length}; ` +
				`merges ${merges.length}${merges.length ? ` (${merges.join('; ')})` : ''}; ambiguous forms auto-resolved ${amb.length}${amb.length ? ` (${[...new Set(amb.map((x) => `${x.o.name} → ${x.item}`))].join('; ')})` : ''}`
		);
		expect(merges).toEqual([]);
		expect(amb.map((x) => x.o.name)).toEqual([]);
	});

	it('R4: queue actions to cover 90 % of occurrences from an empty registry', () => {
		const names = new Map<string, string[]>();
		const total = C.occurrences.length;
		const keys = new Set(C.occurrences.map((o) => `${o.lang}\0${lookupKey(o.name)}`)).size;
		let actions = 0;
		let wrongSeen = 0;
		let covered = 0;
		const marks: string[] = [];
		for (;;) {
			const xs = run(resolverOf(names));
			wrongSeen = Math.max(wrongSeen, wrong(xs).length);
			covered = right(xs).length;
			for (const m of [0.5, 0.75, 0.9]) if (covered / total >= m && !marks.some((s) => s.startsWith(`${m * 100} %`))) marks.push(`${m * 100} % after ${actions}`);
			if (covered / total >= 0.9) break;
			// The queue: unresolved names by lookup key, most frequent first.
			const groups = new Map<string, Outcome[]>();
			for (const x of xs)
				if (x.item === null && x.expected !== AMBIGUOUS) {
					const k = `${x.o.lang}\0${lookupKey(x.o.name)}`;
					(groups.get(k) ?? groups.set(k, []).get(k)!).push(x);
				}
			if (!groups.size) break;
			const [, top] = [...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
			// One action: link the name to the answer key's id (creating the entry the first time).
			const id = top[0].expected;
			names.set(id, [...(names.get(id) ?? []), top[0].o.name]);
			actions++;
		}
		report.push(
			`R4  ${actions} queue actions cover ${covered}/${total} occurrences (${pct(covered, total)}), against ${keys} distinct names (lookup keys) and ${Object.keys(C.key.ingredients).length} ids; ` +
				`milestones: ${marks.join(', ')}; wrong ${wrongSeen}`
		);
		expect(wrongSeen).toBe(0);
	});

	it('T: no trap pair resolves to one entry of the fixture registry', () => {
		const dir = 'tests/fixtures/vault/ingredients';
		const reg = readdirSync(dir)
			.filter((f) => f.endsWith('.md'))
			.map((f) => parseIngredient(readFileSync(join(dir, f), 'utf8'), { fileStem: f.slice(0, -3) }).entry)
			.filter((e): e is RegistryEntry => !!e);
		const resolver = new Resolver(nameRows(reg, PLURALS), PLURALS);
		const traps = (parse(readFileSync('tests/fixtures/resolve-traps.yaml', 'utf8')) as { traps: ([string, string] | { pair: [string, string]; lang: string })[] }).traps.map((t) =>
			Array.isArray(t) ? { pair: t, lang: 'fr' } : t
		);
		const hit = traps.filter(({ pair: [a, b], lang }) => {
			const x = resolver.resolve({ name: a }, lang).item;
			return x !== null && x === resolver.resolve({ name: b }, lang).item;
		});
		report.push(`T   ${hit.length}/${traps.length} trap pairs resolved to one entry${hit.length ? `: ${hit.map((t) => t.pair.join(' / ')).join('; ')}` : ''}`);
		expect(hit.map((t) => t.pair.join(' / '))).toEqual([]);
	});

	afterAll(() => {
		console.log(['', `Ingredient resolution — corpus of ${C.files.length} recipes, ${C.occurrences.length} names`, ...report, ''].join('\n'));
	});
});
