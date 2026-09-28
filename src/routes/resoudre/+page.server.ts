import { fail } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { loadVocab } from '$lib/server/vocab';
import { createFromKey, linkKey, QueueError, resolveQueue, unlinkKey } from '$lib/server/queue';
import { proposeSlug } from '$lib/ingredients/registry';
import { CATEGORIES } from '$lib/ingredients/types';
import { t } from '$lib/i18n/fr';
import type { Actions, PageServerLoad } from './$types';

const LIMIT = 30;

export const load: PageServerLoad = () => {
	const app = getApp();
	const { total, rows } = resolveQueue(app.ctx.db, () => loadVocab(app.ctx.paths.vocab), { limit: LIMIT });
	const entries = app.ctx.db.prepare('SELECT slug, name FROM registry ORDER BY name').all() as { slug: string; name: string }[];
	return {
		total,
		rows: rows.map((r) => ({ ...r, slug: proposeSlug(r.forms[0].name) })),
		entries,
		categories: [...CATEGORIES]
	};
};

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

async function run(fn: () => Promise<string>) {
	try {
		return { ok: true, message: await fn() };
	} catch (e) {
		if (e instanceof QueueError) return fail(409, { ok: false, message: e.message });
		throw e;
	}
}

export const actions: Actions = {
	link: async ({ request }) => {
		const app = getApp();
		const f = await request.formData();
		const key = str(f, 'key');
		const typed = str(f, 'slug');
		// A slug typed in the picker may come as "Name (slug)" or as the display name.
		const slug =
			(app.ctx.db.prepare('SELECT slug FROM registry WHERE slug = ? OR name = ? LIMIT 1').pluck().get(typed, typed) as string | undefined) ??
			/\(([a-z0-9-]+)\)$/.exec(typed)?.[1] ??
			typed;
		const hash = f.has('hash') ? str(f, 'hash') : undefined;
		return run(async () => {
			await linkKey(app.ctx, key, slug, hash);
			const name = (app.ctx.db.prepare('SELECT name FROM registry WHERE slug = ?').pluck().get(slug) as string | undefined) ?? slug;
			return t.queue.linked(str(f, 'form'), name);
		});
	},
	create: async ({ request }) => {
		const app = getApp();
		const f = await request.formData();
		return run(async () => {
			const r = await createFromKey(app.ctx, str(f, 'key'), { slug: str(f, 'slug'), category: str(f, 'category'), staple: f.get('staple') === 'on' });
			return t.queue.created(r.slug);
		});
	},
	unlink: async ({ request }) => {
		const app = getApp();
		const f = await request.formData();
		const slug = str(f, 'slug');
		return run(async () => {
			await unlinkKey(app.ctx, str(f, 'key'), slug, str(f, 'hash'));
			const name = (app.ctx.db.prepare('SELECT name FROM registry WHERE slug = ?').pluck().get(slug) as string | undefined) ?? slug;
			return t.queue.removed(name);
		});
	}
};
