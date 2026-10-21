<script lang="ts">
	// One page head for every page: a way back when the page sits under
	// another, the title, its count, and the page's actions on the right (the
	// primary one, then a ⋯ menu for the rest); the intro under it.
	import type { Snippet } from 'svelte';

	let {
		title,
		count,
		intro,
		back,
		kicker,
		actions,
		titleSnippet,
		meta
	}: {
		title?: string;
		count?: string | null;
		intro?: string | null;
		/** The page this one sits under. */
		back?: { href: string; label: string } | null;
		/** A small word above the title (« Historique »). */
		kicker?: string | null;
		actions?: Snippet;
		/** A title with markup (a recipe title with its markers). */
		titleSnippet?: Snippet;
		/** A line beside the title with markup, where a count would go. */
		meta?: Snippet;
	} = $props();
</script>

<header class="page-head">
	{#if back}<p class="back no-print"><a href={back.href}>← {back.label}</a></p>{/if}
	<div class="row">
		<div class="name">
			{#if kicker}<p class="kicker">{kicker}</p>{/if}
			<h1>{#if titleSnippet}{@render titleSnippet()}{:else}{title}{/if}</h1>
			{#if count}<p class="count">{count}</p>{/if}
			{#if meta}<p class="count">{@render meta()}</p>{/if}
		</div>
		{#if actions}<div class="actions no-print">{@render actions()}</div>{/if}
	</div>
	{#if intro}<p class="intro">{intro}</p>{/if}
</header>

<style>
	.page-head {
		margin: 0 0 1.25rem;
	}
	.back {
		margin: 0 0 0.35rem;
		font-size: var(--step--1);
	}
	@media (pointer: coarse) {
		.back a {
			display: inline-flex;
			align-items: center;
			min-height: 44px;
		}
	}
	.row {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
	}
	.name {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0 0.9rem;
		min-width: 0;
	}
	.kicker {
		flex-basis: 100%;
		margin: 0;
		font-size: var(--step--1);
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}
	h1 {
		margin: 0;
		font-size: var(--step-3);
		line-height: 1.15;
	}
	.count {
		margin: 0;
		color: var(--ink-soft);
		font-weight: 600;
	}
	.actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-left: auto;
	}
	.actions :global(form) {
		display: contents;
	}
	.intro {
		margin: 0.5rem 0 0;
		max-width: var(--measure);
		color: var(--ink-soft);
	}
</style>
