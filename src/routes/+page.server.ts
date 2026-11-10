import { getApp } from '$lib/server/app';
import { browse, familyNames, ideas, orphanProblems, SORTS, type BrowseParams, type Sort } from '$lib/server/index/query';
import type { PageServerLoad } from './$types';

/**
 * Forty-eight recipes a page: a wide screen shows about twenty-four rows in its
 * two columns, so a page is two screens and 320 recipes are seven pages.
 */
const PAGE_SIZE = 48;

/** The address's filter parameters (the page's PARAM table). */
const FILTERS = ['famille', 'tag', 'saison', 'temps', 'portions', 'source', 'auteur', 'etat', 'relies'];

function paramsFrom(url: URL): BrowseParams {
	const s = url.searchParams;
	const one = (k: string) => s.get(k) || undefined;
	const sort = one('sort');
	return {
		q: one('q'),
		exact: one('exact') === '1',
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
		page: Number(one('page') ?? 1) || 1,
		pageSize: PAGE_SIZE
	};
}

export const load: PageServerLoad = ({ url, locals }) => {
	const app = getApp();
	const params = paramsFrom(url);
	// The rows show no tags (a search hit on a tag says so in its match line).
	const result = browse(app.ctx.db, params, { withTags: false });
	// The review state and the registry queue are the owner's upkeep (an account
	// with the Markdown tools): a family account sees neither facet. A filter
	// already in the address still applies, and shows as a chip.
	const upkeep = !!locals.user?.markdown;
	if (!upkeep) result.facets = { ...result.facets, status: [], unresolved: [] };
	// Files that fail the checker are the owner's to fix (VALIDATION.md): a family account is not shown them.
	const problems = upkeep ? orphanProblems(app.ctx.db) : [];
	const vaultEmpty = result.total === 0 && (app.ctx.db.prepare('SELECT count(*) FROM recipes').pluck().get() as number) === 0;
	const filters = FILTERS.some((k) => url.searchParams.getAll(k).some(Boolean));
	// The whole box, first page: a few ideas over the index (a card at random, the season's, the last added). A search or a filter goes straight to the rows.
	const plain = !params.q && !filters && result.page === 1 && !url.searchParams.get('sort');
	const idea = plain && result.total ? ideas(app.ctx.db) : null;
	// Nothing found with filters on: how many the search finds without them (the empty state offers to clear them).
	const unfiltered = result.total === 0 && filters && params.q ? browse(app.ctx.db, { q: params.q, pageSize: 1 }, { withFacets: false, withTags: false }).total : null;
	return { params, result, problems, vaultEmpty, ideas: idea, unfiltered, familyNames: familyNames(app.ctx.db) };
};
