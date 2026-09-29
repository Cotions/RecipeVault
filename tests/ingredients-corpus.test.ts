// Ingredient-resolution metrics over the invented card corpus (plan 03,
// Phases 0 and 2: R0–R4, S0, SN, RA and T). The corpus is public, so this runs
// in the normal suite. The numbers are printed for the report. Only the hard
// gates are asserted: no wrong auto-resolution, no trap resolved to one entry,
// R0 complete, no seed merge, no ambiguous use resolved to anything but the id
// its line means. The coverage targets are printed with their verdict: by the
// plan, precision wins over coverage, so a missed target is reported, not
// tuned away.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';
import { lookupKey, parseNormalizeVocab, type PluralRules } from '../src/lib/ingredients/normalize';
import { parseIngredient } from '../src/lib/ingredients/registry';
import { FUZZY, nameRows, Resolver, ruleRows } from '../src/lib/ingredients/resolve';
import type { RegistryEntry } from '../src/lib/ingredients/types';
import type { Unit } from '../src/lib/vault/types';
import { seedEntries } from '../src/lib/server/seed';
import { seedVocab } from '../src/lib/server/vault';
import { AMBIGUOUS, formLangs, loadCorpus, type Occurrence } from './helpers/corpus';

const VOCAB_DOC = readFileSync('docs/VOCAB.md', 'utf8');
const PLURALS: PluralRules = parseNormalizeVocab(parse(seedVocab(VOCAB_DOC)['normalize.yaml'])).plurals;
const C = loadCorpus();
const LANGS = formLangs(C.occurrences);
const SEED = seedEntries(readFileSync('docs/INGREDIENTS-SEED.yaml', 'utf8'));
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : '—');
const report: string[] = [];

/**
 * Coverage targets for the seed (plan 03, Phase 2 "Resolution metrics"): share
 * of all corpus occurrences resolved to the right entry.
 */
const TARGET = { seed: 0.9, seedPlus: { actions: 25, share: 0.95 } };

/** A registry of names per id, each name under the language it is written in. */
function entries(names: Map<string, string[]>): Pick<RegistryEntry, 'slug' | 'names'>[] {
	return [...names].map(([slug, ns]) => ({
		slug,
		names: { fr: ns.filter((n) => LANGS.get(n) !== 'en'), en: ns.filter((n) => LANGS.get(n) === 'en') }
	}));
}
const resolverOf = (names: Map<string, string[]>) => new Resolver(nameRows(entries(names), PLURALS), PLURALS);
const registryResolver = (es: Pick<RegistryEntry, 'slug' | 'names' | 'when'>[]) => new Resolver(nameRows(es, PLURALS), PLURALS, [], ruleRows(es));

interface Outcome {
	o: Occurrence;
	/** The answer key's id for the written form, or 'ambiguous'. */
	expected: string;
	/** The id this use means: `expected`, or for an ambiguous name the id its line means (null: the card does not say). */
	want: string | null;
	item: string | null;
}
function run(resolver: Resolver, occurrences = C.occurrences): Outcome[] {
	const memo = new Map<string, string | null>();
	return occurrences.map((o) => {
		const id = [o.lang, o.name, o.unit, o.prep, o.note].join('\0');
		if (!memo.has(id)) memo.set(id, resolver.resolve({ name: o.name, unit: o.unit as never, prep: o.prep, note: o.note }, o.lang).item);
		const expected = C.expected.get(o.name)!;
		return { o, expected, want: expected === AMBIGUOUS ? (o.given ?? null) : expected, item: memo.get(id)! };
	});
}
const wrong = (xs: Outcome[]) => xs.filter((x) => x.item !== null && x.item !== x.expected);
const right = (xs: Outcome[]) => xs.filter((x) => x.item !== null && x.item === x.expected);
const distinct = (xs: Outcome[]) => [...new Map(xs.map((x) => [x.o.name, x])).values()];

/**
 * Scoring against a registry whose slugs are not the answer key's ids (the
 * seed): each slug stands for the ids of the uses resolved to it. A slug
 * standing for two ids is a merge; its minority uses count as wrong. A use
 * whose line does not say which id (`want` null) is wrong whenever resolved.
 */
function scored(xs: Outcome[]) {
	const ids = new Map<string, Map<string, number>>();
	for (const x of xs)
		if (x.item && x.want) {
			const m = ids.get(x.item) ?? ids.set(x.item, new Map()).get(x.item)!;
			m.set(x.want, (m.get(x.want) ?? 0) + 1);
		}
	const idOf = new Map([...ids].map(([slug, m]) => [slug, [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]]));
	const merges = [...ids].filter(([, m]) => m.size > 1).map(([slug, m]) => `${slug} ← ${[...m.keys()].sort().join(' + ')}`);
	return {
		idOf,
		merges,
		right: xs.filter((x) => x.item && x.want && idOf.get(x.item) === x.want),
		wrong: xs.filter((x) => x.item && (!x.want || idOf.get(x.item) !== x.want))
	};
}

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

	it('R1: one name per id, by normalization alone — never wrong (reported; not a coverage gate)', () => {
		const others = r1.filter((x) => x.expected !== AMBIGUOUS && !firsts.get(x.expected)!.includes(x.o.name));
		const plain = r1.filter((x) => x.expected !== AMBIGUOUS);
		const d = distinct(others);
		report.push(
			`R1  other variants auto-resolved: distinct ${right(d).length}/${d.length} (${pct(right(d).length, d.length)}), ` +
				`occurrences ${right(others).length}/${others.length} (${pct(right(others).length, others.length)}); ` +
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

	it('S0 (was R3): the shipped seed alone — coverage, no merge, nothing wrong', () => {
		const xs = run(registryResolver(SEED));
		const s = scored(xs);
		const total = xs.length;
		const plain = distinct(xs.filter((x) => x.expected !== AMBIGUOUS));
		const byRule = xs.filter((x) => x.expected === AMBIGUOUS && x.item);
		report.push(
			`S0  seed (${SEED.length} entries, ${SEED.reduce((n, e) => n + (e.when?.length ?? 0), 0)} rules): right ${s.right.length}/${total} occurrences (${pct(s.right.length, total)}, target ≥ ${TARGET.seed * 100} %: ${s.right.length / total >= TARGET.seed ? 'met' : 'NOT MET'}), ` +
				`distinct forms ${plain.filter((x) => x.item).length}/${plain.length}, ids reached ${new Set(s.right.map((x) => x.want)).size}/${Object.keys(C.key.ingredients).length}; ` +
				`wrong ${s.wrong.length}; merges ${s.merges.length}${s.merges.length ? ` (${s.merges.join('; ')})` : ''}; ambiguous uses resolved by a rule ${byRule.length}`
		);
		const left = new Map<string, number>();
		for (const x of xs) if (!x.item && x.expected !== AMBIGUOUS) left.set(x.o.name, (left.get(x.o.name) ?? 0) + 1);
		report.push(
			`    left unresolved (${left.size} forms): ${[...left]
				.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
				.map(([n, c]) => `${n} ${c}`)
				.join('; ')}`
		);
		expect(s.merges).toEqual([]);
		expect([...new Set(s.wrong.map((x) => `${x.o.name} → ${x.item} (${x.o.file})`))]).toEqual([]);
	});

	it('RA: disambiguation rules on the uses of ambiguous names — right, or left unresolved; never wrong', () => {
		const xs = run(registryResolver(SEED)).filter((x) => x.expected === AMBIGUOUS);
		const s = scored(run(registryResolver(SEED)));
		const ok = xs.filter((x) => x.item && x.want && s.idOf.get(x.item) === x.want);
		const bad = xs.filter((x) => x.item && (!x.want || s.idOf.get(x.item) !== x.want));
		const decidable = xs.filter((x) => x.want);
		report.push(
			`RA  ambiguous uses: ${xs.length} (${decidable.length} whose line says which id); resolved right ${ok.length} (${pct(ok.length, decidable.length)} of the decidable), wrong ${bad.length}, left unresolved ${xs.length - ok.length - bad.length}`
		);
		report.push(
			`    by name: ${Object.keys(C.key.ambiguous)
				.map((n) => {
					const u = xs.filter((x) => x.o.name === n);
					return `${n} ${u.filter((x) => ok.includes(x)).length}/${u.length}`;
				})
				.join(' · ')}`
		);
		expect(bad.map((x) => `${x.o.file} ${x.o.name} → ${x.item} (want ${x.want})`)).toEqual([]);
	});

	it('SN: the seed plus N resolve-queue actions', () => {
		// Each action: the most frequent unresolved name (by language and lookup
		// key) is linked to the seed entry standing for its id, or becomes a new
		// entry. Ambiguous names are not acted on: the queue settles them by a
		// rule or by `item:`, which this simulation does not model.
		const reg = new Map(SEED.map((e) => [e.slug, { ...e, names: { fr: [...e.names.fr], en: [...e.names.en] } }]));
		const total = C.occurrences.length;
		const at = new Map<number, number>();
		const reach = new Map<number, number>();
		let actions = 0;
		let wrongSeen = 0;
		let emptied: number | undefined;
		let s = scored([]);
		for (;;) {
			const xs = run(registryResolver([...reg.values()]));
			s = scored(xs);
			wrongSeen = Math.max(wrongSeen, s.wrong.length);
			const share = s.right.length / total;
			if ([0, 10, 25, 50, 100].includes(actions)) at.set(actions, s.right.length);
			for (const m of [0.9, 0.95]) if (share >= m && !reach.has(m)) reach.set(m, actions);
			if (actions >= 100 && reach.has(0.95)) break;
			const groups = new Map<string, Outcome[]>();
			for (const x of xs)
				if (x.item === null && x.expected !== AMBIGUOUS) {
					const k = `${x.o.lang}\0${lookupKey(x.o.name)}`;
					(groups.get(k) ?? groups.set(k, []).get(k)!).push(x);
				}
			if (!groups.size) {
				emptied = actions;
				break;
			}
			const [, top] = [...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
			const want = top[0].want!;
			const slug = [...s.idOf].find(([, id]) => id === want)?.[0] ?? `q-${want}`;
			const e = reg.get(slug) ?? reg.set(slug, { ...SEED[0], slug, names: { fr: [], en: [] }, when: [] }).get(slug)!;
			e.names[top[0].o.lang === 'en' ? 'en' : 'fr'].push(top[0].o.name);
			actions++;
		}
		report.push(
			`SN  seed + N queue actions, right occurrences: ${[...at].map(([n, r]) => `N=${n}: ${pct(r, total)}`).join(' · ')} ` +
				`(target ≥ ${TARGET.seedPlus.share * 100} % at N=${TARGET.seedPlus.actions}: ${(at.get(TARGET.seedPlus.actions) ?? 0) / total >= TARGET.seedPlus.share ? 'met' : 'NOT MET'}); ` +
				`90 % after ${reach.get(0.9) ?? '—'}, 95 % after ${reach.get(0.95) ?? '—'} actions; ` +
				`${emptied !== undefined ? `every non-ambiguous name resolved after ${emptied} actions (${pct(s.right.length, total)}); ` : ''}wrong ${wrongSeen}`
		);
		expect(wrongSeen).toBe(0);
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
	}, 20_000); // heavy; runs past the 5 s default under full-suite load

	it('T: no trap pair resolves to one entry of the fixture registry', () => {
		const dir = 'tests/fixtures/vault/ingredients';
		const reg = readdirSync(dir)
			.filter((f) => f.endsWith('.md'))
			.map((f) => parseIngredient(readFileSync(join(dir, f), 'utf8'), { fileStem: f.slice(0, -3) }).entry)
			.filter((e): e is RegistryEntry => !!e);
		type Line = string | { name: string; unit?: Unit; prep?: string; note?: string };
		const file = parse(readFileSync('tests/fixtures/resolve-traps.yaml', 'utf8')) as {
			rules?: Pick<RegistryEntry, 'slug' | 'when'>[];
			traps: ([Line, Line] | { pair: [Line, Line]; lang: string })[];
		};
		const extra = ruleRows(file.rules ?? []);
		const resolver = new Resolver(nameRows(reg, PLURALS), PLURALS, [], [...ruleRows(reg), ...extra]);
		const traps = file.traps.map((t) => (Array.isArray(t) ? { pair: t, lang: 'fr' } : t));
		const line = (l: Line) => (typeof l === 'string' ? { name: l } : l);
		const label = (l: Line) => (typeof l === 'string' ? l : [l.name, l.unit].filter(Boolean).join(' @'));
		const springs = (R: Resolver) => (t: { pair: [Line, Line]; lang: string }) => {
			const x = R.resolve(line(t.pair[0]), t.lang).item;
			return x !== null && x === R.resolve(line(t.pair[1]), t.lang).item;
		};
		const hit = traps.filter(springs(resolver));
		const seed = new Resolver(nameRows(SEED, PLURALS), PLURALS, [], [...ruleRows(SEED), ...extra]);
		const seedHit = traps.filter(springs(seed));
		const show = (t: { pair: [Line, Line] }) => t.pair.map(label).join(' / ');
		report.push(
			`T   ${hit.length}/${traps.length} trap pairs resolved to one entry of the fixture registry, ${seedHit.length}/${traps.length} of the seed` +
				`${[...hit, ...seedHit].length ? `: ${[...hit, ...seedHit].map(show).join('; ')}` : ''}`
		);
		expect(hit.map(show)).toEqual([]);
		expect(seedHit.map(show)).toEqual([]);
	});

	afterAll(() => {
		console.log(['', `Ingredient resolution — corpus of ${C.files.length} recipes, ${C.occurrences.length} names`, ...report, ''].join('\n'));
	});
});
