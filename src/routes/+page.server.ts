import { getApp } from '$lib/server/app';
import { browse, familyLabels, orphanProblems, SORTS, type BrowseParams, type Sort } from '$lib/server/index/query';
import type { PageServerLoad } from './$types';

function paramsFrom(url: URL): BrowseParams {
	const s = url.searchParams;
	const one = (k: string) => s.get(k) || undefined;
	const sort = one('sort');
	return {
		q: one('q'),
		family: one('famille'),
		tags: s.getAll('tag').filter(Boolean),
		season: one('saison'),
		source: one('source'),
		author: one('auteur'),
		status: one('etat'),
		time: one('temps'),
		servings: one('portions'),
		unresolved: one('relies'),
		sort: sort && (SORTS as readonly string[]).includes(sort) ? (sort as Sort) : undefined,
		page: Number(one('page') ?? 1) || 1
	};
}

export const load: PageServerLoad = ({ url }) => {
	const app = getApp();
	const params = paramsFrom(url);
	const result = browse(app.ctx.db, params);
	const problems = orphanProblems(app.ctx.db);
	const vaultEmpty = result.total === 0 && (app.ctx.db.prepare('SELECT count(*) FROM recipes').pluck().get() as number) === 0;
	return { params, result, problems, vaultEmpty, familyLabels: familyLabels(app.ctx.db) };
};
