// One toast at a time, shown by the layout, surviving a client navigation
// (the form saves, goes to the recipe, and the toast with "Annuler" is there).

export interface ToastAction {
	label: string;
	run: () => void | Promise<void>;
}

export interface Toast {
	text: string;
	action?: ToastAction;
	link?: { href: string; label: string };
	error?: boolean;
}

let current = $state<{ toast: Toast; id: number } | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let seq = 0;

export const toast = {
	get current() {
		return current;
	},
	/** Show a toast; it closes itself after `ms` (default 10 s — long enough to reach "Annuler"). */
	show(t: Toast, ms = 10_000) {
		clearTimeout(timer);
		current = { toast: t, id: ++seq };
		if (ms > 0) timer = setTimeout(() => (current = null), ms);
	},
	close() {
		clearTimeout(timer);
		current = null;
	}
};
