// What the form pages load (plan 04, Phases 4–5): the vault's defaults and
// lists the form offers — units in the vault's order, families with their
// counts, the tag vocabulary, the name-word lists for the live hints.

import type { FormRecipe } from '$lib/form';
import { defaultsFor } from '$lib/form';
import type { Recipe } from '$lib/vault/types';
import type { App } from './app';
import { allFamilies, vaultStats } from './formsave';
import { photoView } from './pages';
import { tagVocabulary } from './tags';
import { loadCheckWords } from './vocab';

export function formPageData(app: App, form: FormRecipe | null, edit?: { slug: string; hash: string }) {
	const ctx = app.ctx;
	const d = defaultsFor(vaultStats(ctx));
	return {
		defaults: d,
		slug: edit?.slug ?? null,
		hash: edit?.hash ?? null,
		units: d.unitOrder,
		families: allFamilies(ctx),
		tagVocab: tagVocabulary(ctx),
		words: loadCheckWords(ctx.paths.vocab),
		photo: edit && form ? photoView(app, { slug: edit.slug, media: form.media } as Recipe) : null
	};
}
