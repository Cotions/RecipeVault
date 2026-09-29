import { fail } from '@sveltejs/kit';
import { getApp, writeContext } from '$lib/server/app';
import { acceptTag, canonicalTags, dropTag, LABEL_MAX, mapTag, pendingTags, TagError, tagsVersion } from '$lib/server/tags';
import { t } from '$lib/i18n/fr';
import type { Actions, PageServerLoad } from './$types';

// Pending tags (plan 04, Phase 8; Q11 B). Shown in the nav to an account with
// the Markdown tools; like every write, the actions need a session (the hook's
// guard) and nothing more (Q2 B).
export const load: PageServerLoad = () => {
	const { ctx } = getApp();
	return { pending: pendingTags(ctx), canonical: canonicalTags(ctx), version: tagsVersion(ctx), labelMax: LABEL_MAX };
};

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

async function run(tag: string, fn: () => Promise<string>) {
	try {
		return { ok: true, tag, message: await fn() };
	} catch (e) {
		if (e instanceof TagError) return fail(409, { ok: false, tag, message: e.message });
		throw e;
	}
}

export const actions: Actions = {
	accept: async ({ request, locals }) => {
		const f = await request.formData();
		const tag = str(f, 'tag');
		return run(tag, async () => {
			const r = await acceptTag(writeContext(locals.user), tag, str(f, 'label'), str(f, 'version'));
			return t.pendingTags.accepted(str(f, 'label') || r.tag);
		});
	},
	map: async ({ request, locals }) => {
		const f = await request.formData();
		const tag = str(f, 'tag');
		const canonical = str(f, 'canonical');
		return run(tag, async () => {
			await mapTag(writeContext(locals.user), tag, canonical, str(f, 'version'));
			return t.pendingTags.mapped(tag, canonicalTags(getApp().ctx).find((c) => c.tag === canonical)?.label ?? canonical);
		});
	},
	drop: async ({ request, locals }) => {
		const f = await request.formData();
		const tag = str(f, 'tag');
		// One `recette` field per recipe listed: `<slug> <hash>`.
		const seen = Object.fromEntries(f.getAll('recette').map((v) => String(v).split(' ', 2)));
		return run(tag, async () => {
			const r = await dropTag(writeContext(locals.user), tag, seen);
			return t.pendingTags.dropped(tag, r.recipes);
		});
	}
};
