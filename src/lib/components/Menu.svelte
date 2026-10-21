<script lang="ts">
	// The ⋯ menu: the rare and secondary actions of a page, or of the header,
	// behind one button instead of a row of them. A <details>, so it opens
	// without JavaScript; with it, it closes on Escape, on a click outside and
	// once something inside was chosen. The items are links, buttons and forms
	// as they would be anywhere else.
	import type { Snippet } from 'svelte';

	let {
		label,
		text,
		testid,
		badge = 0,
		align = 'end',
		children
	}: {
		/** What the button says to a screen reader, and as a tooltip. */
		label: string;
		/** What it shows; ⋯ by default. */
		text?: string;
		testid?: string;
		/** Things waiting inside: a dot on the button, the counts are on the items. */
		badge?: number;
		/** Which edge of the button the panel lines up with. */
		align?: 'start' | 'end';
		children: Snippet;
	} = $props();

	let menu: HTMLDetailsElement | undefined = $state();

	function close(focus = false) {
		if (!menu?.open) return;
		menu.open = false;
		if (focus) menu.querySelector('summary')?.focus();
	}
</script>

<svelte:window
	onclick={(e) => {
		if (menu?.open && !menu.contains(e.target as Node)) close();
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape' && menu?.open && menu.contains(document.activeElement)) close(true);
	}}
/>

<details class="menu" bind:this={menu}>
	<summary class="btn" class:dots={!text} aria-label={text ? undefined : label} title={label} data-testid={testid}>
		{text ?? '⋯'}{#if badge}<span class="dot" aria-hidden="true"></span>{/if}
	</summary>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -- a click inside is a choice made; the keyboard goes through the items themselves -->
	<div
		class="panel {align}"
		onclick={(e) => {
			if ((e.target as Element).closest('a, button[type="button"]')) close();
		}}
		onsubmit={() => close()}
	>
		{@render children()}
	</div>
</details>

<style>
	.menu {
		position: relative;
		display: inline-block;
	}
	summary {
		list-style: none;
		user-select: none;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary.dots {
		font-size: 1.25rem;
		line-height: 1;
		padding-inline: 0.7rem;
		letter-spacing: 0.05em;
	}
	.menu[open] > summary {
		background: #eef2f7;
	}
	.dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--rule-red);
	}
	.panel {
		position: absolute;
		top: calc(100% + 0.3rem);
		z-index: 30;
		min-width: 14rem;
		max-width: min(22rem, calc(100vw - 2rem));
		padding: 0.35rem 0;
		background: var(--card);
		border: 1px solid var(--line);
		border-top: 3px solid var(--rule-red);
		border-radius: var(--radius);
		box-shadow: 0 6px 24px rgb(28 42 66 / 0.14);
		display: flex;
		flex-direction: column;
	}
	.panel.end {
		right: 0;
	}
	.panel.start {
		left: 0;
	}
	/* Every item, link or button, reads as one row of the list. */
	.panel :global(a),
	.panel :global(button) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		width: 100%;
		min-height: 2.5rem;
		padding: 0.4rem 1rem;
		border: 0;
		background: none;
		color: var(--ink);
		font: inherit;
		font-weight: 500;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
		white-space: nowrap;
	}
	.panel :global(a:hover),
	.panel :global(button:hover:not(:disabled)) {
		background: #eef2f7;
	}
	.panel :global(a[aria-current='page']) {
		font-weight: 700;
		box-shadow: inset 3px 0 0 var(--ink);
	}
	.panel :global(button:disabled) {
		color: var(--pencil);
		cursor: not-allowed;
	}
	.panel :global(.danger) {
		color: var(--rule-red);
	}
	.panel :global(form) {
		display: contents;
	}
	.panel :global(hr) {
		width: 100%;
		margin: 0.35rem 0;
		border: 0;
		border-top: 1px solid var(--line);
	}
	.panel :global(.note) {
		padding: 0 1rem 0.4rem;
		margin: 0;
		color: var(--ink-soft);
		font-size: var(--step--1);
		white-space: normal;
	}
	@media print {
		.menu {
			display: none;
		}
	}
</style>
