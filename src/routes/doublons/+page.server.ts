import { fail } from '@sveltejs/kit';
import { getApp, writeContext } from '$lib/server/app';
import { dismissPair, DuplicateError, duplicatePage, pairVersions, sameRecipe, undismissPair } from '$lib/server/duplicates';
import { HistoryError, undoCommit } from '$lib/server/history';
import { LABEL_MAX } from '$lib/server/families';
import { t } from '$lib/i18n/fr';
import type { Actions, PageServerLoad } from './$types';

// Possible duplicates (plan 05, Phase 7; Q12 B, Q13 B, Q15 A): readable by
// anyone like /etiquettes; the actions are writes, so the hook's guard asks
// for a session. Each action returns what "Annuler" needs.
export const load: PageServerLoad = ({ url }) => ({ ...duplicatePage(getApp().ctx, Number(url.searchParams.get('page') ?? 1)), labelMax: LABEL_MAX });

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

type Undo = { kind: 'commit'; commit: string; slug: string } | { kind: 'dismiss'; a: string; b: string };

async function run(pair: string, fn: () => Promise<{ message: string; undo?: Undo }>) {
	try {
		return { ok: true, pair, ...(await fn()) };
	} catch (e) {
		if (e instanceof DuplicateError) return fail(409, { ok: false, pair, message: e.message });
		if (e instanceof HistoryError) return fail(409, { ok: false, pair, message: t.duplicates.undoRefused });
		throw e;
	}
}

export const actions: Actions = {
	versions: async ({ request, locals }) => {
		const f = await request.formData();
		const [a, b] = [str(f, 'a'), str(f, 'b')];
		return run(`${a} ${b}`, async () => {
			const r = await pairVersions(writeContext(locals.user), {
				a: { slug: a, hash: str(f, 'hashA'), variant: str(f, 'variantA') },
				b: { slug: b, hash: str(f, 'hashB'), variant: str(f, 'variantB') },
				family: str(f, 'family'),
				label: str(f, 'label')
			});
			return { message: t.duplicates.versionsDone(r.family), undo: r.commit ? { kind: 'commit', commit: r.commit, slug: a } : undefined };
		});
	},
	same: async ({ request, locals }) => {
		const f = await request.formData();
		const [a, b] = [str(f, 'a'), str(f, 'b')];
		const drop = str(f, 'drop');
		return run(`${a} ${b}`, async () => {
			if (drop !== a && drop !== b) throw new DuplicateError(t.duplicates.pickOne);
			const r = await sameRecipe(writeContext(locals.user), drop, str(f, drop === a ? 'hashA' : 'hashB'));
			return { message: t.duplicates.sameDone(str(f, drop === a ? 'titleA' : 'titleB')), undo: r.commit ? { kind: 'commit', commit: r.commit, slug: drop } : undefined };
		});
	},
	distinct: async ({ request, locals }) => {
		const f = await request.formData();
		const [a, b] = [str(f, 'a'), str(f, 'b')];
		return run(`${a} ${b}`, async () => {
			const r = await dismissPair(writeContext(locals.user), a, b, str(f, 'distinct'));
			return { message: t.duplicates.distinctDone, undo: r.commit ? { kind: 'dismiss', a, b } : undefined };
		});
	},
	undo: async ({ request, locals }) => {
		const f = await request.formData();
		const pair = str(f, 'pair');
		return run(pair, async () => {
			const ctx = writeContext(locals.user);
			if (str(f, 'kind') === 'dismiss') await undismissPair(ctx, str(f, 'a'), str(f, 'b'));
			else await undoCommit(ctx, str(f, 'commit'), { slug: str(f, 'slug') });
			return { message: t.duplicates.undone };
		});
	}
};
