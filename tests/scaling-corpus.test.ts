// Scaling over the invented card corpus and the fixture vault (plan 05). The
// hard gate: at factor 1 every recipe displays exactly what it displayed before
// scaling was built (tests/fixtures/scaling-baseline.txt), with the seed rules
// and without. The sweep: every amount of the 320 cards at ½, ⅔, 4/3, 1.5, 2
// and 3 is one the vault's cups and spoons measure, or marked ≈, or metric
// rounded. Public test data: runs in the normal suite. Counts are printed for
// the report.

import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { BASELINE, displayLines, loadDisplayRecipes, unitWordLines } from './helpers/display';
import { parseScaling, scaleValues, type Scaled } from '../src/lib/render/scale';
import { ingredientParts } from '../src/lib/render/ingredient';
import { stepAmounts } from '../src/lib/render/stepamounts';
import { parseBody } from '../src/lib/vault/body';
import { UNIT_CLASS_OF } from '../src/lib/ingredients/types';
import { seedVocab } from '../src/lib/server/vault';
import type { Ingredient, Unit } from '../src/lib/vault/types';

const recipes = loadDisplayRecipes();
const corpus = recipes.filter((r) => r.file.startsWith('corpus/'));
const RULES = parseScaling(parse(seedVocab(readFileSync('docs/VOCAB.md', 'utf8'))['scaling.yaml'], { version: '1.2' }))!;
const FACTORS = [1 / 2, 2 / 3, 1, 4 / 3, 3 / 2, 2, 3];

function sameAsBaseline(text: string): string[] {
	const want = readFileSync(BASELINE, 'utf8').split('\n');
	const got = text.split('\n');
	const diff = got.map((l, i) => (l === want[i] ? null : `- ${want[i]}\n+ ${l}`)).filter((x): x is string => x !== null);
	if (got.length !== want.length) diff.push(`lines: ${got.length} ≠ ${want.length}`);
	return diff;
}

describe('scaling harness (plan 05, Phase 0)', () => {
	it('reads every corpus card and fixture recipe', () => {
		expect(corpus).toHaveLength(320);
		expect(recipes.filter((r) => r.file.startsWith('vault/')).length).toBeGreaterThanOrEqual(20);
	});

	it('the scaling table reads', () => {
		const table = parse(readFileSync('tests/fixtures/scaling.yaml', 'utf8'), { version: '1.2' }) as { cases: unknown[]; lines: unknown[] };
		expect(table.cases.length).toBeGreaterThan(40);
		expect(table.lines.length).toBeGreaterThan(5);
	});

	it('factor 1 displays exactly the baseline, with the seed rules and without', () => {
		for (const rules of [RULES, null]) {
			const text = [...unitWordLines(), ...recipes.flatMap((l) => displayLines(l, { factor: 1, rules }))].join('\n') + '\n';
			expect(sameAsBaseline(text).slice(0, 10)).toEqual([]);
		}
	});
});

describe('corpus sweep (plan 05, Phase 2)', () => {
	type Amount = { values: number[]; unit?: Unit; where: string };
	/** Every amount of a recipe: qty (with qty_max), alt, `or` amounts, the yield object. */
	function amounts(l: (typeof recipes)[number]): Amount[] {
		const out: Amount[] = [];
		const visit = (it: Ingredient, where: string) => {
			if (it.qty) out.push({ values: it.qtyMax ? [it.qty.value, it.qtyMax.value] : [it.qty.value], unit: it.unit, where });
			if (it.alt) out.push({ values: it.alt.qtyMax ? [it.alt.qty.value, it.alt.qtyMax.value] : [it.alt.qty.value], unit: it.alt.unit, where: `${where}.alt` });
			it.or?.forEach((o, j) => visit(o, `${where}.or[${j}]`));
		};
		l.recipe.ingredients.forEach((g, gi) => g.items.forEach((it, ii) => visit(it, `${l.file} ingredients[${gi}].items[${ii}]`)));
		const y = l.recipe.yield;
		if (y && typeof y === 'object' && y.qty) out.push({ values: y.qtyMax ? [y.qty.value, y.qtyMax.value] : [y.qty.value], unit: y.unit, where: `${l.file} yield` });
		return out;
	}
	const all = corpus.flatMap(amounts);

	const LADDER_TO_BASE: Partial<Record<Unit, number>> = { tsp: 1, tbsp: 3, cup: 48, g: 1, kg: 1000, ml: 1, l: 1000 };
	/** The shown amount in the written unit, through the seed ladder. */
	function inWritten(s: Scaled, written: Unit | undefined, v: number): number {
		if (!s.unit || !written || s.unit === written) return v;
		return (v * LADDER_TO_BASE[s.unit]!) / LADDER_TO_BASE[written]!;
	}

	it('every shown value is measurable, within the tolerance or marked ≈', () => {
		const bad: string[] = [];
		const counts = new Map<string, { n: number; approx: number; moved: number; decimal: number }>();
		const t0 = performance.now();
		for (const f of FACTORS) {
			if (f === 1) continue;
			for (const a of all) {
				const s = scaleValues(a.values, a.unit, f, RULES);
				const cls = a.unit ? UNIT_CLASS_OF[a.unit] : 'count';
				const c = counts.get(cls) ?? { n: 0, approx: 0, moved: 0, decimal: 0 };
				c.n++;
				if (s.approx) c.approx++;
				if (s.moved) c.moved++;
				if (s.decimal) c.decimal++;
				counts.set(cls, c);
				const shownUnit = s.unit ?? 'piece';
				if (s.plain) bad.push(`${a.where} ×${f}: no rule`);
				if (s.decimal && ['cup', 'tbsp', 'tsp'].includes(shownUnit)) bad.push(`${a.where} ×${f}: decimal on a ${shownUnit} line`);
				// No fraction outside the unit's list.
				if (!s.decimal && !RULES.metric.units.includes(shownUnit)) {
					const list = RULES.fractions[shownUnit] ?? RULES.fractions[UNIT_CLASS_OF[shownUnit]] ?? RULES.fractions.default;
					for (const v of s.values) {
						const frac = v - Math.floor(v + 1e-9);
						if (frac > 1e-9 && !list.some((x) => Math.abs(x - frac) < 1e-6)) bad.push(`${a.where} ×${f}: ${v} ${shownUnit} outside its fractions`);
					}
				}
				// Within the tolerance of the exact, unless marked.
				if (!s.approx) {
					const exact = a.values.map((v) => v * f);
					const shown = s.values.map((v) => inWritten(s, a.unit, v));
					const ends = shown.length === exact.length ? exact : [exact.at(-1)!];
					shown.forEach((v, i) => {
						if (Math.abs(v - ends[i]) / ends[i] > RULES.tolerance + 1e-9) bad.push(`${a.where} ×${f}: ${v} for ${ends[i]} unmarked`);
					});
				}
				// Mass and volume never cross.
				if (a.unit && s.unit) expect(UNIT_CLASS_OF[s.unit]).toBe(UNIT_CLASS_OF[a.unit]);
			}
		}
		const ms = performance.now() - t0;
		console.log(`scaling sweep: ${all.length} amounts × ${FACTORS.length - 1} factors in ${ms.toFixed(0)} ms`);
		for (const [cls, c] of [...counts].sort()) console.log(`  ${cls.padEnd(9)} ${String(c.n).padStart(5)} shown, ≈ ${c.approx}, ladder ${c.moved}, decimal ${c.decimal}`);
		expect(bad.slice(0, 20)).toEqual([]);
	});

	it('every line of every card renders at every factor, under 2 s', () => {
		const t0 = performance.now();
		let lines = 0;
		for (const f of FACTORS)
			for (const l of corpus)
				for (const g of l.recipe.ingredients)
					for (const it of g.items) {
						const parts = ingredientParts(it, { factor: f, lang: l.recipe.lang, rules: RULES });
						expect(parts.length).toBeGreaterThan(0);
						lines++;
					}
		const ms = performance.now() - t0;
		console.log(`scaling render: ${lines} lines in ${ms.toFixed(0)} ms`);
		expect(ms).toBeLessThan(2000);
	});
});

describe('step amounts over the corpus (plan 05, Phase 4)', () => {
	it('every step of the 320 cards scanned: amounts found, none a temperature, a duration or a pan', () => {
		const perClass = new Map<string, number>();
		let steps = 0;
		let found = 0;
		let steppy = 0;
		const nearPan: string[] = [];
		const bad: string[] = [];
		const t0 = performance.now();
		for (const l of corpus) {
			for (const s of parseBody(l.body).body.steps) {
				steps++;
				const as = stepAmounts(s.text, { factor: 2, lang: l.recipe.lang, rules: RULES });
				if (as.length) steppy++;
				for (const a of as) {
					found++;
					const cls = UNIT_CLASS_OF[a.unit];
					perClass.set(`${cls}:${a.unit}`, (perClass.get(`${cls}:${a.unit}`) ?? 0) + 1);
					// What must never scale: °F/°C, a duration, a pan size.
					if (/°|\b(?:min|h|heures?|minutes?|hours?)\b|\d\s*[x×]\s*\d/iu.test(a.text)) bad.push(`${l.file}: ${a.text}`);
					// A sentence about a pan, a bowl or the oven: reported, for the flagged misreads.
					const sentence = s.text.slice(Math.max(0, s.text.lastIndexOf('.', a.start) + 1), s.text.indexOf('.', a.end) === -1 ? undefined : s.text.indexOf('.', a.end));
					if (/moule|plat|bol|casserole|four|°|pan|dish|bowl|oven/iu.test(sentence)) nearPan.push(`${l.file}: ${a.text} in « ${sentence.trim()} »`);
				}
			}
		}
		const ms = performance.now() - t0;
		console.log(`step amounts: ${found} in ${steppy} of ${steps} steps of ${corpus.length} cards, ${ms.toFixed(0)} ms`);
		for (const [k, n] of [...perClass].sort()) console.log(`  ${k.padEnd(14)} ${n}`);
		console.log(`  in a sentence about a pan, bowl or oven: ${nearPan.length}`);
		for (const x of nearPan.slice(0, 10)) console.log(`    ${x}`);
		expect(bad).toEqual([]);
		expect(found).toBeGreaterThan(0);
	});
});
