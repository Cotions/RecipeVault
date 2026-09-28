<script lang="ts">
	import { t } from '$lib/i18n/fr';
	import { ingredientParts } from '$lib/render/ingredient';
	import { ingredientHref, queueHref } from '$lib/render/links';
	import type { Ingredient, Lang } from '$lib/vault/types';
	import Marked from './Marked.svelte';

	let {
		item,
		factor = 1,
		lang,
		titles = {},
		link
	}: {
		item: Ingredient;
		factor?: number;
		lang: Lang;
		titles?: Record<string, string>;
		/** How the line resolved (recipe page only): the name links to its entry, or is marked not linked. */
		link?: { item?: string; key?: string };
	} = $props();

	const parts = $derived(ingredientParts(item, { factor, lang }));
</script>

{#each parts as p, i (i)}{#if p.kind === 'amount'}<span class="amount">{p.text}</span>{:else if p.kind === 'name'}{#if p.recipe && titles[p.recipe]}<a
				class="name"
				href="/r/{p.recipe}"><Marked text={p.text} /></a
			>{:else if link?.item}<a class="name item" href={ingredientHref(link.item)} title={t.cost.linkTitle(link.item)}><Marked text={p.text} /></a
			>{:else}<span class="name"><Marked text={p.text} /></span>{#if link?.key}{' '}<a class="unlinked no-print" href={queueHref(link.key)} title={t.cost.unlinkedTitle}
					>{t.cost.unlinked}</a
				>{/if}{/if}{:else if p.kind === 'muted'}<span class="muted"
			><Marked text={p.text} /></span
		>{:else}<Marked text={p.text} />{/if}{/each}

<style>
	.amount {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.muted {
		color: var(--ink-soft);
	}
	.item {
		color: inherit;
		text-decoration: underline dotted var(--line);
		text-underline-offset: 0.2em;
	}
	.item:hover {
		color: var(--link);
	}
	.unlinked {
		font-size: var(--step--1);
		color: var(--ink-soft);
		white-space: nowrap;
	}
</style>
