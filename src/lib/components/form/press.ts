// Nothing moves under a pointer that is down. A press on a button blurs the
// field she was typing in; whatever that blur shows or hides (a time's error,
// « Pas encore relié », the row before folding on a phone) would move the
// button between the press and the release, and the click would land on
// nothing. Such a change waits until the press is over (its click done).
// Browser-safe: on the server nothing is wired and `afterPress` runs at once.

let down = false;
let waiting: (() => void)[] = [];

function release() {
	if (!down) return;
	down = false;
	const run = waiting;
	waiting = [];
	if (!run.length) return;
	let done = false;
	const go = () => {
		if (done) return;
		done = true;
		window.removeEventListener('click', onClick, true);
		run.forEach((f) => f());
	};
	// After the click's own handlers (a click follows the release in the same input), or soon if none comes.
	const onClick = () => setTimeout(go, 0);
	window.addEventListener('click', onClick, true);
	setTimeout(go, 250);
}

if (typeof window !== 'undefined') {
	window.addEventListener('pointerdown', () => (down = true), true);
	window.addEventListener('pointerup', release, true);
	window.addEventListener('pointercancel', release, true);
	window.addEventListener('dragstart', release, true);
}

/** Run `fn` now, or once the press in progress is released and its click handled. */
export function afterPress(fn: () => void): void {
	if (down) waiting.push(fn);
	else fn();
}
