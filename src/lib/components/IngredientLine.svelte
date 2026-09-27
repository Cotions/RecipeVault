<script lang="ts">
	import { ingredientParts } from '$lib/render/ingredient';
	import type { Ingredient, Lang } from '$lib/vault/types';
	import Marked from './Marked.svelte';

	let {
		item,
		factor = 1,
		lang,
		titles = {}
	}: { item: Ingredient; factor?: number; lang: Lang; titles?: Record<string, string> } = $props();

	const parts = $derived(ingredientParts(item, { factor, lang }));
</script>

{#each parts as p, i (i)}{#if p.kind === 'amount'}<span class="amount">{p.text}</span>{:else if p.kind === 'name'}{#if p.recipe && titles[p.recipe]}<a
				class="name"
				href="/r/{p.recipe}"><Marked text={p.text} /></a
			>{:else}<span class="name"><Marked text={p.text} /></span>{/if}{:else if p.kind === 'muted'}<span class="muted"
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
</style>
