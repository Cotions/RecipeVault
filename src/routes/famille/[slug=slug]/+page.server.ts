import { error, fail } from '@sveltejs/kit';
import { getApp, writeContext } from '$lib/server/app';
import { familiesFile, FamilyLabelError, LABEL_MAX, setFamilyLabel } from '$lib/server/families';
import { DuplicateError, joinFamily } from '$lib/server/duplicates';
import { HistoryError, undoCommit } from '$lib/server/history';
import { stripMarkers } from '$lib/vault/markers';
import { familyDiff } from '$lib/server/index/query';
import { getResolver } from '$lib/server/index/resolve';
import { shownCandidates } from '$lib/ingredients/resolve';
import { loadVocab } from '$lib/server/vocab';
import { t } from '$lib/i18n';
import type { Actions, PageServerLoad } from './$types';

// The comparison reads a name not linked yet as the ingredient /resoudre
// suggests first (« casonade » → cassonade), when the other variants have it:
// one row, marked « même ingrédient ? » with « Relier » for the owner.
export const load: PageServerLoad = ({ params }) => {
	const app = getApp();
	const resolver = getResolver(app.ctx.db, () => loadVocab(app.ctx.paths.vocab));
	const diff = familyDiff(app.ctx.db, params.slug, (key) => shownCandidates(resolver.candidates(key))[0]?.slug ?? null);
	if (!diff) error(404);
	const entry = app.ctx.db.prepare('SELECT name, file_hash FROM registry WHERE slug = ?');
	// The entry each « maybe » row would link to: its name and file hash (the stale-write guard of /resoudre?/link).
	const entries = Object.fromEntries(
		diff.rows.filter((r) => r.maybe).map((r) => {
			const e = entry.get(r.item) as { name: string; file_hash: string } | undefined;
			return [r.item, { name: e?.name ?? r.label, hash: e?.file_hash ?? '' }];
		})
	);
	return { diff, entries, labelsHash: familiesFile(app.ctx).hash, labelMax: LABEL_MAX };
};

export const actions: Actions = {
	label: async ({ params, request, locals }) => {
		const app = getApp();
		if (!familyDiff(app.ctx.db, params.slug)) error(404);
		const form = await request.formData();
		const label = String(form.get('label') ?? '');
		try {
			await setFamilyLabel(writeContext(locals.user), params.slug, label, String(form.get('hash') ?? ''));
		} catch (e) {
			if (e instanceof FamilyLabelError) return fail(409, { ok: false, message: e.message, label });
			throw e;
		}
		return { ok: true, message: t.families.labelSaved };
	},
	// « + Ajouter une recette à ce groupe »: one recipe joins, one commit; « Annuler » in the toast.
	join: async ({ params, request, locals }) => {
		const app = getApp();
		const diff = familyDiff(app.ctx.db, params.slug);
		if (!diff) error(404);
		const f = await request.formData();
		const slug = String(f.get('recipe') ?? '').trim();
		const row = app.ctx.db.prepare('SELECT title, file_hash FROM recipes WHERE slug = ?').get(slug) as { title: string; file_hash: string } | undefined;
		if (!row) return fail(409, { ok: false, message: t.error.recipeGone });
		try {
			const r = await joinFamily(writeContext(locals.user), { slug, hash: String(f.get('hash') ?? '') || row.file_hash, variant: String(f.get('variant') ?? ''), family: params.slug });
			return { ok: true, message: t.families.joined(stripMarkers(row.title), diff.name), undo: r.commit ? { commit: r.commit, slug } : undefined };
		} catch (e) {
			if (e instanceof DuplicateError) return fail(409, { ok: false, message: e.message });
			throw e;
		}
	},
	undo: async ({ request, locals }) => {
		const f = await request.formData();
		try {
			const slug = String(f.get('slug') ?? '');
			await undoCommit(writeContext(locals.user), String(f.get('commit') ?? ''), { slug });
			const title = getApp().ctx.db.prepare('SELECT title FROM recipes WHERE slug = ?').pluck().get(slug) as string | undefined;
			return { ok: true, message: title ? t.families.ungrouped(stripMarkers(title)) : t.app.undone };
		} catch (e) {
			if (e instanceof HistoryError) return fail(409, { ok: false, message: t.duplicates.undoRefused });
			throw e;
		}
	}
};
