// The scaled amount (plan 05, Phase 2) against the hand-written table
// (tests/fixtures/scaling.yaml) and the seed rules of docs/VOCAB.md.

import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { amountParam, amountQuery, capFactor, factorFromParams, paramFactor, parseScaling, readAmount, scaleTextYield, scaleValues, servingsRange, servingsStep, type ScalingRules } from '../../src/lib/render/scale';
import { formatAmount, ingredientParts, ingredientText } from '../../src/lib/render/ingredient';
import { seedVocab } from '../../src/lib/server/vault';
import { parseQuantity } from '../../src/lib/vault/quantity';
import type { Ingredient, Lang, Unit } from '../../src/lib/vault/types';

export const SEED_RULES = parseScaling(parse(seedVocab(readFileSync('docs/VOCAB.md', 'utf8'))['scaling.yaml'], { version: '1.2' }))!;

const q = (raw: number | string) => {
	const p = parseQuantity(raw);
	if (!p.ok) throw new Error(`bad qty ${raw}`);
	return { raw, value: p.value };
};
const factorOf = (f: number | string) => {
	if (typeof f === 'number') return f;
	const [a, b] = f.split('/').map(Number);
	return a / b;
};

interface Case {
	qty: number | string;
	qty_max?: number | string;
	unit: Unit;
	factor: number | string;
	lang?: Lang;
	text: string;
}
interface LineCase {
	line: Record<string, unknown>;
	factor: number | string;
	text: string;
}
const table = parse(readFileSync('tests/fixtures/scaling.yaml', 'utf8'), { version: '1.2' }) as { cases: Case[]; lines: LineCase[] };

/** A table line as the checker builds it: snake_case keys, quantities parsed. */
function line(l: Record<string, unknown>): Ingredient {
	const it: Record<string, unknown> = { ...l };
	if (l.qty !== undefined) it.qty = q(l.qty as number);
	if (l.to_taste) {
		it.toTaste = true;
		delete it.to_taste;
	}
	if (l.alt) {
		const a = l.alt as { qty: number; unit: Unit };
		it.alt = { qty: q(a.qty), unit: a.unit };
	}
	if (l.or) it.or = (l.or as Record<string, unknown>[]).map(line);
	return it as unknown as Ingredient;
}

describe('the scaling table', () => {
	it.each(table.cases.map((c) => [`${c.qty}${c.qty_max ? `–${c.qty_max}` : ''} ${c.unit} × ${c.factor}`, c] as const))('%s', (_, c) => {
		const amount = { qty: q(c.qty), qtyMax: c.qty_max !== undefined ? q(c.qty_max) : undefined, unit: c.unit };
		expect(formatAmount(amount, { factor: factorOf(c.factor), lang: c.lang ?? 'fr', rules: SEED_RULES })).toBe(String(c.text));
	});

	it.each(table.lines.map((c) => [c.text, c] as const))('%s', (_, c) => {
		expect(ingredientText(line(c.line), { factor: factorOf(c.factor), lang: 'fr', rules: SEED_RULES })).toBe(c.text);
	});
});

describe('scaleValues', () => {
	it('factor 1 and no rules are plain: the exact values', () => {
		expect(scaleValues([2 / 3], 'cup', 1, SEED_RULES)).toMatchObject({ values: [2 / 3], plain: true, approx: false });
		expect(scaleValues([2 / 3], 'cup', 1.25, null)).toMatchObject({ values: [2 / 3 * 1.25], plain: true });
		// Without rules the display is today's: a decimal where no glyph is within 2 %.
		expect(formatAmount({ qty: q('2/3'), unit: 'cup' }, { factor: 1.25, lang: 'fr' })).toBe('0,83 tasse');
	});

	it('never crosses mass and volume, nor lb and g', () => {
		for (const [unit, f] of [
			['lb', 3],
			['oz', 0.5],
			['cup', 0.1],
			['g', 7]
		] as [Unit, number][]) {
			const s = scaleValues([1], unit, f, SEED_RULES);
			const cls = (u?: Unit) => (['g', 'kg', 'lb', 'oz'].includes(u!) ? 'mass' : 'other');
			expect(cls(s.unit)).toBe(cls(unit));
			if (unit === 'lb' || unit === 'oz') expect(s.unit).toBe(unit);
		}
	});

	it('alt and main amount round separately, each within the tolerance of the exact', () => {
		const rules: ScalingRules = SEED_RULES;
		for (const f of [0.5, 2 / 3, 4 / 3, 1.5, 2, 3]) {
			const main = scaleValues([250], 'ml', f, rules);
			const alt = scaleValues([1], 'cup', f, rules);
			const ml = main.values[0] * (main.unit === 'l' ? 1000 : 1);
			const cups = alt.values[0] * (alt.unit === 'tbsp' ? 1 / 16 : alt.unit === 'tsp' ? 1 / 48 : 1);
			expect(Math.abs(ml - 250 * f) / (250 * f)).toBeLessThanOrEqual(0.1);
			expect(Math.abs(cups - f) / f).toBeLessThanOrEqual(0.1);
		}
	});

	it('the marker, the approx part and the amount stay apart', () => {
		const parts = ingredientParts({ qty: q('1 [?]'), unit: 'piece', name: 'œuf' }, { factor: 4 / 3, lang: 'fr', rules: SEED_RULES });
		expect(parts.slice(0, 3)).toEqual([
			{ kind: 'approx', text: '≈ ' },
			{ kind: 'amount', text: '1 ½', base: { value: 1, unit: 'piece' } },
			{ kind: 'text', text: ' [?]' }
		]);
	});

	it('untouched at any factor: to_taste, no qty, note, prep, brand, optional', () => {
		const it_: Ingredient = { name: 'sel', toTaste: true };
		expect(ingredientText(it_, { factor: 3, lang: 'fr', rules: SEED_RULES })).toBe('sel, au goût');
		expect(ingredientText({ name: 'persil', note: '1 botte', prep: 'haché', optional: true }, { factor: 3, lang: 'fr', rules: SEED_RULES })).toBe(
			'persil haché (1 botte) (facultatif)'
		);
		expect(ingredientText({ qty: q(1), unit: 'can', name: 'lait', brand: 'Carnation', note: '385 ml' }, { factor: 2, lang: 'fr', rules: SEED_RULES })).toBe(
			'2 boîtes de lait Carnation (385 ml)'
		);
	});
});

describe('capFactor', () => {
	it('keeps a factor inside the cap, drops anything else', () => {
		expect(capFactor(1.5, SEED_RULES)).toBe(1.5);
		expect(capFactor(20, SEED_RULES)).toBe(20);
		expect(capFactor(0.1, SEED_RULES)).toBe(0.1);
		for (const f of [0, -1, NaN, Infinity, 1e9, 0.01, 21]) expect(capFactor(f, SEED_RULES)).toBeUndefined();
		expect(capFactor(15, null)).toBe(15);
	});
});

describe('servingsStep (review: − disabled at the cap’s minimum)', () => {
	it('moves to the next whole number inside the cap, else nothing', () => {
		// servings 24, default cap min 0.1: 3 → 2 would be 0.083.
		expect(servingsStep(3, 24, -1, null)).toBeUndefined();
		expect(servingsStep(4, 24, -1, null)).toEqual({ servings: 3, factor: 0.125 });
		expect(servingsStep(1, 4, -1, null)).toBeUndefined();
		expect(servingsStep(7.5, 4, -1, null)).toEqual({ servings: 7, factor: 1.75 });
		expect(servingsStep(7.5, 4, 1, null)).toEqual({ servings: 8, factor: 2 });
		const tight: ScalingRules = { ...parseScaling(parse(seedVocab(readFileSync('docs/VOCAB.md', 'utf8'))['scaling.yaml'], { version: '1.2' }))!, factor: { min: 0.5, max: 2 } };
		expect(servingsStep(4, 4, 1, tight)).toEqual({ servings: 5, factor: 1.25 });
		expect(servingsStep(8, 4, 1, tight)).toBeUndefined();
		expect(servingsStep(2, 4, -1, tight)).toBeUndefined();
		expect(servingsStep(3, 4, -1, tight)).toEqual({ servings: 2, factor: 0.5 });
	});
});

describe('servings and yield (Q7 A)', () => {
	it('a servings range scales at both ends; factor 1 is as written', () => {
		expect(servingsRange({ servings: 6, servingsMax: 8 }, 1, 'fr')).toEqual({ lo: '6', hi: '8' });
		expect(servingsRange({ servings: 6, servingsMax: 8 }, 2, 'fr')).toEqual({ lo: '12', hi: '16' });
		expect(servingsRange({ servings: 4 }, 1.5, 'fr')).toEqual({ lo: '6', hi: undefined });
		expect(servingsRange({ servings: 6, servingsMax: 8 }, 1 / 6, 'fr')).toEqual({ lo: '1', hi: '1 ⅓' });
	});

	it('a text yield’s leading number scales as a count, the rest kept', () => {
		const y = (text: string, f: number) => scaleTextYield(text, f, SEED_RULES, 'fr');
		expect(y('24 biscuits', 1)).toEqual({ text: '24 biscuits', scaled: true, approx: false });
		expect(y('24 biscuits', 2)).toEqual({ text: '48 biscuits', scaled: true, approx: false });
		expect(y('3 douzaines', 0.5)).toEqual({ text: '1 ½ douzaines', scaled: true, approx: false });
		expect(y('4 pots de 500 ml', 1.5)).toEqual({ text: '6 pots de 500 ml', scaled: true, approx: false });
		expect(y('1 moule de 8 x 8', 4 / 3).approx).toBe(true);
		// Nothing to read: shown as written, the page adds the factor.
		expect(y('environ 4 litres', 2)).toEqual({ text: 'environ 4 litres', scaled: false, approx: false });
		expect(y('2 à 3 douzaines', 2)).toMatchObject({ scaled: false });
		expect(y('2-3 pots', 2)).toMatchObject({ scaled: false });
		expect(y('12muffins', 2)).toMatchObject({ scaled: false });
	});
});

describe('the amount in the address (Q1 A)', () => {
	const p = (q: string) => new URLSearchParams(q);
	const four = { servings: 4 };
	it('reads portions, then fois, inside the cap', () => {
		expect(factorFromParams(p('portions=8'), four, SEED_RULES)).toBe(2);
		expect(factorFromParams(p('fois=1.5'), four, SEED_RULES)).toBe(1.5);
		expect(factorFromParams(p('fois=1,5'), {}, SEED_RULES)).toBe(1.5);
		expect(factorFromParams(p('portions=6&fois=3'), four, SEED_RULES)).toBe(1.5);
		// portions means nothing without servings: fois is read.
		expect(factorFromParams(p('portions=6&fois=3'), {}, SEED_RULES)).toBe(3);
	});
	it('ignores anything else: 1, and undefined for kitchen mode', () => {
		for (const q of ['', 'portions=0', 'portions=-2', 'fois=abc', 'portions=1e9', 'fois=1e9', 'fois=0x10', 'fois=Infinity', 'fois=0', 'portions=400', 'fois=0.01', 'fois=']) {
			expect(factorFromParams(p(q), four, SEED_RULES), q).toBe(1);
			expect(paramFactor(p(q), four, SEED_RULES), q).toBeUndefined();
		}
	});
	it('writes portions when whole, else fois; nothing at 1 unless asked', () => {
		expect(amountParam(four, 1)).toBeNull();
		expect(amountQuery(four, 1, true)).toBe('?portions=4');
		expect(amountQuery(four, 1.5)).toBe('?portions=6');
		expect(amountQuery(four, 1.3)).toBe('?fois=1.3');
		expect(amountQuery({}, 2 / 3)).toBe('?fois=0.6667');
		expect(amountQuery({}, 1, true)).toBe('?fois=1');
		// Written then read: the same amounts.
		for (const f of [0.5, 2 / 3, 1.25, 3, 7])
			expect(factorFromParams(p(amountQuery(four, f).slice(1)), four, SEED_RULES)).toBeCloseTo(f, 3);
	});
	it('reads a typed amount', () => {
		expect(readAmount('3')).toBe(3);
		expect(readAmount(' 2,5 ')).toBe(2.5);
		expect(readAmount('1 1/2')).toBe(1.5);
		expect(readAmount('½')).toBe(0.5);
		for (const s of ['', 'abc', '0', '-1']) expect(readAmount(s), s).toBeUndefined();
	});
});
