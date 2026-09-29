import { error, json } from '@sveltejs/kit';
import { writeContext } from '$lib/server/app';
import { HistoryError, undoCommit } from '$lib/server/history';
import { SLUG_RE } from '$lib/vault/slug';
import type { RequestHandler } from './$types';

// "Annuler" in the toast after a form save (plan 04, Phase 4.8 / Phase 7):
// undoes that commit as a new one. Undoing a new recipe sends it to the
// trash. The answer's commit lets the toast offer "Rétablir".
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	if (typeof body?.commit !== 'string' || !/^[0-9a-f]{7,64}$/.test(body.commit)) error(400, 'commit');
	if (typeof body.slug !== 'string' || !SLUG_RE.test(body.slug)) error(400, 'slug');
	try {
		const r = await undoCommit(writeContext(locals.user), body.commit, { slug: body.slug });
		return json({ ok: true, action: r.action, commit: r.commit ?? null });
	} catch (e) {
		if (e instanceof HistoryError) return json({ ok: false, message: e.message }, { status: 409 });
		throw e;
	}
};
