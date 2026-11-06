import { getApp } from '$lib/server/app';
import { loadVocab } from '$lib/server/vocab';
import type { LayoutServerLoad } from './$types';

// The same for every entry: the registry's names (the substitutes and merge
// datalist, ~1000 entries) and the allergens to tick. Here, not in the page's
// load: this load reads no param, so going from one entry to another (a
// substitute's link) reuses it instead of sending the whole registry again.
// A save on the page (invalidateAll) still reloads it.
export const load: LayoutServerLoad = () => {
	const app = getApp();
	return {
		entries: app.ctx.db.prepare('SELECT slug, name FROM registry ORDER BY name').all() as { slug: string; name: string }[],
		allergenList: [...loadVocab(app.ctx.paths.vocab).allergens].map(([slug, l]) => ({ slug, label: l.fr ?? slug }))
	};
};
