import { fail } from '@sveltejs/kit';
import { getApp, writeContext } from '$lib/server/app';
import { loadVocab } from '$lib/server/vocab';
import { addRule, createFromKey, linkKey, QueueError, resolveQueue, unlinkKey } from '$lib/server/queue';
import { proposeSlug } from '$lib/ingredients/registry';
import { CATEGORIES, UNIT_CLASSES } from '$lib/ingredients/types';
import { t } from '$lib/i18n/fr';
import type { Actions, PageServerLoad } from './$types';

const LIMIT = 30;

export const load: PageServerLoad = ({ url }) => {
	const app = getApp();
	const cle = url.searchParams.get('cle') ?? undefined;
	const { total, rows } = resolveQueue(app.ctx.db, () => loadVocab(app.ctx.paths.vocab), { limit: LIMIT, include: cle });
	const entries = app.ctx.db.prepare('SELECT slug, name FROM registry ORDER BY name').all() as { slug: string; name: string }[];
	return {
		total,
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

async function run(fn: () => Promise<string>) {
	try {
		return { ok: true, message: await fn() };
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
		return run(async () => {
			await linkKey(writeContext(locals.user), key, slug, hash);
			const name = (app.ctx.db.prepare('SELECT name FROM registry WHERE slug = ?').pluck().get(slug) as string | undefined) ?? slug;
			return t.queue.linked(str(f, 'form'), name);
		});
	},
	create: async ({ request, locals }) => {
		const app = getApp();
		const f = await request.formData();
		return run(async () => {
			const r = await createFromKey(writeContext(locals.user), str(f, 'key'), { slug: str(f, 'slug'), category: str(f, 'category'), staple: f.get('staple') === 'on' });
			return t.queue.created(r.slug);
		});
	},
	unlink: async ({ request, locals }) => {
		const app = getApp();
		const f = await request.formData();
		const slug = str(f, 'slug');
		return run(async () => {
			await unlinkKey(writeContext(locals.user), str(f, 'key'), slug, str(f, 'hash'));
			const name = (app.ctx.db.prepare('SELECT name FROM registry WHERE slug = ?').pluck().get(slug) as string | undefined) ?? slug;
			return t.queue.removed(name);
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
			return t.queue.ruled(str(f, 'form'), name, r.resolved);
		});
	}
};
