// The recipe page's « Cuisiner », carried by the phone's bottom bar once the
// head's own button has scrolled out of sight (the bar slides away while
// reading down and comes back at the first move up, so Cuisiner is one flick
// away anywhere on the page, the four tabs still beside it).
//
// Written in the browser only (an effect, an IntersectionObserver), never
// while the server renders: module state there would be shared between
// requests.

export const cookbar = $state<{
	href: string | null;
	offscreen: boolean;
	/** The cell's word when not « Cuisiner »: « Reprendre » while this recipe has a cook in progress (the recipe page sets it with `href`). */
	label?: string | null;
}>({ href: null, offscreen: false, label: null });

/** `use:watchCook` on the head's Cuisiner: the bar offers it while that button is out of sight. */
export function watchCook(node: HTMLElement): { destroy(): void } {
	if (typeof IntersectionObserver === 'undefined') return { destroy() {} };
	const io = new IntersectionObserver(([e]) => {
		cookbar.offscreen = !e.isIntersecting;
	});
	io.observe(node);
	return {
		destroy() {
			io.disconnect();
			cookbar.offscreen = false;
		}
	};
}
