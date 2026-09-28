import { getApp } from '$lib/server/app';
import { loadCheckWords } from '$lib/server/vocab';
import type { PageServerLoad } from './$types';

// The name-word lists of W302 / W304 / W607 travel with the page, so the live
// check in the browser gives what /api/check gives (plan 03, Q22).
export const load: PageServerLoad = () => ({ words: loadCheckWords(getApp().ctx.paths.vocab) });
