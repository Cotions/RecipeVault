import { error, json } from '@sveltejs/kit';
import { getApp, writeContext } from '$lib/server/app';
import { savePaste, type Unsent } from '$lib/server/paste';
import { SaveError, type SaveFile } from '$lib/server/save';
import { SLUG_RE } from '$lib/vault/slug';
import type { RequestHandler } from './$types';

function valid(f: unknown): f is SaveFile {
	if (typeof f !== 'object' || f === null) return false;
	const o = f as Record<string, unknown>;
	if (typeof o.text !== 'string' || o.text.length > 200_000) return false;
	if (o.slug !== undefined && (typeof o.slug !== 'string' || !SLUG_RE.test(o.slug))) return false;
	if (o.overwrite !== undefined && typeof o.overwrite !== 'string') return false;
	if (o.family !== undefined) {
		const fam = o.family as Record<string, unknown>;
		if (typeof fam?.family !== 'string' || !SLUG_RE.test(fam.family) || typeof fam.variant !== 'string' || !fam.variant.trim()) return false;
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
	if (!body || !Array.isArray(body.files) || !body.files.length || body.files.length > 50 || !body.files.every(valid))
		error(400, 'files: { text, slug?, overwrite?, family? }[]');
	const unsent: unknown[] = body.unsent ?? [];
	if (!Array.isArray(unsent) || unsent.length > 50 || !unsent.every(validUnsent)) error(400, 'unsent: { codes: string[], slug?: string }[]');
	const app = getApp();
	try {
		const result = await savePaste(app, body.files, unsent as Unsent[], writeContext(locals.user).author);
		return json(result);
	} catch (e) {
		if (e instanceof SaveError) error(500, e.message);
		throw e;
	}
};
