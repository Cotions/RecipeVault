import { error, json } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { serverCheck } from '$lib/server/paste';
import { loadVocab } from '$lib/server/vocab';
import { resemblesSlugs } from '$lib/vault/quickfix';
import { parseRecipe } from '$lib/vault/parse';
import { valueAt } from '$lib/vault/locate';
import { preselectTag } from '$lib/vault/tagmatch';
import { fold } from '$lib/vault/normalize';
import { stripMarkers } from '$lib/vault/markers';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body || !Array.isArray(body.files) || !body.files.every((f: unknown) => typeof f === 'string')) error(400, 'files: string[]');
	if (body.files.length > 50) error(413, 'too many files');
	const app = getApp();
	const files = serverCheck(app, body.files);
	// The registry names of the ingredients a W305 says a line resembles, so the
	// paste box names them (« ressemble à « huile végétale » »), not their slugs.
	const slugs = [...new Set(files.flatMap((f) => f.diagnostics.flatMap(resemblesSlugs)))];
	const names: Record<string, string> = {};
	if (slugs.length) {
		const rows = app.ctx.db.prepare(`SELECT slug, name FROM registry WHERE slug IN (${slugs.map(() => '?').join(',')})`).all(...slugs) as { slug: string; name: string }[];
		for (const r of rows) names[r.slug] = r.name;
	}
	// Per unknown tag (W501): the known tag it is the same word as, as /etiquettes
	// preselects it (lib/vault/tagmatch.ts) — a food of the registry (« pain »)
	// matched on its ending only, never a course one letter away (« main »).
	// `null`: no suggestion, she keeps it and it waits in Étiquettes.
	const tags: Record<string, string | null> = {};
	const unknown = files.flatMap((f, i) => {
		if (!f.diagnostics.some((d) => d.code === 'W501')) return [];
		const fm = parseRecipe(body.files[i]).frontmatter;
		return f.diagnostics.flatMap((d) => (d.code === 'W501' ? [valueAt(fm, d.path)] : [])).filter((x): x is string => !!x);
	});
	if (unknown.length) {
		const vocab = loadVocab(app.ctx.paths.vocab);
		const food = app.ctx.db.prepare('SELECT 1 FROM ingredient_names WHERE key = ? OR skey = ? UNION SELECT 1 FROM registry WHERE slug = ? LIMIT 1').pluck();
		for (const value of new Set(unknown)) {
			const key = fold(stripMarkers(value));
			tags[value] = preselectTag(vocab.tags, value, { food: !!food.get(key, key, key.replace(/\s+/g, '-')) }) ?? null;
		}
	}
	return json({ files, names, tags });
};
