import { error, json } from '@sveltejs/kit';
import { getApp } from '$lib/server/app';
import { formCheck } from '$lib/server/formsave';
import { SLUG_RE } from '$lib/vault/slug';
import { validForm } from '../valid';
import type { RequestHandler } from './$types';

// The vault hints for a form being typed (plan 04, Q9 A): the save's check,
// nothing written. A POST for its body; the guard asks for a session like any
// other POST, and the form is only open to someone signed in.
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body || !validForm(body.form)) error(400, 'form');
	const base = body.base;
	if (base !== undefined && (typeof base?.slug !== 'string' || !SLUG_RE.test(base.slug) || typeof base.hash !== 'string')) error(400, 'base');
	try {
		return json(formCheck(getApp().ctx, body.form, base));
	} catch {
		return json({ hints: [], same: [] });
	}
};
