import { error } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { openForm } from '$lib/server/formsave';
import { formPageData } from '$lib/server/formpage';
import { t } from '$lib/i18n/fr';
import type { PageServerLoad } from './$types';

// Edit a recipe (plan 04, Phase 4): the form opened from the file on disk,
// with that file's hash for the stale-write guard (Q18 A). A file with
// errors does not open in the form (Q3 A): it is to be fixed first.
export const load: PageServerLoad = ({ params }) => {
	const app = getApp();
	const opened = openForm(app.ctx, params.slug);
	if ('refused' in opened) {
		if (opened.refused === 'gone') error(404, t.recipe.notFound);
		return { broken: true as const, slug: params.slug };
	}
	return { broken: false as const, ...formPageData(app, opened.form, { slug: params.slug, hash: opened.hash }), form: opened.form };
};
