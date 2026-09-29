// Dish photo upload and removal (plan 04, Phase 6). Signed-in only: the write
// guard in hooks.server.ts answers 401 before this runs, and writeContext
// commits as the person. The photo's content decides its type, never its name.
//
// POST multipart/form-data: slug, hash (of the recipe file the page showed), photo (the file)
//   → { file, placeholder, commit }
// DELETE application/json: { slug, hash } → { commit }   ("Retirer la photo")
// Refusals: 400 (no file), 409 (the recipe changed or is gone, or fails the checker),
// 413 (too big), 415 (not a photo, or unreadable) — each with a French `message`.

import { error, json } from '@sveltejs/kit';
import { writeContext } from '$lib/server/app';
import { addPhoto, PHOTO_MAX_BYTES, PhotoError, removePhoto } from '$lib/server/photos';
import { SaveError } from '$lib/server/save';
import { SLUG_RE } from '$lib/vault/slug';
import type { RequestHandler } from './$types';

const STATUS: Record<PhotoError['reason'], number> = { empty: 400, 'too-big': 413, type: 415, unreadable: 415, gone: 409, stale: 409, invalid: 409 };

function refused(e: unknown) {
	if (e instanceof PhotoError) return json({ message: e.message, reason: e.reason }, { status: STATUS[e.reason] });
	if (e instanceof SaveError) error(500, e.message);
	throw e;
}

export const POST: RequestHandler = async ({ request, locals }) => {
	// Refuse on the declared length before reading a body far over the cap (multipart overhead allowed for).
	const declared = Number(request.headers.get('content-length') ?? 0);
	if (declared > PHOTO_MAX_BYTES + 64 * 1024) return refused(new PhotoError('too-big', `la photo dépasse ${PHOTO_MAX_BYTES / 1024 / 1024} Mo.`));
	const form = await request.formData().catch(() => null);
	if (!form) error(400, 'multipart/form-data: slug, hash, photo');
	const slug = String(form.get('slug') ?? '');
	const hash = String(form.get('hash') ?? '');
	const photo = form.get('photo');
	if (!SLUG_RE.test(slug) || !/^[0-9a-f]{64}$/.test(hash)) error(400, 'slug, hash');
	if (!(photo instanceof File)) return refused(new PhotoError('empty', 'aucune photo reçue.'));
	try {
		const r = await addPhoto(writeContext(locals.user), slug, hash, Buffer.from(await photo.arrayBuffer()));
		return json(r);
	} catch (e) {
		return refused(e);
	}
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	const slug = String(body?.slug ?? '');
	const hash = String(body?.hash ?? '');
	if (!SLUG_RE.test(slug) || !/^[0-9a-f]{64}$/.test(hash)) error(400, '{ slug, hash }');
	try {
		return json(await removePhoto(writeContext(locals.user), slug, hash));
	} catch (e) {
		return refused(e);
	}
};
