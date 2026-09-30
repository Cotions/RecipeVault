// Which ingredients a step mentions, for kitchen mode: names matched in the
// step text, accent- and case-insensitive, singular or plural. Best effort —
// a miss shows nothing. The plural endings are the vault's (vocab/normalize.yaml,
// docs/VOCAB.md "Plurals"), the same rule the ingredient resolver uses; without
// one, words match only as written.

import { fold, stripAccents } from '../vault/normalize';
import { stripMarkers } from '../vault/markers';
import { singularKey, type PluralRule } from '../ingredients/normalize';
import type { Ingredient, IngredientGroup } from '../vault/types';

const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'a', 'au', 'aux', 'en', 'et', 'd', 'l', 'of', 'the', 'and']);

function words(s: string): string[] {
	return fold(stripAccents(stripMarkers(s)))
		.split(/[^a-z0-9]+/)
		.filter((w) => w && !STOP.has(w));
}


export interface StepIngredient {
	group: number;
	item: number;
	ingredient: Ingredient;
}

export function stepIngredients(step: string, groups: IngredientGroup[], plural?: PluralRule | null): StepIngredient[] {
	// Singular form per the vault's rule (oignons → oignon, choux → chou).
	const stem = (w: string) => (plural ? singularKey(w, plural) : w);
	const text = ` ${words(step).map(stem).join(' ')} `;
	const out: StepIngredient[] = [];
	groups.forEach((g, gi) =>
		g.items.forEach((it, ii) => {
			const name = words(it.name).map(stem);
			if (!name.length) return;
			// The whole name, or its head noun when the name is long ("bœuf haché" → "boeuf").
			const full = ` ${name.join(' ')} `;
			if (text.includes(full) || (name.length > 1 && name[0].length > 3 && text.includes(` ${name[0]} `))) {
				out.push({ group: gi, item: ii, ingredient: it });
			}
		})
	);
	return out;
}
