// Servings scaling: every quantity (ranges too) times one factor, shown the
// way a cook measures it. The rules are the vault's vocab/scaling.yaml
// (docs/VOCAB.md, "Scaling"); without them, amounts show exactly as before
// plan 05 (the exact value, a glyph within 2 %, else a decimal). Browser-safe.

import { UNIT_CLASS_OF, UNIT_CLASSES } from '../ingredients/types';
import { UNITS, type Recipe, type Unit } from '../vault/types';

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
	/** Kitchen equivalences: one `into` is `per` of `unit`. */
	ladder: { unit: Unit; into: Unit; per: number }[];
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
			rules.ladder.push({ unit: r.unit, into: r.into, per: r.per });
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
