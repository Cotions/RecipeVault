import { emptyForm } from '$lib/form';
import { getApp } from '$lib/server/app';
import { formPageData } from '$lib/server/formpage';
import type { PageServerLoad } from './$types';

// A new recipe (plan 04, Phase 4): an empty form in the vault's language and
// oven unit. Signed-in only: the write guard sends a visitor to /connexion.
export const load: PageServerLoad = () => {
	const data = formPageData(getApp(), null);
	return { ...data, form: emptyForm({ lang: data.defaults.lang, ovenUnit: data.defaults.ovenUnit }) };
};
