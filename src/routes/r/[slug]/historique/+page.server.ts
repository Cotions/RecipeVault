import { error, fail } from '@sveltejs/kit';
import { getApp, writeContext } from '$lib/server/app';
import { HistoryError, recipeHistory, restoreVersion, undoCommit } from '$lib/server/history';
import { t } from '$lib/i18n/fr';
import type { Actions, PageServerLoad } from './$types';

const when = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long', timeStyle: 'short' });

export const load: PageServerLoad = async ({ params }) => {
	const h = await recipeHistory(getApp().ctx, params.slug);
	if (h.where === 'none' && !h.versions.length) error(404, t.recipe.notFound);
	return {
		slug: h.slug,
		where: h.where,
		title: h.title ?? h.slug,
		hash: h.hash ?? '',
		// The texts stay on the server: the page shows summaries, not files.
		versions: h.versions.map((v) => ({
			commit: v.commit,
			when: when.format(new Date(v.date)),
			author: v.author,
			verb: v.verb,
			summary: v.summary,
			current: v.current,
			restorable: v.restorable,
			blocked: v.blocked ?? null,
			toCurrent: v.toCurrent
		}))
	};
};

function refused(action: string, e: unknown) {
	if (e instanceof HistoryError) return fail(409, { action, ok: false as const, message: e.message, commit: null, result: null });
	throw e;
}

export const actions: Actions = {
	/** "Revenir à cette version": `commit` (one of this recipe's versions), `hash` (the file the page showed). */
	revenir: async ({ params, request, locals }) => {
		const data = await request.formData();
		try {
			const r = await restoreVersion(writeContext(locals.user), params.slug, String(data.get('commit') ?? ''), String(data.get('hash') ?? ''));
			return { action: 'revenir', ok: true as const, message: t.history.restored, commit: r.commit ?? null, result: null };
		} catch (e) {
			return refused('revenir', e);
		}
	},
	/**
	 * "Annuler": undo one commit of this recipe (`commit`): the toast after a
	 * save, a restore, or an undo (a redo). Answers the new commit, to undo in turn.
	 */
	annuler: async ({ params, request, locals }) => {
		const commit = String((await request.formData()).get('commit') ?? '');
		try {
			const r = await undoCommit(writeContext(locals.user), commit, { slug: params.slug });
			const message = r.action === 'trashed' ? t.history.trashedByUndo : r.action === 'untrashed' ? t.history.untrashedByUndo : t.history.undone;
			return { action: 'annuler', ok: true as const, message, commit: r.commit ?? null, result: r.action };
		} catch (e) {
			return refused('annuler', e);
		}
	}
};
