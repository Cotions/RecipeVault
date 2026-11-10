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
		badgeLabel,
		current = false,
		align = 'end',
		children
	}: {
		/** What the button says to a screen reader, and as a tooltip. */
		label: string;
		/** What it shows; ⋯ by default. */
		text?: string;
		testid?: string;
		/** Decisions waiting inside: their number as text on the button, 99+ at most (« Plus · 3 »); the counts by kind on the items. */
		badge?: number;
		/** What the number counts, by kind (« 2 étiquettes à décider »): for a screen reader, and in the tooltip after `label`. */
		badgeLabel?: string;
		/** The page shown is one of the menu's: the button is marked current (the tabs' underline). */
		current?: boolean;
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
	<summary class="btn" class:dots={!text} class:current aria-label={text ? undefined : label} title={badge && badgeLabel ? `${label} — ${badgeLabel}` : label} data-testid={testid}>
		{text ?? '⋯'}{#if badge}<span class="menu-n" aria-hidden="true" data-testid={testid ? `${testid}-n` : undefined}><span class="sep">·</span>{badge > 99 ? '99+' : badge}</span>{#if badgeLabel}<span
					class="visually-hidden">, {badgeLabel}</span
				>{/if}{/if}
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
		background: var(--hover);
	}
	/* Decisions waiting, not an error and not an alarm: « Plus · 3 », the
	   number as text in navy small caps (usability round 4: a dot or a stamp
	   alone said nothing to a thumb), capped at 99+. */
	.menu-n {
		margin-left: 0.3rem;
		color: var(--ink);
		font-weight: 700;
		font-variant-caps: all-small-caps;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.04em;
	}
	.menu-n .sep {
		margin-right: 0.3rem;
		font-weight: 400;
	}
	.panel {
		position: absolute;
		top: calc(100% + 0.3rem);
		z-index: 30;
		min-width: 14rem;
		max-width: min(22rem, calc(100vw - 2rem));
		padding: 0.35rem 0;
		background: var(--card);
		border: 1px solid var(--edge);
		border-top: 1px solid var(--edge);
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
	/* A thumb: every item a full 44 px on a phone or a touch screen. */
	@media (max-width: 40rem), (pointer: coarse) {
		.panel :global(a),
		.panel :global(button) {
			min-height: 44px;
		}
	}
	.panel :global(a:hover),
	.panel :global(button:hover:not(:disabled)) {
		background: var(--hover);
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
