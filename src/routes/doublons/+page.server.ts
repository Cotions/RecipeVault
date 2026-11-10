import { fail } from '@sveltejs/kit';
import { getApp, writeContext } from '$lib/server/app';
import { dismissPairs, DuplicateError, duplicateGroupPage, duplicateGroups, groupVersions, LOW_CLOSE, lowGroups, sameRecipes, undismissPairs } from '$lib/server/duplicates';
import { HistoryError, undoCommit } from '$lib/server/history';
import { LABEL_MAX } from '$lib/server/families';
import { markSeen, SEEN_COOKIE } from '$lib/server/seen';
import { overHttps } from '$lib/server/auth';
import { stripMarkers } from '$lib/vault/markers';
import { t } from '$lib/i18n';
import type { Actions, PageServerLoad } from './$types';

// Possible duplicates (plan 05, Phase 7; Q12 B, Q13 B, Q15 A): readable by
// anyone like /etiquettes; the actions are writes, so the hook's guard asks
// for a session. One card per set of recipes linked by pairs (docs/DATA-FLOW.md,
// "/doublons"); each decision acts on the recipes ticked on the card and
// returns what « Annuler » posts back.
// The new cards (a recipe saved after the device's mark) come first, tagged
// « Nouvelle »; once the first page has shown them all, the mark moves up and
// « Plus » stops counting them (lib/server/seen.ts; usability round 4).
export const load: PageServerLoad = ({ url, cookies, locals, request }) => {
	const ctx = getApp().ctx;
	const mark = Number(cookies.get(SEEN_COOKIE));
	const page = duplicateGroupPage(ctx, Number(url.searchParams.get('page') ?? 1), Number.isFinite(mark) && cookies.get(SEEN_COOKIE) ? mark : undefined);
	if (locals.user?.markdown && page.fresh && page.page === 1 && page.groups.filter((g) => g.fresh).length === page.fresh) markSeen(cookies, ctx, overHttps(request.headers));
	return { ...page, labelMax: LABEL_MAX, lowPct: Math.round(LOW_CLOSE * 100) };
};

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const all = (f: FormData, k: string) => f.getAll(k).map((v) => String(v).trim()).filter(Boolean);
const pairsOf = (f: FormData) => all(f, 'pair').map((p) => p.split(' ', 2) as [string, string]);

const titleOf = (slug: string) => stripMarkers((getApp().ctx.db.prepare('SELECT title FROM recipes WHERE slug = ?').pluck().get(slug) as string | undefined) ?? slug);
/** « Carrés aux dattes · Carrés magiques », or the first and how many more. */
const titlesOf = (slugs: string[]) => {
	const ts = [...new Set(slugs.map(titleOf))];
	return ts.length <= 2 ? ts.join(' · ') : t.duplicates.andMore(ts[0], ts.length - 1);
};

/**
 * Each decision's toast ends with what is left (« Reste 18 groupes à décider. »):
 * the count she watches goes down by the cards settled. `receipt`: the one
 * line the card folds into (« Fèves au lard : 2 variantes »); `next`: the card
 * still holding two or more of its recipes when the decision took in only
 * some of them (the rest of a card of seven), where focus goes next, and
 * `rest` how many of them it holds.
 */
async function run(card: string, fn: () => Promise<{ message: string; receipt?: string; undo?: Record<string, string | string[]> }>) {
	try {
		const r = await fn();
		if (!card) return { ok: true, card, ...r };
		const groups = duplicateGroups(getApp().ctx);
		const mine = new Set(card.split(' '));
		const after = groups.map((g) => ({ key: g.key, n: g.slugs.filter((x) => mine.has(x)).length })).sort((a, b) => b.n - a.n)[0];
		const rest = after && after.n >= 2 ? after : undefined;
		return { ok: true, card, ...r, next: rest?.key ?? null, rest: rest?.n ?? 0, message: r.message + t.duplicates.left(groups.length) };
	} catch (e) {
		if (e instanceof DuplicateError) return fail(409, { ok: false, card, message: e.message });
		if (e instanceof HistoryError) return fail(409, { ok: false, card, message: t.duplicates.undoRefused });
		throw e;
	}
}

export const actions: Actions = {
	versions: async ({ request, locals }) => {
		const f = await request.formData();
		const slugs = all(f, 'slug');
		const label = str(f, 'label');
		return run(str(f, 'card'), async () => {
			const r = await groupVersions(writeContext(locals.user), {
				members: slugs.map((slug) => ({ slug, hash: str(f, `hash:${slug}`), variant: str(f, `variant:${slug}`) })),
				family: str(f, 'family'),
				label
			});
			const name = str(f, 'familyName') || label || r.family;
			return {
				message: t.duplicates.versionsDone(slugs.length, name),
				receipt: t.duplicates.receiptVersions(name, slugs.length),
				undo: r.commit ? { kind: 'commits', commit: r.commit, slug: r.edited[0] ?? slugs[0] } : undefined
			};
		});
	},
	same: async ({ request, locals }) => {
		const f = await request.formData();
		const keep = str(f, 'keep');
		const drop = all(f, 'drop').filter((s) => s !== keep);
		return run(str(f, 'card'), async () => {
			if (!keep) throw new DuplicateError(t.duplicates.pickOne);
			const r = await sameRecipes(writeContext(locals.user), keep, drop.map((slug) => ({ slug, hash: str(f, `hash:${slug}`) })));
			return {
				message: t.duplicates.sameDone(drop.map((s) => str(f, `title:${s}`) || s)),
				receipt: t.duplicates.receiptSame(titleOf(keep), drop.length),
				undo: r.trashed.length ? { kind: 'commits', commit: r.trashed.map((x) => x.commit), slug: r.trashed.map((x) => x.slug) } : undefined
			};
		});
	},
	distinct: async ({ request, locals }) => {
		const f = await request.formData();
		const pairs = pairsOf(f);
		return run(str(f, 'card'), async () => {
			const r = await dismissPairs(writeContext(locals.user), pairs, str(f, 'distinct'));
			return {
				message: t.duplicates.distinctDone(pairs.length),
				receipt: t.duplicates.receiptDistinct(titlesOf(pairs.flat())),
				undo: r.commit ? { kind: 'dismiss', pair: pairs.map((p) => p.join(' ')) } : undefined
			};
		});
	},
	/** « Toutes différentes »: the cards little alike the page listed (LOW_CLOSE), those still so, in one commit. */
	distinctLow: async ({ request, locals }) => {
		const f = await request.formData();
		const keys = new Set(all(f, 'key'));
		return run('low', async () => {
			const ctx = getApp().ctx;
			const cards = lowGroups(ctx, duplicateGroups(ctx)).filter((g) => keys.has(g.key));
			if (!cards.length) throw new DuplicateError(t.duplicates.refused.changed);
			const pairs = cards.flatMap((g) => g.pairs.map((p): [string, string] => [p.a, p.b]));
			const r = await dismissPairs(writeContext(locals.user), pairs, str(f, 'distinct'));
			return {
				message: t.duplicates.lowDone(cards.length),
				receipt: t.duplicates.receiptLow(cards.length),
				undo: r.commit ? { kind: 'dismiss', pair: pairs.map((p) => p.join(' ')) } : undefined
			};
		});
	},
	undo: async ({ request, locals }) => {
		const f = await request.formData();
		return run('', async () => {
			const ctx = writeContext(locals.user);
			if (str(f, 'kind') === 'dismiss') await undismissPairs(ctx, pairsOf(f));
			else {
				// Several commits (one per recipe sent to the trash): the last first.
				const commits = f.getAll('commit').map(String);
				const slugs = f.getAll('slug').map(String);
				for (let i = commits.length - 1; i >= 0; i--) await undoCommit(ctx, commits[i], { slug: slugs[i] });
			}
			return { message: t.duplicates.undone };
		});
	}
};
