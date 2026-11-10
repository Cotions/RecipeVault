import { fail } from '@sveltejs/kit';
import { getApp, writeContext } from '$lib/server/app';
import { acceptTag, canonicalTags, dropTag, LABEL_MAX, mapTag, pendingTags, TagError, tagsVersion, undoTagVocab } from '$lib/server/tags';
import { HistoryError, undoCommit } from '$lib/server/history';
import { t } from '$lib/i18n';
import type { Actions, PageServerLoad } from './$types';

// Pending tags (plan 04, Phase 8; Q11 B). Shown in the nav to an account with
// the Markdown tools; like every write, the actions need a session (the hook's
// guard) and nothing more (Q2 B). Each action returns what « Annuler » posts
// back to `?/undo` (lib/settle.svelte.ts).
export const load: PageServerLoad = () => {
	const { ctx } = getApp();
	return { pending: pendingTags(ctx), canonical: canonicalTags(ctx), version: tagsVersion(ctx), labelMax: LABEL_MAX };
};

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

async function run(tag: string, fn: () => Promise<{ message: string; undo?: Record<string, string> }>) {
	try {
		return { ok: true, tag, ...(await fn()) };
	} catch (e) {
		if (e instanceof TagError) return fail(409, { ok: false, tag, message: e.message });
		if (e instanceof HistoryError) return fail(409, { ok: false, tag, message: t.pendingTags.refused.undoStale });
		throw e;
	}
}

export const actions: Actions = {
	accept: async ({ request, locals }) => {
		const f = await request.formData();
		const tag = str(f, 'tag');
		return run(tag, async () => {
			const r = await acceptTag(writeContext(locals.user), tag, str(f, 'label'), str(f, 'version'));
			return { message: t.pendingTags.accepted(str(f, 'label') || r.tag), undo: r.commit ? { kind: 'vocab', commit: r.commit } : undefined };
		});
	},
	map: async ({ request, locals }) => {
		const f = await request.formData();
		const tag = str(f, 'tag');
		const canonical = str(f, 'canonical');
		return run(tag, async () => {
			const r = await mapTag(writeContext(locals.user), tag, canonical, str(f, 'version'));
			return {
				message: t.pendingTags.mapped(str(f, 'form') || tag, canonicalTags(getApp().ctx).find((c) => c.tag === canonical)?.label ?? canonical),
				undo: r.commit ? { kind: 'vocab', commit: r.commit } : undefined
			};
		});
	},
	drop: async ({ request, locals }) => {
		const f = await request.formData();
		const tag = str(f, 'tag');
		// One `recette` field per recipe listed: `<slug> <hash>`.
		const seen = Object.fromEntries(f.getAll('recette').map((v) => String(v).split(' ', 2)));
		return run(tag, async () => {
			const r = await dropTag(writeContext(locals.user), tag, seen);
			return {
				message: t.pendingTags.dropped(str(f, 'form') || tag, r.recipes),
				undo: r.commit ? { kind: 'recipes', commit: r.commit, slug: Object.keys(seen)[0] ?? '' } : undefined
			};
		});
	},
	undo: async ({ request, locals }) => {
		const f = await request.formData();
		return run('', async () => {
			const ctx = writeContext(locals.user);
			if (str(f, 'kind') === 'recipes') await undoCommit(ctx, str(f, 'commit'), { slug: str(f, 'slug') });
			else await undoTagVocab(ctx, str(f, 'commit'));
			return { message: t.app.undone };
		});
	}
};
