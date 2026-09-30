// Amounts written inside step text ("Ajouter 1 tasse de lait chaud"), shown
// scaled beside the original when a recipe is read at another amount (plan 05,
// Q6 B). The original always stays: a misread ("un bol de 2 L") is then seen
// as such. Found with the vocabulary's unit words (the E216 grammar,
// `findAllQtyUnits`), `lang`-aware for `t`/`T`. Temperatures (°F, °C),
// durations and pan sizes (`9 x 13 po`) use no recipe unit and are never
// found. Only measures (mass and volume) are read: a count in a step is more
// often a shape than an amount (« couper en 8 tranches », « en 2 abaisses »).
// Browser-safe.

import { sizeNumber } from '../ingredients/units';
import { UNIT_CLASS_OF } from '../ingredients/types';
import { findAllQtyUnits, unitForAlias } from '../vault/vocab';
import type { Lang, Unit } from '../vault/types';
import { amountView } from './ingredient';
import type { ScalingRules } from './scale';

export interface StepAmount {
	/** Offsets of the amount as written (a range from its first number). */
	start: number;
	end: number;
	/** The amount as written. */
	text: string;
	/** The amount at the factor, in the vault's unit words (`2 tasses`, `≈ 1 ¼ tasse`). */
	scaled: string;
	approx: boolean;
	unit: Unit;
}

export interface StepScale {
	factor: number;
	lang: Lang;
	rules?: ScalingRules | null;
}

// A number and « à », « - », « to », « ou » right before an amount: the low end
// of a range (« 2 à 3 tasses »). Connector words are the same the text-yield
// and duration readers take.
const RANGE_LOW = /(?<![\p{L}\p{N}.,])(\d+(?:[.,]\d+)?|\d+\/\d+|\d+\s+\d+\/\d+|[½¼¾⅓⅔⅛])\s*(?:à|-|–|to|ou|or)\s*$/iu;

/**
 * Every measure written in a step, with its value at `factor`. Nothing at
 * factor 1: the step shows as written.
 */
export function stepAmounts(text: string, { factor, lang, rules }: StepScale): StepAmount[] {
	if (factor === 1 || !(factor > 0)) return [];
	const out: StepAmount[] = [];
	for (const m of findAllQtyUnits(text)) {
		const unit = unitForAlias(m.unitText, lang);
		if (!unit) continue;
		const cls = UNIT_CLASS_OF[unit];
		if (cls !== 'mass' && cls !== 'volume') continue;
		const value = sizeNumber(m.qty);
		if (value === undefined || !(value > 0)) continue;
		let start = m.start;
		let lo: number | undefined;
		const before = RANGE_LOW.exec(text.slice(0, m.start));
		if (before) {
			const n = sizeNumber(before[1]);
			if (n !== undefined && n > 0 && n < value) {
				lo = n;
				start = m.start - before[0].length;
			}
		}
		const view = amountView(lo === undefined ? { qty: { value }, unit } : { qty: { value: lo }, qtyMax: { value }, unit }, { factor, lang, rules });
		out.push({ start, end: m.end, text: text.slice(start, m.end), scaled: view.approx ? `≈ ${view.text}` : view.text, approx: view.approx, unit });
	}
	return out;
}
