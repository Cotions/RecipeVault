import { error, json } from '@sveltejs/kit';
import { writeContext } from '$lib/server/app';
import { formSave, type FormSaveRequest } from '$lib/server/formsave';
import { SLUG_RE } from '$lib/vault/slug';
import { validForm } from '../valid';
import type { RequestHandler } from './$types';

// The form's save (plan 04, Phase 3): one request, the whole form as JSON.
// An error the checker still finds is a gap in the form: formSave logs it with
// its code and answers `invalid` with the error on its field, which the page
// names (VALIDATION.md, "never a generic failure"). Only a failure that is not
// the checker's (disk, git) is `failed`: "rien n'a changé".
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	if (!body || !validForm(body.form)) error(400, 'form');
	const req: FormSaveRequest = { form: body.form };
	if (body.base !== undefined) {
		if (typeof body.base?.slug !== 'string' || !SLUG_RE.test(body.base.slug) || typeof body.base.hash !== 'string') error(400, 'base');
		req.base = { slug: body.base.slug, hash: body.base.hash };
	}
	if (body.familyLabel !== undefined) {
		if (typeof body.familyLabel !== 'string') error(400, 'familyLabel');
		req.familyLabel = body.familyLabel;
	}
	if (body.pair !== undefined) {
		const p = body.pair;
		if (typeof p?.slug !== 'string' || !SLUG_RE.test(p.slug) || typeof p.hash !== 'string' || typeof p.variant !== 'string') error(400, 'pair');
		req.pair = { slug: p.slug, hash: p.hash, variant: p.variant };
	}
	const ctx = writeContext(locals.user);
	try {
		return json(await formSave(ctx, req));
	} catch (e) {
		ctx.log(`recipevault: form save failed: ${(e as Error).message}`);
		return json({ status: 'failed' });
	}
};
