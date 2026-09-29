import { error, json } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { nameResolves, subRecipeCandidates, suggestAuthors, suggestNames } from '$lib/server/formsave';
import { SLUG_RE } from '$lib/vault/slug';
import type { RequestHandler } from './$types';

// Type-ahead for the form (plan 04, Q8 A): ingredient names (with the "relié"
// mark), authors, and recipes for the sub-recipe picker (never this recipe or
// one that uses it, E213). A read: what it returns is on the public pages already.
export const GET: RequestHandler = ({ url }) => {
	const kind = url.searchParams.get('kind');
	const q = (url.searchParams.get('q') ?? '').slice(0, 100);
	const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'fr';
	const ctx = getApp().ctx;
	switch (kind) {
		case 'name':
			return json({ items: suggestNames(ctx, q, lang), linked: nameResolves(ctx, q, lang) });
		case 'author':
			return json({ items: suggestAuthors(ctx, q) });
		case 'recipe': {
			const own = url.searchParams.get('own') ?? undefined;
			if (own !== undefined && !SLUG_RE.test(own)) error(400, 'own');
			return json({ items: subRecipeCandidates(ctx, q, own) });
		}
		default:
			error(400, 'kind: name | author | recipe');
	}
};
