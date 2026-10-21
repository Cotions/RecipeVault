import { getApp } from '$lib/server/app';
import { formPageData } from '$lib/server/formpage';
import type { PageServerLoad } from './$types';

// The name-word lists of W302 / W304 / W607 travel with the page, so the live
// check in the browser gives what /api/check gives (plan 03, Q22). With them,
// what the form needs to open a pasted file ("Relire et modifier"): units,
// families, the tag vocabulary.
export const load: PageServerLoad = () => formPageData(getApp(), null);
