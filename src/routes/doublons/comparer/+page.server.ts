import { error } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { openForm } from '$lib/server/formsave';
import { compareForms } from '$lib/form/compare';
import { stripMarkers } from '$lib/vault/markers';
import { t } from '$lib/i18n/fr';
import type { PageServerLoad } from './$types';

// Two recipes of a pair side by side (plan 05, Phase 7): the form's stale
// comparison (plan 04, Q18 A), read-only — every field where they differ.
export const load: PageServerLoad = ({ url }) => {
	const ctx = getApp().ctx;
	const [a, b] = [url.searchParams.get('a') ?? '', url.searchParams.get('b') ?? ''];
	const x = openForm(ctx, a);
	const y = openForm(ctx, b);
	if (!('form' in x) || !('form' in y)) error(404, t.recipe.notFound);
	return {
		a: { slug: a, title: stripMarkers(x.form.title) },
		b: { slug: b, title: stripMarkers(y.form.title) },
		rows: compareForms(x.form, y.form)
	};
};
