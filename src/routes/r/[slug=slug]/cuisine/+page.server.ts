import { error } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { getRecipe } from '$lib/server/index/query';
import { ingredientLinks, loadSubRecipes, photoView, referencedSlugs } from '$lib/server/pages';
import { loadConversions, loadNormalize, loadScaling } from '$lib/server/vocab';
import { titles } from '$lib/server/index/query';
import { t } from '$lib/i18n';
import type { DB } from '$lib/server/index/db';
import type { LineNames } from '$lib/render/steps';
import type { NameForms } from '$lib/render/ingredient';
import type { Unit } from '$lib/vault/types';
import type { PageServerLoad } from './$types';

/**
 * What the index knows of the lines, for « Pour cette étape »: each linked
 * line's other names (its entry's aliases in the recipe's language), and the
 * lines the registry does not know (a near spelling in a step finds them).
 */
function lineNames(db: DB, slug: string, lang: string): LineNames {
	const rows = db.prepare('SELECT position, item, resolution FROM ingredients WHERE slug = ?').all(slug) as { position: number; item: string | null; resolution: string }[];
	const names = db.prepare('SELECT name FROM ingredient_names WHERE slug = ? AND lang = ?').pluck();
	const aliases: Record<number, string[]> = {};
	const unlinked: number[] = [];
	for (const r of rows) {
		if (r.item) {
			const all = names.all(r.item, lang) as string[];
			if (all.length) aliases[r.position] = all.slice(0, 12);
		} else if (r.resolution === 'none' || r.resolution === 'ambiguous') unlinked.push(r.position);
	}
	return { aliases, unlinked };
}

export const load: PageServerLoad = ({ params }) => {
	const app = getApp();
	const d = getRecipe(app.ctx.db, params.slug);
	if (!d) error(404, t.recipe.notFound);
	return {
		recipe: d.recipe,
		body: d.row.body_md,
		photo: photoView(app, d.recipe),
		titles: Object.fromEntries(titles(app.ctx.db, referencedSlugs(d.recipe, d.row.body_md))),
		subs: loadSubRecipes(app, d.recipe),
		scaling: loadScaling(app.ctx.paths.vocab),
		/** Plan 05, Q5 A: the cost rule's factors, to scale a sub-recipe's expansion. */
		conversions: loadConversions(app.ctx.paths.vocab),
		/** The plural rule of the recipe's language (vocab/normalize.yaml), for matching names in steps. */
		plural: loadNormalize(app.ctx.paths.vocab).plurals[d.recipe.lang] ?? null,
		lineNames: lineNames(app.ctx.db, params.slug, d.recipe.lang),
		/** Per line, by position: its name's singular and plural and its weights, so lines read as on the recipe page (« 2 ½ oignons hachés »). No links: kitchen mode does not leave. */
		lineForms: Object.fromEntries(
			Object.entries(ingredientLinks(app, params.slug)).flatMap(([pos, l]) => (l.forms || l.weights ? [[pos, { ...(l.forms ? { forms: l.forms } : {}), ...(l.weights ? { weights: l.weights } : {}) }]] : []))
		) as Record<number, { forms?: NameForms; weights?: Partial<Record<Unit, number>> }>
	};
};
