import { fail } from '@sveltejs/kit';
import { getApp, writeContext } from '$lib/server/app';
import { loadVocab } from '$lib/server/vocab';
import { addRule, createFromKey, linkKey, QueueError, resolveQueue, undoEntryCommit, unlinkKey } from '$lib/server/queue';
import { proposeSlug } from '$lib/ingredients/registry';
import { CATEGORIES, UNIT_CLASSES } from '$lib/ingredients/types';
import { t } from '$lib/i18n';
import type { Actions, PageServerLoad } from './$types';

/** Names per step: « Voir les suivants » shows this many more (`?n=`). */
const LIMIT = 30;

export const load: PageServerLoad = ({ url }) => {
	const app = getApp();
	const cle = url.searchParams.get('cle') ?? undefined;
	const n = Math.max(LIMIT, Math.min(1000, Math.floor(Number(url.searchParams.get('n'))) || LIMIT));
	const { total, rows } = resolveQueue(app.ctx.db, () => loadVocab(app.ctx.paths.vocab), { limit: n, include: cle });
	const entries = app.ctx.db.prepare('SELECT slug, name FROM registry ORDER BY name').all() as { slug: string; name: string }[];
	return {
		total,
		step: LIMIT,
		/** The key a link asked for, when it is no longer waiting (linked meanwhile). */
		gone: cle !== undefined && !rows.some((r) => r.key === cle) ? cle : null,
		rows: rows.map((r) => ({ ...r, slug: proposeSlug(r.forms[0].name) })),
		entries,
		categories: [...CATEGORIES],
		unitClasses: Object.keys(UNIT_CLASSES)
	};
};

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

/** A slug typed in the picker may come as "Name (slug)" or as the display name. */
function pickedSlug(typed: string): string {
	const app = getApp();
	return (
		(app.ctx.db.prepare('SELECT slug FROM registry WHERE slug = ? OR name = ? LIMIT 1').pluck().get(typed, typed) as string | undefined) ??
		/\(([a-z0-9-]+)\)$/.exec(typed)?.[1] ??
		typed
	);
}

// Each action returns what « Annuler » posts back to `?/undo` (lib/settle.svelte.ts).
async function run(fn: () => Promise<{ message: string; commit?: string }>) {
	try {
		const r = await fn();
		return { ok: true, message: r.message, undo: r.commit ? { commit: r.commit } : undefined };
	} catch (e) {
		if (e instanceof QueueError) return fail(409, { ok: false, message: e.message });
		throw e;
	}
}

export const actions: Actions = {
	link: async ({ request, locals }) => {
		const app = getApp();
		const f = await request.formData();
		const key = str(f, 'key');
		const slug = pickedSlug(str(f, 'slug'));
		const hash = f.has('hash') ? str(f, 'hash') : undefined;
		// How many recipes the link changes, said in the toast (« huile » in 13 recipes is not one line).
		const recipes = app.ctx.db
			.prepare(
				`SELECT count(DISTINCT slug) FROM (SELECT slug FROM ingredients WHERE key = ? AND resolution IN ('none', 'ambiguous')
				 UNION SELECT slug FROM ingredient_or WHERE key = ? AND resolution IN ('none', 'ambiguous'))`
			)
			.pluck()
			.get(key, key) as number;
		return run(async () => {
			const r = await linkKey(writeContext(locals.user), key, slug, hash);
			const name = (app.ctx.db.prepare('SELECT name FROM registry WHERE slug = ?').pluck().get(slug) as string | undefined) ?? slug;
			return { message: t.queue.linked(str(f, 'form'), name, recipes), commit: r.commit };
		});
	},
	create: async ({ request, locals }) => {
		const app = getApp();
		const f = await request.formData();
		return run(async () => {
			const r = await createFromKey(writeContext(locals.user), str(f, 'key'), { slug: str(f, 'slug'), category: str(f, 'category'), staple: f.get('staple') === 'on' });
			return { message: t.queue.created(r.slug), commit: r.commit };
		});
	},
	unlink: async ({ request, locals }) => {
		const app = getApp();
		const f = await request.formData();
		const slug = str(f, 'slug');
		return run(async () => {
			const r = await unlinkKey(writeContext(locals.user), str(f, 'key'), slug, str(f, 'hash'));
			const name = (app.ctx.db.prepare('SELECT name FROM registry WHERE slug = ?').pluck().get(slug) as string | undefined) ?? slug;
			return { message: t.queue.removed(name), commit: r.commit };
		});
	},
	rule: async ({ request, locals }) => {
		const app = getApp();
		const f = await request.formData();
		const slug = pickedSlug(str(f, 'slug'));
		const unit = f.getAll('unit').map(String);
		const words = str(f, 'words').split(',');
		return run(async () => {
			const r = await addRule(writeContext(locals.user), str(f, 'key'), slug, { unit, words, sameLang: f.get('lang') === 'on' }, f.has('hash') ? str(f, 'hash') : undefined);
			const name = (app.ctx.db.prepare('SELECT name FROM registry WHERE slug = ?').pluck().get(slug) as string | undefined) ?? slug;
			return { message: t.queue.ruled(str(f, 'form'), name, r.resolved), commit: r.commit };
		});
	},
	undo: async ({ request, locals }) => {
		const f = await request.formData();
		return run(async () => {
			await undoEntryCommit(writeContext(locals.user), str(f, 'commit'));
			return { message: t.app.undone };
		});
	}
};
