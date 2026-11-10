// Settling a row of a queue page (/doublons, /etiquettes, /resoudre): the
// row folds away the moment she decides, the list takes no click while it
// moves (the next click lands where she sees it, not on the row sliding up),
// and the decision's message comes in the app's toast with « Annuler » for
// 10 s — the same as after a save. A refusal brings the row back and says why
// in the toast. Without JavaScript the forms post as plain forms and the page
// shows its message itself.

import { applyAction, deserialize } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { toast } from '$lib/toast.svelte';

/** What an action returns for the toast: its sentence, and the fields « Annuler » posts back to `?/undo`. */
export interface Settled {
	ok: boolean;
	message: string;
	undo?: Record<string, string | string[]>;
}

/** How long the list takes no click after a row folds away (the CSS transition, and a little). */
const SETTLE_MS = 350;

export async function post(action: string, fields: Record<string, string | string[]>): Promise<ActionResult> {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) body.append(k, x);
	const res = await fetch(action, { method: 'POST', body, headers: { accept: 'application/json', 'x-sveltekit-action': 'true' } });
	return deserialize(await res.text());
}

const messageOf = (r: ActionResult): string | undefined =>
	r.type === 'success' || r.type === 'failure' ? ((r.data as Partial<Settled> | undefined)?.message ?? undefined) : undefined;

export class Settling {
	/** The rows folded away, waiting for the server (or gone with the next data). */
	gone = $state(new Set<string>());
	/** True while the list takes no click. */
	busy = $state(false);
	#timer: ReturnType<typeof setTimeout> | undefined;

	#hold() {
		this.busy = true;
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => (this.busy = false), SETTLE_MS);
	}

	/** `use:enhance={settling.form(key)}` on each decision's form of row `key`; `onok` after a decision went through. */
	form(key: string, onok?: (data: Settled) => void | Promise<void>): SubmitFunction {
		return () => {
			this.gone = new Set([...this.gone, key]);
			this.#hold();
			return async ({ result }) => {
				if (result.type === 'success' && (result.data as Partial<Settled> | undefined)?.ok) {
					// The confirmation and its « Annuler » at once; the row stays folded until the new data is in.
					undoToast(result.data as unknown as Settled);
					await invalidateAll();
					this.#back(key);
					await onok?.(result.data as unknown as Settled);
				} else {
					this.#back(key);
					const message = messageOf(result);
					if (message) toast.show({ text: message, error: true });
					else await applyAction(result);
				}
			};
		};
	}

	#back(key: string) {
		const next = new Set(this.gone);
		next.delete(key);
		this.gone = next;
	}

}

/**
 * The decision's sentence in the toast, with « Annuler » when it can be
 * undone: posts `data.undo` to `action` (this page's `?/undo` by default);
 * `onundone` once that went through (/doublons drops the card's receipt).
 */
export function undoToast(data: Settled, action = '?/undo', onundone?: () => void) {
	const undo = data.undo;
	toast.show({
		text: data.message,
		...(undo
			? {
					action: {
						label: t.app.undo,
						run: async () => {
							const r = await post(action, undo);
							const message = messageOf(r);
							if (r.type === 'success') {
								onundone?.();
								await invalidateAll();
								toast.show({ text: message ?? t.app.undone }, 4000);
							} else toast.show({ text: message ?? t.app.undoFailed, error: true });
						}
					}
				}
			: {})
	});
}
