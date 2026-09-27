// Servings scaling: every quantity (ranges too) times one factor.

import type { Recipe } from '../vault/types';

/** The factor for a target number of servings; 1 when the recipe gives none. */
export function scaleFactor(recipe: Pick<Recipe, 'servings'>, target: number): number {
	if (!recipe.servings || !target || target <= 0) return 1;
	return target / recipe.servings;
}

/** Multipliers offered when a recipe has no servings (a yield, a batch). */
export const MULTIPLIERS = [0.5, 1, 1.5, 2, 3] as const;
