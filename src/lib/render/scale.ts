// Servings scaling: every quantity (ranges too) times one factor, shown the
// way a cook measures it. The rules are the vault's vocab/scaling.yaml
// (docs/VOCAB.md, "Scaling"); without them, amounts show exactly as before
// plan 05 (the exact value, a glyph within 2 %, else a decimal). Browser-safe.

import { UNIT_CLASS_OF, UNIT_CLASSES } from '../ingredients/types';
import { sizeNumber, type Conversions } from '../ingredients/units';
import { subRecipeFactor } from '../ingredients/cost';
import { formatNumber } from './fraction';
import { UNITS, type Ingredient, type Recipe, type Unit } from '../vault/types';

/** The factor for a target number of servings; 1 when the recipe gives none. */
export function scaleFactor(recipe: Pick<Recipe, 'servings'>, target: number): number {
	if (!recipe.servings || !target || target <= 0) return 1;
	return target / recipe.servings;
}

/** Multipliers offered when a recipe has no servings (a yield, a batch). */
export const MULTIPLIERS = [0.5, 1, 1.5, 2, 3] as const;

/** vocab/scaling.yaml, parsed: plain data, so a page load can carry it to the browser. */
export interface ScalingRules {
	/** Snap within this share of the exact amount; beyond it, a short decimal (unless `always`). */
	tolerance: number;
	/** Mark `≈` when the shown amount is further than this share from the exact one. */
	approx: number;
	/** What a link or a typed amount may ask for. */
	factor: { min: number; max: number };
	/** Per canonical unit, unit class or `default`: the fractions (0 < f < 1) an amount may show, ascending. */
	fractions: Record<string, number[]>;
	/** Units and classes that snap whatever the distance. */
	always: string[];
	/** Kitchen equivalences: one `into` is `per` of `unit`; step up into it from `from` of it (default: its smallest value). */
	ladder: { unit: Unit; into: Unit; per: number; from?: number }[];
	/** Units rounded by steps rather than fractions. */
	metric: { units: Unit[]; steps: { from: number; step: number }[] };
}

/** The fractions with a glyph (fraction.ts): the only ones a rule may name. */
export const GLYPH_FRACTIONS: [number, string][] = [
	[1 / 8, '⅛'],
	[1 / 4, '¼'],
	[1 / 3, '⅓'],
	[3 / 8, '⅜'],
	[1 / 2, '½'],
	[5 / 8, '⅝'],
	[2 / 3, '⅔'],
	[3 / 4, '¾'],
	[7 / 8, '⅞']
];

/** The caps when the file gives none: a stray `?fois=1e9` stays harmless. */
export const DEFAULT_FACTOR_CAP = { min: 0.1, max: 20 };

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isUnit = (u: unknown): u is Unit => typeof u === 'string' && (UNITS as readonly string[]).includes(u);
const KEYS = new Set<string>([...UNITS, ...Object.keys(UNIT_CLASSES), 'default']);

/** `1/4`, `0.25` → the glyph fraction it is, else undefined. */
function glyphFraction(v: unknown): number | undefined {
	let n: number | undefined;
	if (typeof v === 'number') n = v;
	else if (typeof v === 'string') {
		const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(v);
		if (m && Number(m[2]) > 0) n = Number(m[1]) / Number(m[2]);
	}
	if (n === undefined) return undefined;
	return GLYPH_FRACTIONS.find(([f]) => Math.abs(f - n!) < 1e-6)?.[0];
}

/**
 * Read vocab/scaling.yaml. Not a mapping (missing, broken): null, and every
 * amount shows as before. Otherwise each entry that reads is kept — canonical
 * units and classes, positive numbers, glyph fractions — and the rest dropped.
 */
export function parseScaling(data: unknown): ScalingRules | null {
	if (!isMap(data)) return null;
	const rules: ScalingRules = {
		tolerance: positive(data.tolerance) && data.tolerance < 1 ? data.tolerance : 0.1,
		approx: positive(data.approx) && data.approx < 1 ? data.approx : 0.02,
		factor: { ...DEFAULT_FACTOR_CAP },
		fractions: {},
		always: [],
		ladder: [],
		metric: { units: [], steps: [] }
	};
	if (isMap(data.factor)) {
		const { min, max } = data.factor;
		if (positive(min) && min <= 1) rules.factor.min = min;
		if (positive(max) && max >= 1) rules.factor.max = max;
	}
	if (isMap(data.fractions)) {
		for (const [k, list] of Object.entries(data.fractions)) {
			if (!KEYS.has(k)) continue;
			if (list === null) rules.fractions[k] = [];
			else if (Array.isArray(list)) {
				const fs = list.map(glyphFraction).filter((f): f is number => f !== undefined);
				rules.fractions[k] = [...new Set(fs)].sort((a, b) => a - b);
			}
		}
	}
	if (Array.isArray(data.always)) rules.always = data.always.filter((k): k is string => typeof k === 'string' && KEYS.has(k) && k !== 'default');
	if (Array.isArray(data.ladder)) {
		for (const r of data.ladder) {
			if (!isMap(r) || !isUnit(r.unit) || !isUnit(r.into) || r.unit === r.into || !positive(r.per)) continue;
			// Within one class only: never mass to volume.
			if (UNIT_CLASS_OF[r.unit] !== UNIT_CLASS_OF[r.into]) continue;
			if (rules.ladder.some((x) => x.unit === r.unit || x.into === r.into)) continue;
			const from = typeof r.from === 'string' ? (glyphFraction(r.from) ?? Number(r.from)) : r.from;
			rules.ladder.push(positive(from) ? { unit: r.unit, into: r.into, per: r.per, from } : { unit: r.unit, into: r.into, per: r.per });
		}
	}
	if (isMap(data.metric)) {
		const m = data.metric;
		if (Array.isArray(m.units)) rules.metric.units = m.units.filter(isUnit);
		if (Array.isArray(m.steps)) {
			rules.metric.steps = m.steps
				.filter((s): s is { from: number; step: number } => isMap(s) && typeof s.from === 'number' && s.from >= 0 && positive(s.step))
				.map((s) => ({ from: s.from, step: s.step }))
				.sort((a, b) => a.from - b.from);
		}
		if (!rules.metric.steps.length) rules.metric.units = [];
	}
	return rules;
}

// --- the scaled amount (Phase 2) ---------------------------------------------

/** One amount (or both ends of a range) as shown at a factor. */
export interface Scaled {
	/** The shown values: one, or two for a range whose ends differ. */
	values: number[];
	/** The shown unit: the written one, or another on its ladder. */
	unit?: Unit;
	/** The shown value is more than `approx` from the exact one: marked `≈`. */
	approx: boolean;
	/** Nothing measurable was close: a short decimal. */
	decimal: boolean;
	/** The ladder changed the unit. */
	moved: boolean;
	/** No rule applied (factor 1, no rules, a unit without fractions): the exact values, shown as before. */
	plain: boolean;
}

interface Snap {
	value: number;
	err: number;
	/** 0 within `approx`, 1 within `tolerance`, 2 beyond it but snapped (`always`, metric), 3 a decimal. */
	rank: 0 | 1 | 2 | 3;
}

const EPS = 1e-9;
const classOf = (u: Unit) => UNIT_CLASS_OF[u];

function fractionsFor(unit: Unit, rules: ScalingRules): number[] | undefined {
	return rules.fractions[unit] ?? rules.fractions[classOf(unit)] ?? rules.fractions.default;
}

const isMetric = (unit: Unit, rules: ScalingRules) => rules.metric.units.includes(unit);
const isAlways = (unit: Unit, rules: ScalingRules) => rules.always.includes(unit) || rules.always.includes(classOf(unit));

function metricStep(a: number, rules: ScalingRules): number {
	let step = rules.metric.steps[0].step;
	for (const s of rules.metric.steps) if (a + EPS >= s.from) step = s.step;
	return step;
}

/** The smallest value a unit shows: its smallest fraction, else 1, else the metric step. */
function minOf(unit: Unit, rules: ScalingRules): number | undefined {
	if (isMetric(unit, rules)) return rules.metric.steps[0].step;
	const fr = fractionsFor(unit, rules);
	return fr ? (fr[0] ?? 1) : undefined;
}

function rank(err: number, rules: ScalingRules): 0 | 1 | 2 {
	return err <= rules.approx + EPS ? 0 : err <= rules.tolerance + EPS ? 1 : 2;
}

/** The short decimal of plan 02: 2 digits below 10, 1 below 100, none above. */
const decimal = (a: number) => Number(a.toFixed(a < 10 ? 2 : a < 100 ? 1 : 0));

/** `a` in `unit` as the rules show it; undefined when the unit has no rule. */
function snap(a: number, unit: Unit, rules: ScalingRules): Snap | undefined {
	if (isMetric(unit, rules)) {
		const step = metricStep(a, rules);
		const value = Math.max(rules.metric.steps[0].step, Math.round(a / step) * step);
		const err = Math.abs(value - a) / a;
		return { value, err, rank: rank(err, rules) };
	}
	const fr = fractionsFor(unit, rules);
	if (!fr) return undefined;
	const whole = Math.floor(a + EPS);
	let best: number | undefined;
	for (const c of [whole, ...fr.map((f) => whole + f), whole + 1]) {
		if (c <= 0) continue;
		if (best === undefined || Math.abs(c - a) < Math.abs(best - a) - EPS) best = c;
	}
	const err = Math.abs(best! - a) / a;
	const r = rank(err, rules);
	if (r < 2 || isAlways(unit, rules)) return { value: best!, err, rank: r };
	const value = decimal(a);
	return { value, err: Math.abs(value - a) / a, rank: 3 };
}

/**
 * The written unit's ladder, smallest unit first: each with the factor from
 * the written unit, and the rung up from it (`per` of it make one of the next).
 */
function chainOf(unit: Unit, rules: ScalingRules): { unit: Unit; k: number; up?: ScalingRules['ladder'][number] }[] {
	const down: { unit: Unit; k: number }[] = [];
	let cur = unit;
	let k = 1;
	for (let r = rules.ladder.find((x) => x.into === cur); r && !down.some((d) => d.unit === r!.unit) && r.unit !== unit; r = rules.ladder.find((x) => x.into === cur)) {
		k *= r.per;
		cur = r.unit;
		down.unshift({ unit: cur, k });
	}
	const up: { unit: Unit; k: number }[] = [];
	cur = unit;
	k = 1;
	for (let r = rules.ladder.find((x) => x.unit === cur); r && !up.some((d) => d.unit === r!.into) && r.into !== unit; r = rules.ladder.find((x) => x.unit === cur)) {
		k /= r.per;
		cur = r.into;
		up.push({ unit: cur, k });
	}
	return [...down, { unit, k: 1 }, ...up].map((c) => ({ ...c, up: rules.ladder.find((x) => x.unit === c.unit) }));
}

const plainOf = (exact: number[], unit: Unit | undefined): Scaled => ({ values: exact, unit, approx: false, decimal: false, moved: false, plain: true });

/**
 * `values` (one amount, or a range's two ends) in `unit`, times `factor`, as
 * the rules show it (docs/VOCAB.md, "Scaling"): the ladder within the written
 * unit's family, the unit's fractions or metric steps, `≈` beyond `approx`.
 * Factor 1 and no rules give the exact values, flagged `plain`. A missing unit
 * is a bare count.
 */
export function scaleValues(values: number[], unit: Unit | undefined, factor: number, rules: ScalingRules | null | undefined): Scaled {
	const exact = values.map((v) => v * factor);
	if (factor === 1 || !rules || exact.some((x) => !(x > 0) || !Number.isFinite(x))) return plainOf(exact, unit);
	const written: Unit = unit ?? 'piece';
	const chain = chainOf(written, rules);
	const at = chain.findIndex((c) => c.unit === written);
	type Cand = { i: number; snaps: Snap[]; rank: number; err: number };
	const evaluate = (i: number): Cand | undefined => {
		const snaps = exact.map((x) => snap(x * chain[i].k, chain[i].unit, rules));
		if (snaps.some((s) => !s)) return undefined;
		const ss = snaps as Snap[];
		return { i, snaps: ss, rank: Math.max(...ss.map((s) => s.rank)), err: Math.max(...ss.map((s) => s.err)) };
	};
	const own = evaluate(at);
	if (!own) return plainOf(exact, unit);
	const lo = Math.min(...exact);
	const cands: Cand[] = [own];
	// Up: a larger unit once the amount reaches the rung's `from`, else the unit's smallest value.
	for (let i = at + 1; i < chain.length; i++) {
		const min = chain[i - 1].up?.from ?? minOf(chain[i].unit, rules);
		if (min === undefined || lo * chain[i].k + EPS < min) break;
		const c = evaluate(i);
		if (c) cands.push(c);
	}
	// Down: below the written unit's smallest value, or when nothing so far is
	// within the tolerance; never to as many of a smaller unit as make one of
	// the next (18 c. à table is a cup and more: the cup, rounded, shows).
	const ownMin = minOf(written, rules)!;
	if (lo + EPS < ownMin || Math.min(...cands.map((c) => c.rank)) >= 2) {
		for (let i = at - 1; i >= 0; i--) {
			if (Math.max(...exact) * chain[i].k + EPS >= chain[i].up!.per) break;
			const c = evaluate(i);
			if (c) cands.push(c);
		}
	}
	cands.sort((a, b) => {
		if (a.rank !== b.rank) return a.rank - b.rank;
		if (a.rank === 0) return b.i - a.i;
		if (a.rank === 3) return Math.abs(a.i - at) - Math.abs(b.i - at);
		return a.err - b.err || b.i - a.i;
	});
	const best = cands[0];
	const shown = best.snaps.map((s) => s.value);
	const one = shown.length === 2 && Math.abs(shown[0] - shown[1]) < EPS;
	return {
		values: one ? [shown[1]] : shown,
		unit: best.i === at ? unit : chain[best.i].unit,
		approx: best.snaps.some((s) => s.err > rules.approx + EPS),
		decimal: best.rank === 3,
		moved: best.i !== at,
		plain: false
	};
}

/** A shown value as text: whole plus a glyph (`1 ¼`), an integer (`335`), or a short decimal with a French comma. */
export function formatScaledNumber(v: number, isDecimal: boolean, lang: 'fr' | 'en'): string {
	if (!isDecimal) {
		const whole = Math.floor(v + EPS);
		const frac = v - whole;
		if (frac < EPS) return String(whole);
		const g = GLYPH_FRACTIONS.find(([f]) => Math.abs(f - frac) < 1e-6)?.[1];
		if (g) return whole ? `${whole} ${g}` : g;
	}
	const s = String(decimal(v));
	return lang === 'fr' ? s.replace('.', ',') : s;
}

/** Keep a factor inside the file's cap; anything else (0, NaN, 1e9) is no factor at all. */
export function capFactor(f: number, rules: ScalingRules | null | undefined): number | undefined {
	const cap = rules?.factor ?? DEFAULT_FACTOR_CAP;
	if (!Number.isFinite(f) || f <= 0) return undefined;
	if (f < cap.min - EPS || f > cap.max + EPS) return undefined;
	return f;
}

// --- servings and yield (Q7 A) -------------------------------------------------

/**
 * The servings at a factor (Q7 A): the lower bound, and the upper one of a
 * range, both scaled (the page joins them with its own word, « à »). At
 * factor 1, as written.
 */
export function servingsRange(recipe: Pick<Recipe, 'servings' | 'servingsMax'>, factor: number, lang: 'fr' | 'en'): { lo: string; hi?: string } {
	if (!recipe.servings) return { lo: '' };
	if (factor === 1) return { lo: formatNumber(recipe.servings, lang), hi: recipe.servingsMax ? String(recipe.servingsMax) : undefined };
	const lo = formatNumber(recipe.servings * factor, lang);
	const hi = recipe.servingsMax ? formatNumber(recipe.servingsMax * factor, lang) : undefined;
	return { lo, hi: hi === lo ? undefined : hi };
}

// A plain number or fraction at the start of a text yield, and nothing that
// makes it a range ("2 à 3 douzaines", "2-3 pots"): only that number scales.
const LEADING = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?\s*[½¼¾⅓⅔⅛]|\d+(?:[.,]\d+)?|[½¼¾⅓⅔⅛])(?=\s|$)/u;
const RANGE_AFTER = /^\s*(?:à|a|-|–|to|ou|or)\s*[\d½¼¾⅓⅔⅛]/iu;

/**
 * A text yield at a factor (Q7 A): its leading number scaled as a count, the
 * rest kept ("24 biscuits" → "36 biscuits"); `scaled` false when the text has
 * no such number (it then shows as written, with the factor beside it).
 */
export function scaleTextYield(text: string, factor: number, rules: ScalingRules | null | undefined, lang: 'fr' | 'en'): { text: string; scaled: boolean; approx: boolean } {
	if (factor === 1) return { text, scaled: true, approx: false };
	const m = LEADING.exec(text);
	const n = m ? sizeNumber(m[1]) : undefined;
	if (!m || n === undefined || n <= 0 || RANGE_AFTER.test(text.slice(m[0].length))) return { text, scaled: false, approx: false };
	const s = scaleValues([n], undefined, factor, rules);
	const shown = s.plain ? formatNumber(s.values[0], lang) : formatScaledNumber(s.values[0], s.decimal, lang);
	return { text: shown + text.slice(m[0].length), scaled: true, approx: s.approx };
}

// --- the amount in the address (Q1 A, Q8 B) ------------------------------------

/**
 * The factor a page address asks for: `?portions=8` (a recipe with servings)
 * or `?fois=1.5`, kept only inside the file's cap; anything else is 1.
 */
export function factorFromParams(params: URLSearchParams, recipe: Pick<Recipe, 'servings'>, rules: ScalingRules | null | undefined): number {
	return paramFactor(params, recipe, rules) ?? 1;
}

/** As `factorFromParams`, but undefined when the address asks for nothing valid (kitchen mode then resumes its session). */
export function paramFactor(params: URLSearchParams, recipe: Pick<Recipe, 'servings'>, rules: ScalingRules | null | undefined): number | undefined {
	const portions = plainNumber(params.get('portions'));
	if (portions !== undefined && recipe.servings) {
		const f = capFactor(portions / recipe.servings, rules);
		if (f !== undefined) return f;
	}
	const fois = plainNumber(params.get('fois'));
	return fois === undefined ? undefined : capFactor(fois, rules);
}

/** `8`, `1.5`, `1,5` — digits only: no `1e9`, no `0x10`, no sign. */
function plainNumber(s: string | null): number | undefined {
	return s !== null && /^\d+([.,]\d+)?$/.test(s.trim()) ? Number(s.trim().replace(',', '.')) : undefined;
}

/** A factor for an address: at most 4 decimals, no trailing zeros. */
const factorText = (f: number) => String(Number(f.toFixed(4)));

/**
 * The address parameter for a factor: `portions=N` when the recipe has
 * servings and the factor makes a whole number of them, else `fois=F`; none at
 * factor 1 unless `always` (the kitchen link always says how much, so an old
 * kitchen session never wins over the page).
 */
export function amountParam(recipe: Pick<Recipe, 'servings'>, factor: number, always = false): { key: 'portions' | 'fois'; value: string } | null {
	if (factor === 1 && !always) return null;
	if (recipe.servings) {
		const n = recipe.servings * factor;
		if (Math.abs(n - Math.round(n)) < 1e-9 && Math.round(n) >= 1) return { key: 'portions', value: String(Math.round(n)) };
	}
	return { key: 'fois', value: factorText(factor) };
}

/** `?portions=8`, `?fois=1.5` or '' — for a link. */
export function amountQuery(recipe: Pick<Recipe, 'servings'>, factor: number, always = false): string {
	const p = amountParam(recipe, factor, always);
	return p ? `?${p.key}=${p.value}` : '';
}

/**
 * A typed amount (« j'ai 3 », « 2,5 », « 1 1/2 », « ½ ») as a number, or
 * undefined. The factor is then typed ÷ written (Q8 B).
 */
export function readAmount(text: string): number | undefined {
	const t = text.trim();
	if (!t) return undefined;
	const n = sizeNumber(t);
	return n !== undefined && Number.isFinite(n) && n > 0 ? n : undefined;
}

// --- sub-recipes (Q5 A) --------------------------------------------------------

/** What of a sub-recipe the recipe page and kitchen mode need to scale it: plain data. */
export type SubScaleRecipe = Pick<Recipe, 'slug' | 'yield' | 'servings' | 'servingsMax'>;

/**
 * The factor a sub-recipe is read at from one line that uses it, at the
 * parent's `factor` (Q5 A): the cost rule (`subRecipeFactor`, plan 03 Q16 A —
 * the line's amount against the sub-recipe's `yield` object in the same unit
 * or class) times the factor, kept inside the file's cap. Undefined when the
 * rule cannot scale it (a text yield, a unit of another class): the
 * sub-recipe then shows as written, with its yield.
 */
export function subRecipeScale(item: Ingredient, sub: SubScaleRecipe, conv: Conversions, factor: number, rules: ScalingRules | null | undefined): number | undefined {
	const f = subRecipeFactor(item, sub, conv);
	if (f === undefined) return undefined;
	const at = f * factor;
	// A factor within rounding of 1 is the recipe as written.
	if (Math.abs(at - 1) < 1e-9) return 1;
	return capFactor(at, rules);
}

/** The sub-recipe's link from a line: its page at the derived amount when scalable (`/r/pate-brisee?fois=0.5`), else its page. */
export function subRecipeHref(item: Ingredient, sub: SubScaleRecipe | undefined, conv: Conversions, factor: number, rules: ScalingRules | null | undefined): string {
	const base = `/r/${item.recipe}`;
	if (!sub) return base;
	const f = subRecipeScale(item, sub, conv, factor, rules);
	return f === undefined ? base : base + amountQuery(sub, f);
}
