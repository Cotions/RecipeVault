import { error } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { familyDiff } from '$lib/server/index/query';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const diff = familyDiff(getApp().ctx.db, params.slug);
	if (!diff) error(404);
	return { diff };
};
