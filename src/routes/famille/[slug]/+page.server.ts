import { error, fail } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { familiesFile, FamilyLabelError, LABEL_MAX, setFamilyLabel } from '$lib/server/families';
import { familyDiff } from '$lib/server/index/query';
import { t } from '$lib/i18n/fr';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const app = getApp();
	const diff = familyDiff(app.ctx.db, params.slug);
	if (!diff) error(404);
	return { diff, labelsHash: familiesFile(app.ctx).hash, labelMax: LABEL_MAX };
};

export const actions: Actions = {
	label: async ({ params, request }) => {
		const app = getApp();
		if (!familyDiff(app.ctx.db, params.slug)) error(404);
		const form = await request.formData();
		const label = String(form.get('label') ?? '');
		try {
			await setFamilyLabel(app.ctx, params.slug, label, String(form.get('hash') ?? ''));
		} catch (e) {
			if (e instanceof FamilyLabelError) return fail(409, { ok: false, message: e.message, label });
			throw e;
		}
		return { ok: true, message: t.families.labelSaved };
	}
};
