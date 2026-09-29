// Autosave (plan 04, Q17 A): the form state in the browser's localStorage,
// one slot per recipe and one for a new recipe, offered back when the form is
// opened again. Nothing goes to the server until she saves; a draft never
// enters the vault or git. Browser-safe: the storage is passed in.

import { reviveDuration } from './duration';
import type { FormRecipe } from './model';

export interface Draft {
	form: FormRecipe;
	/** The hash of the file the form was opened from (an edit), for the stale-write guard. */
	hash?: string;
	/** When it was written (ms since epoch). */
	at: number;
}

const PREFIX = 'recipevault:draft:';

/** The slot of a recipe, or of the new-recipe form. */
export const draftKey = (slug?: string) => PREFIX + (slug || ':nouvelle');

export function saveDraft(storage: Storage, key: string, draft: Draft): boolean {
	try {
		storage.setItem(key, JSON.stringify(draft));
		return true;
	} catch {
		// Full or disabled storage: the form keeps working, only without a safety net.
		return false;
	}
}

export function loadDraft(storage: Storage, key: string): Draft | undefined {
	try {
		const raw = storage.getItem(key);
		if (!raw) return undefined;
		const d = JSON.parse(raw) as Draft;
		if (!d || typeof d !== 'object' || !d.form || d.form.version !== 1 || typeof d.at !== 'number') return undefined;
		for (const t of Object.values(d.form.times ?? {})) if (t && typeof t === 'object') reviveDuration(t);
		return d;
	} catch {
		return undefined;
	}
}

export function clearDraft(storage: Storage, key: string): void {
	try {
		storage.removeItem(key);
	} catch {
		/* nothing to do */
	}
}

/** Two form states hold the same thing (ids aside: a reopened form gets new ones). */
export function sameForm(a: FormRecipe, b: FormRecipe): boolean {
	return JSON.stringify(a, (k, v) => (k === 'id' ? undefined : v)) === JSON.stringify(b, (k, v) => (k === 'id' ? undefined : v));
}
