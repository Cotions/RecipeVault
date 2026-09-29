import { error, fail, redirect } from '@sveltejs/kit';
import { getApp, writeContext } from '$lib/server/app';
import { loadRecipePage } from '$lib/server/pages';
import { verify, VerifyError } from '$lib/server/save';
import { remove, TrashError } from '$lib/server/trash';
import { t } from '$lib/i18n/fr';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const data = loadRecipePage(getApp(), params.slug);
	if (!data) error(404, t.recipe.notFound);
	return data;
};

export const actions: Actions = {
	verify: async ({ params, request, locals }) => {
		const hash = String((await request.formData()).get('hash') ?? '');
		try {
			await verify(writeContext(locals.user), params.slug, hash);
		} catch (e) {
			if (e instanceof VerifyError) return fail(409, { action: 'verify', ok: false, message: e.message });
			throw e;
		}
		return { action: 'verify', ok: true, message: t.recipe.verified };
	},
	remove: async ({ params, request, locals }) => {
		const hash = String((await request.formData()).get('hash') ?? '');
		try {
			await remove(writeContext(locals.user), params.slug, hash);
		} catch (e) {
			if (e instanceof TrashError) return fail(409, { action: 'remove', ok: false, message: e.message });
			throw e;
		}
		redirect(303, '/corbeille?supprimee=' + encodeURIComponent(params.slug));
	}
};
