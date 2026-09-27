import { fail } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { listTrash, restore, TrashError } from '$lib/server/trash';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => ({
	entries: listTrash(getApp().ctx),
	deleted: url.searchParams.get('supprimee')
});

export const actions: Actions = {
	restore: async ({ request }) => {
		const slug = String((await request.formData()).get('slug') ?? '');
		try {
			await restore(getApp().ctx, slug);
		} catch (e) {
			if (e instanceof TrashError) return fail(409, { ok: false, message: e.message, slug });
			throw e;
		}
		return { ok: true, slug };
	}
};
