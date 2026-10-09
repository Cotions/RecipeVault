import { error, json } from '@sveltejs/kit';
import { getApp, writeContext } from '$lib/server/app';
import { savePaste, type Unsent } from '$lib/server/paste';
import { SaveError, type SaveFile } from '$lib/server/save';
import { SLUG_RE } from '$lib/vault/slug';
import { t } from '$lib/i18n/fr';
import type { RequestHandler } from './$types';

/** Recipes per save, sent and held back alike. */
const MAX = 50;

function valid(f: unknown): f is SaveFile {
	if (typeof f !== 'object' || f === null) return false;
	const o = f as Record<string, unknown>;
	if (typeof o.text !== 'string' || o.text.length > 200_000) return false;
	if (o.slug !== undefined && (typeof o.slug !== 'string' || !SLUG_RE.test(o.slug))) return false;
	if (o.overwrite !== undefined && typeof o.overwrite !== 'string') return false;
	if (o.family !== undefined) {
		const fam = o.family as Record<string, unknown>;
		if (typeof fam?.family !== 'string' || !SLUG_RE.test(fam.family) || typeof fam.variant !== 'string' || !fam.variant.trim()) return false;
		if (fam.pair !== undefined) {
			const p = fam.pair as Record<string, unknown>;
			if (typeof p?.slug !== 'string' || !SLUG_RE.test(p.slug) || typeof p.hash !== 'string' || typeof p.variant !== 'string' || !p.variant.trim()) return false;
		}
	}
	return true;
}

function validUnsent(u: unknown): u is Unsent {
	if (typeof u !== 'object' || u === null) return false;
	const o = u as Record<string, unknown>;
	return (
		Array.isArray(o.codes) &&
		o.codes.length <= 200 &&
		o.codes.every((c) => typeof c === 'string' && /^[EWI]\d{3}$/.test(c)) &&
		(o.slug === undefined || typeof o.slug === 'string')
	);
}

export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	// A paste of more than MAX files is a person's, not a broken client's: told so in French.
	if (Array.isArray(body?.files) && (body.files.length > MAX || (Array.isArray(body.unsent) && body.unsent.length > MAX))) error(413, t.add.tooMany(MAX));
	if (!body || !Array.isArray(body.files) || !body.files.length || !body.files.every(valid))
		error(400, 'files: { text, slug?, overwrite?, family?: { family, variant, pair?: { slug, hash, variant } } }[]');
	const unsent: unknown[] = body.unsent ?? [];
	if (!Array.isArray(unsent) || !unsent.every(validUnsent)) error(400, 'unsent: { codes: string[], slug?: string }[]');
	const app = getApp();
	try {
		// Only the fields the paste box sends: a file's name in a diagnostic is the server's own (`recipe N`).
		const files: SaveFile[] = (body.files as SaveFile[]).map(({ text, slug, overwrite, family }) => ({ text, slug, overwrite, family }));
		const result = await savePaste(app, files, unsent as Unsent[], writeContext(locals.user).author);
		return json(result);
	} catch (e) {
		if (e instanceof SaveError) error(500, e.message);
		throw e;
	}
};
