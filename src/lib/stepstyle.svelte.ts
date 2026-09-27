// How the recipe page and its print show the method's steps: bullets (the
// default) or numbered. A choice of this device, kept in localStorage — no
// server state. Kitchen mode is not affected: it shows one step at a time.

const KEY = 'rv-steps';

/** Read in the browser only (`loadStepStyle` from onMount): the server always renders bullets. */
export const stepStyle = $state({ numbered: false });

export function loadStepStyle(): void {
	try {
		stepStyle.numbered = localStorage.getItem(KEY) === 'numbered';
	} catch {
		// storage unavailable: bullets
	}
}

export function setNumbered(numbered: boolean): void {
	stepStyle.numbered = numbered;
	try {
		if (numbered) localStorage.setItem(KEY, 'numbered');
		else localStorage.removeItem(KEY);
	} catch {
		// storage unavailable: the choice lasts for this page only
	}
}
