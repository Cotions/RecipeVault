// W606: `to_taste: true` on an ingredient the registry does not class as
// something used "to taste" (`au_gout: true`, plan 03, Q21) — AI-TEMPLATE.md
// rule 13 keeps `to_taste` for seasoning and cooking fat. Only a resolved line
// is judged: an unresolved name says nothing about the product (W303 / W305
// cover it). Browser-safe.

import type { Diagnostic, Ingredient, Recipe } from '../vault/types';
import type { Resolver } from './resolve';

export function toTasteDiagnostics(recipe: Pick<Recipe, 'ingredients' | 'lang'>, resolver: Resolver, auGout: ReadonlySet<string>): Diagnostic[] {
	const out: Diagnostic[] = [];
	const visit = (it: Ingredient, path: string) => {
		if (it.toTaste && !it.recipe) {
			const r = resolver.resolve(it, recipe.lang);
			if (r.item && !auGout.has(r.item))
				out.push({
					code: 'W606',
					severity: 'warning',
					path: `${path}.to_taste`,
					message: `\`to_taste: true\` on "${it.name}", which the ingredient registry (${r.item}) does not class as a seasoning or a cooking fat.`,
					fix: `\`to_taste\` is for seasoning and cooking fat only. With no amount on the source, write the name alone: \`{ name: ${it.name} }\`.`
				});
		}
		it.or?.forEach((o, j) => visit(o, `${path}.or[${j}]`));
	};
	recipe.ingredients.forEach((g, gi) => g.items.forEach((it, ii) => visit(it, `ingredients[${gi}].items[${ii}]`)));
	return out;
}
