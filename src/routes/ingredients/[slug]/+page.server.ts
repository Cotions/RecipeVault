import { error, fail, redirect } from '@sveltejs/kit';
import { getApp, writeContext } from '$lib/server/app';
import { addAlias, editEntry, ingredientView, mergeEntry } from '$lib/server/ingredient';
import { linkKey, QueueError } from '$lib/server/queue';
import { ingredientPath } from '$lib/server/registry';
import { loadVocab } from '$lib/server/vocab';
import { CATEGORIES, NAME_LANGS } from '$lib/ingredients/types';
import { UNITS, type Lang } from '$lib/vault/types';
import { t } from '$lib/i18n/fr';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const app = getApp();
	const vocab = loadVocab(app.ctx.paths.vocab);
	const view = ingredientView(app.ctx.db, params.slug, vocab);
	if (!view) error(404, t.ingredient.notFound);
	return {
		...view,
		path: ingredientPath(params.slug),
		entries: app.ctx.db.prepare('SELECT slug, name FROM registry WHERE slug <> ? ORDER BY name').all(params.slug) as { slug: string; name: string }[],
		allergenList: [...vocab.allergens].map(([slug, l]) => ({ slug, label: l.fr ?? slug })),
		categories: [...CATEGORIES],
		units: [...UNITS],
		money: { currency: app.config.currency, locale: app.config.locale }
	};
};

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const lines = (s: string) => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

async function run(action: string, fn: () => Promise<string>) {
	try {
		return { action, ok: true, message: await fn() };
	} catch (e) {
		if (e instanceof QueueError) return fail(409, { action, ok: false, message: e.message });
		throw e;
	}
}

export const actions: Actions = {
	alias: async ({ params, request, locals }) => {
		const f = await request.formData();
		return run('alias', async () => {
			await addAlias(writeContext(locals.user), params.slug, str(f, 'hash'), str(f, 'lang') as Lang, str(f, 'name'));
			return t.ingredient.nameAdded(str(f, 'name').replace(/\s+/g, ' '));
		});
	},
	link: async ({ params, request, locals }) => {
		const f = await request.formData();
		return run('link', async () => {
			await linkKey(writeContext(locals.user), str(f, 'key'), params.slug, str(f, 'hash'));
			return t.ingredient.linked(str(f, 'form'));
		});
	},
	edit: async ({ params, request, locals }) => {
		const f = await request.formData();
		const units = f.getAll('weight_unit').map(String);
		const grams = f.getAll('weight_g').map(String);
		return run('edit', async () => {
			await editEntry(writeContext(locals.user), params.slug, str(f, 'hash'), {
				names: Object.fromEntries(NAME_LANGS.map((l) => [l, lines(str(f, `names_${l}`))])) as Record<Lang, string[]>,
				category: str(f, 'category'),
				defaultUnit: str(f, 'default_unit'),
				staple: f.get('staple') === 'on',
				auGout: f.get('au_gout') === 'on',
				density: str(f, 'density'),
				weights: units.map((unit, i) => ({ unit, grams: grams[i] ?? '' })),
				substitutes: str(f, 'substitutes').split(/[,\s]+/),
				allergens: f.getAll('allergens').map(String)
			});
			return t.ingredient.saved;
		});
	},
	merge: async ({ params, request, locals }) => {
		const app = getApp();
		const f = await request.formData();
		const typed = str(f, 'into');
		const into =
			(app.ctx.db.prepare('SELECT slug FROM registry WHERE slug = ? OR name = ? LIMIT 1').pluck().get(typed, typed) as string | undefined) ??
			/\(([a-z0-9-]+)\)$/.exec(typed)?.[1] ??
			typed;
		const name = (app.ctx.db.prepare('SELECT name FROM registry WHERE slug = ?').pluck().get(params.slug) as string | undefined) ?? params.slug;
		const r = await run('merge', async () => {
			await mergeEntry(writeContext(locals.user), params.slug, into, str(f, 'hash'));
			return t.ingredient.merged(name, into);
		});
		if ('ok' in r && r.ok) redirect(303, `/ingredients/${into}?fusion=${encodeURIComponent(params.slug)}`);
		return r;
	}
};
