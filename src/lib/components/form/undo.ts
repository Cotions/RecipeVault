// "Annuler" in the toast after a save (plan 04, Phase 4.8; Phase 7): each
// commit of the save undone as a new commit, newest first (the photo's, then
// the recipe's). A new recipe undone goes to the trash. When one commit was
// undone, the toast then offers "Rétablir" (undo the undo).

import { goto, invalidateAll } from '$app/navigation';
import { t, form as f } from '$lib/i18n/fr';
import { toast } from '$lib/toast.svelte';

type Undone = { ok: true; action: 'undone' | 'trashed' | 'untrashed'; commit: string | null } | { ok: false; message: string };

async function post(slug: string, commit: string): Promise<Undone> {
	try {
		const res = await fetch('/api/form/undo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, commit }) });
		const data = await res.json().catch(() => ({}));
		if (!res.ok || !data.ok) return { ok: false, message: data.message ?? t.history.errors.failed };
		return data as Undone;
	} catch {
		return { ok: false, message: f.offline };
	}
}

const said = (action: string) => (action === 'trashed' ? t.history.trashedByUndo : action === 'untrashed' ? t.history.untrashedByUndo : t.history.undone);

/** Undo `commits` (newest first) of the recipe `slug`, then say what happened. */
export async function undoSave(slug: string, commits: string[], redoing = false): Promise<void> {
	let last: Undone | undefined;
	for (const c of commits) {
		last = await post(slug, c);
		if (!last.ok) break;
	}
	if (!last) return;
	if (!last.ok) {
		toast.show({ text: f.undoFailed(last.message), error: true });
		return;
	}
	const redo = commits.length === 1 && last.commit ? last.commit : undefined;
	toast.show({ text: redoing && last.action === 'undone' ? f.redone : said(last.action), ...(redo ? { action: { label: redoing ? f.undo : t.history.redo, run: () => undoSave(slug, [redo], !redoing) } } : {}) });
	if (last.action === 'trashed') await goto('/corbeille');
	else if (last.action === 'untrashed') await goto(`/r/${slug}`);
	else await invalidateAll();
}
