import { getApp } from '$lib/server/app';
import { loadVocab } from '$lib/server/vocab';
import type { LayoutServerLoad } from './$types';

// What the pantry page needs whatever is in it: every name the box can
// suggest (a datalist, ~1000 names) and the allergens to tick. Here, not in
// the page's load: this load reads no URL, so adding or removing an
// ingredient (a navigation to a new query string) reuses it instead of
// sending the whole list again each time.
export const load: LayoutServerLoad = () => {
	const app = getApp();
	return {
		aliases: app.ctx.db.prepare('SELECT DISTINCT name FROM ingredient_names ORDER BY name').pluck().all() as string[],
		allergenList: [...loadVocab(app.ctx.paths.vocab).allergens].map(([slug, l]) => ({ slug, label: l.fr ?? slug }))
	};
};
