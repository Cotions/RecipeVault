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
// `1-1/2` (a mixed number as cards write it) is read whole, never as `1/2`.
const RANGE_LOW = /(?<![\p{L}\p{N}.,/-])(\d+-\d+\/\d+|\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?|[½¼¾⅓⅔⅛])\s*(?:à|-|–|to|ou|or)\s*$/iu;
// A number that labels rather than measures: « Étape 1 - 2 tasses », « Step 2 –
// 3 cups », « n° 1 - 2 tasses », « #1 - 2 cups ». Such a number is never the low
// end of a range: the amount is the one after it alone. Without such a word a
// spaced dash still reads as a range (« 2 - 3 tasses »), as cards write it.
const LABEL = /(?:^|[^\p{L}\p{N}])(?:[ée]tapes?|steps?|n[°º]|no\.|nos\.|num[ée]ros?|#)\s*$/iu;

// The bare cup alias (`c.`, `t.`) at the start of a longer spoon abbreviation
// the vocabulary does not list (« c. à t. », « c. thé », « c. soupe ») or of
// « à la fois »: not a cup. Such an amount is left unmarked rather than read
// as cups.
const BARE_CUP = /^[ct]\.?$/i;
const SPOON_REST = /^\s*(?:(?:à|a)(?![\p{L}\p{N}])|th[ée]|table|soupe|caf[ée]|[st]\.|[st](?![\p{L}\p{N}]))/iu;
// A fraction after the unit, the Québec way of writing 1 ½ (« 1 tasse 1/2 »).
const TRAILING_FRACTION = /^\s+(\d+\/\d+|[½¼¾⅓⅔⅛])(?![\p{L}\p{N}/])/u;

/**
 * Every measure written in a step, with its value at `factor`. Nothing at
 * factor 1: the step shows as written.
 */
export function stepAmounts(text: string, { factor, lang, rules }: StepScale): StepAmount[] {
	if (factor === 1 || !(factor > 0)) return [];
	const out: StepAmount[] = [];
	const matches = findAllQtyUnits(text);
	for (const [i, m] of matches.entries()) {
		// `l'`: an elision (« en 2 l'une »), not litres.
		if (/^l$/i.test(m.unitText) && /^['’]/.test(text.slice(m.end))) continue;
		const unit = unitForAlias(m.unitText, lang);
		if (!unit) continue;
		// `C.` in capitals is a temperature (« 180 C. »), never a cup.
		if (unit === 'cup' && BARE_CUP.test(m.unitText) && (m.unitText.startsWith('C') || SPOON_REST.test(text.slice(m.end)))) continue;
		const cls = UNIT_CLASS_OF[unit];
		if (cls !== 'mass' && cls !== 'volume') continue;
		let value = sizeNumber(m.qty);
		if (value === undefined || !(value > 0)) continue;
		let end = m.end;
		const tail = TRAILING_FRACTION.exec(text.slice(m.end));
		if (tail && /^\d+$/.test(m.qty)) {
			const next = matches[i + 1];
			const fraction = sizeNumber(tail[1]);
			// Unless the fraction starts an amount of its own (« 1 tasse 1/2 c. à thé »).
			if (fraction !== undefined && !(next && next.start < m.end + tail[0].length)) {
				value += fraction;
				end = m.end + tail[0].length;
			}
		}
		let start = m.start;
		let lo: number | undefined;
		const before = RANGE_LOW.exec(text.slice(0, m.start));
		if (before && !LABEL.test(text.slice(0, m.start - before[0].length))) {
			const n = sizeNumber(before[1]);
			if (n !== undefined && n > 0 && n < value) {
				lo = n;
				start = m.start - before[0].length;
			}
		}
		const view = amountView(lo === undefined ? { qty: { value }, unit } : { qty: { value: lo }, qtyMax: { value }, unit }, { factor, lang, rules });
		out.push({ start, end, text: text.slice(start, end), scaled: view.approx ? `≈ ${view.text}` : view.text, approx: view.approx, unit });
	}
	return out;
}
