import { getApp } from '$lib/server/app';
import { duplicateGroups, freshGroups } from '$lib/server/duplicates';
import { queueGroups } from '$lib/server/queue';
import { overHttps } from '$lib/server/auth';
import { seenMark } from '$lib/server/seen';
import { pendingTagCount, tagLabels } from '$lib/server/tags';
import { loadConversions, loadUnitWords } from '$lib/server/vocab';
import type { LayoutServerLoad } from './$types';

// « Plus »'s counts for an account with the Markdown tools (plan 04, Q2 B):
// the tags to decide (plan 04, Phase 8) and the new duplicate cards (plan 05,
// Phase 7; counted only for that account); À relier's total stays on its page. Tag labels (vocab/tag-labels.yaml) for every page that
// shows a tag. The signed-in person: name and that preference, never the
// email or anything else from users.json. The unit words
// (vocab/unit-labels.yaml, plan 05) for every page that shows an amount, and
// what that person chose on /compte (lib/prefs.ts): the language, the
// measuring system (with the vault's conversions it needs) and their own unit
// words. Signed out: null, the defaults. « Plus »'s badge (PLANNING.md,
// « Plus »): the tags to decide, and the duplicate cards holding a recipe saved
// after this device's mark (lib/server/seen.ts); cleared by deciding only.
export const load: LayoutServerLoad = ({ locals, cookies, request }) => ({
	pendingTags: pendingTagCount(getApp().ctx.db),
	...duplicates(locals.user?.markdown ? { cookies, secure: overHttps(request.headers) } : null),
	// À relier's total, quiet in « Plus » beside its row (UI round 2: a backlog with no number anywhere read as nothing to do).
	queueTotal: locals.user?.markdown ? queueGroups(getApp().ctx.db).length : 0,
	tagLabels: tagLabels(getApp().ctx),
	unitWords: loadUnitWords(getApp().ctx.paths.vocab),
	conversions: locals.user && locals.user.prefs.system !== 'written' ? loadConversions(getApp().ctx.paths.vocab) : null,
	prefs: locals.user?.prefs ?? null,
	user: locals.user ? { login: locals.user.login, name: locals.user.name, markdown: !!locals.user.markdown } : null
});

function duplicates(owner: { cookies: Parameters<LayoutServerLoad>[0]['cookies']; secure: boolean } | null): { duplicates: number; freshDuplicates: number } {
	if (!owner) return { duplicates: 0, freshDuplicates: 0 };
	const ctx = getApp().ctx;
	const groups = duplicateGroups(ctx);
	return { duplicates: groups.length, freshDuplicates: freshGroups(ctx, groups, seenMark(owner.cookies, ctx, owner.secure)).length };
}
