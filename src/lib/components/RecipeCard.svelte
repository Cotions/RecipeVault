<script lang="ts">
	import { t, familyLabel } from '$lib/i18n/fr';
	import { formatSeconds } from '$lib/render/duration';
	import type { Card } from '$lib/server/index/query';
	import Marked from './Marked.svelte';
	import StatusBadge from './StatusBadge.svelte';

	let { card }: { card: Card } = $props();
	const photo = $derived(card.photo && !/\.hei[cf]$/i.test(card.photo) ? `/media/${card.slug}/${encodeURIComponent(card.photo)}` : null);
</script>

<li class="card" class:has-photo={photo}>
	<a class="main" href="/r/{card.slug}">
		<span class="title"><Marked text={card.title} /></span>
		{#if card.family}
			<span class="family">{familyLabel(card.family)}{#if card.variant}{` — ${card.variant.replace(/-/g, ' ')}`}{/if}</span>
		{/if}
	</a>
	<p class="meta">
		{#if card.total_s}<span>{formatSeconds(card.total_s)}</span>{/if}
		{#if card.servings}<span>{t.card.servings(card.servings, card.servings_max)}</span>{/if}
		{#if card.status !== 'draft' || card.broken}<StatusBadge status={card.status} broken={card.broken} />{/if}
	</p>
	{#if photo}
		<img src={photo} alt="" loading="lazy" decoding="async" width="72" height="72" />
	{/if}
</li>

<style>
	.card {
		position: relative;
		display: grid;
		grid-template-columns: 1fr auto;
		grid-template-areas: 'main photo' 'meta photo';
		gap: 0.2rem 0.75rem;
		align-content: start;
		background: var(--card);
		padding: 0.8rem 1rem 0.75rem;
		border-top: 2px solid var(--rule-red);
		box-shadow: 0 1px 0 var(--line);
	}
	.main {
		grid-area: main;
		display: flex;
		flex-direction: column;
		text-decoration: none;
		color: var(--ink);
	}
	/* The whole card is the link's target area. */
	.main::after {
		content: '';
		position: absolute;
		inset: 0;
	}
	.main:focus-visible {
		outline: none;
	}
	.card:has(.main:focus-visible) {
		outline: 3px solid var(--focus);
		outline-offset: 2px;
	}
	.card:hover .title {
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 0.15em;
	}
	.title {
		font-family: var(--serif);
		font-size: var(--step-1);
		font-weight: 700;
		line-height: 1.25;
	}
	.family {
		color: var(--ink-soft);
		font-size: var(--step--1);
		margin-top: 0.1rem;
	}
	.meta {
		grid-area: meta;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.9rem;
		margin: 0.25rem 0 0;
		font-size: var(--step--1);
		color: var(--ink-soft);
		font-variant-numeric: tabular-nums;
	}
	img {
		grid-area: photo;
		width: 72px;
		height: 72px;
		object-fit: cover;
		border-radius: var(--radius);
	}
</style>
