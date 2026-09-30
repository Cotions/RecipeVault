import { error } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { getRecipe } from '$lib/server/index/query';
import { loadSubRecipes, photoView, referencedSlugs } from '$lib/server/pages';
import { loadConversions, loadNormalize, loadScaling } from '$lib/server/vocab';
import { titles } from '$lib/server/index/query';
import { t } from '$lib/i18n/fr';
import type { PageServerLoad } from './$types';

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
		plural: loadNormalize(app.ctx.paths.vocab).plurals[d.recipe.lang] ?? null
	};
};
