// « Pour [10] portions »: the count a recipe can be scaled to by typing it
// (the recipe page's « Autre quantité », docs/DATA-FLOW.md "Scaling"): its
// servings, else a yield that is one count. The factor is then typed ÷ base.
// Browser-safe.

import type { Lang, Recipe } from '../vault/types';
import { textYieldCount } from './scale';
import { unitLabel } from './unitwords';

export interface ScaleTarget {
	/** The count as written: the servings (their lower bound), or the yield's. */
	base: number;
	/** The words after the count, as the field's label ends: « portions », « tourtières ». */
	word: string;
}

/**
 * What « Autre quantité » asks for: a number of servings (`servingsWord`), else
 * a yield's count (`yield: 24 biscuits`, `{ qty: 2, unit: piece, note: abaisses }`).
 * Null when neither is one plain count (a range, no number, no words): the page
 * then asks for a multiplier.
 */
export function scaleTarget(recipe: Pick<Recipe, 'servings' | 'yield'>, lang: Lang, servingsWord: string): ScaleTarget | null {
	if (recipe.servings && recipe.servings > 0) return { base: recipe.servings, word: servingsWord };
	const y = recipe.yield;
	if (!y) return null;
	if (typeof y === 'string') {
		const c = textYieldCount(y);
		return c && c.rest ? { base: c.value, word: c.rest } : null;
	}
	if (!y.qty || y.qtyMax || !(y.qty.value > 0)) return null;
	const word = [y.unit && y.unit !== 'piece' ? unitLabel(y.unit, 2, lang) : '', y.note ?? ''].filter(Boolean).join(' ');
	return word ? { base: y.qty.value, word } : null;
}
