// The measuring system an account reads amounts in (../prefs.ts; docs/VOCAB.md,
// "Measuring systems"): as written, metric (ml, g) or imperial (cups, spoons,
// lb, oz). Only what is shown changes: the file keeps the amount as the card
// has it. The factors are the vault's vocab/conversions.yaml, the same the
// cost uses; the rounding is vocab/scaling.yaml's (./scale.ts). A unit with no
// factor (a pinch, a clove, a can) is never converted. Browser-safe.

import { UNIT_CLASS_OF } from '../ingredients/types';
import { NO_CONVERSIONS, type Conversions } from '../ingredients/units';
import type { UnitSystem } from '../prefs';
import type { Unit } from '../vault/types';

let current: Conversions = NO_CONVERSIONS;

/** Install the vault's conversions (the root layout, on every page; the server hook; tests). */
export function setConversions(conv: Conversions | null | undefined): void {
	current = conv ?? NO_CONVERSIONS;
}

/** The conversions in use. */
export function conversions(): Conversions {
	return current;
}

/** The units each system measures in: an amount already in one of them stays as written. */
const NATIVE: Record<Exclude<UnitSystem, 'written'>, readonly Unit[]> = {
	metric: ['g', 'kg', 'ml', 'cl', 'l'],
	imperial: ['cup', 'tbsp', 'tsp', 'qt', 'pint', 'lb', 'oz']
};

/** True when `unit` is one the system measures in (or the system is `written`). */
export function isNative(unit: Unit, system: UnitSystem): boolean {
	return system === 'written' || NATIVE[system].includes(unit);
}

/**
 * `values` of `unit` in the system: the values and the unit to show, before
 * rounding (the scaling ladder then moves `ml` to `L`, `c. à thé` to `c. à
 * table`). Undefined when there is nothing to convert: the system is
 * `written`, the unit is already the system's, or the vault has no factor.
 *
 * Metric: millilitres and grams. Imperial: the largest of cup, tablespoon and
 * teaspoon that the amount fills a quarter of (a cup), or one of (a spoon);
 * pounds from one pound, else ounces.
 */
export function inSystem(values: number[], unit: Unit | undefined, system: UnitSystem, conv: Conversions = current): { values: number[]; unit: Unit } | undefined {
	if (!unit || system === 'written' || isNative(unit, system)) return undefined;
	const cls = UNIT_CLASS_OF[unit];
	if (cls !== 'mass' && cls !== 'volume') return undefined;
	const factors = cls === 'mass' ? conv.mass : conv.volume;
	const per = factors[unit];
	if (!per) return undefined;
	const base = values.map((v) => v * per);
	if (system === 'metric') return { values: base, unit: cls === 'mass' ? 'g' : 'ml' };
	const least = Math.min(...base);
	const steps: [Unit, number][] = cls === 'mass' ? [['lb', 1], ['oz', 0]] : [['cup', 0.25], ['tbsp', 1], ['tsp', 0]];
	for (const [target, from] of steps) {
		const k = factors[target];
		if (k && least >= k * from - 1e-9) return { values: base.map((v) => v / k), unit: target };
	}
	return undefined;
}
