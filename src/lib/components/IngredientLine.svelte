<script lang="ts">
	import { t } from '$lib/i18n/fr';
	import { ingredientParts, type ScaleBase } from '$lib/render/ingredient';
	import type { ScalingRules } from '$lib/render/scale';
	import { ingredientHref, queueHref } from '$lib/render/links';
	import type { Ingredient, Lang } from '$lib/vault/types';
	import Marked from './Marked.svelte';

	let {
		item,
		factor = 1,
		lang,
		titles = {},
		link,
		rules = null,
		onscale,
		subHref
	}: {
		item: Ingredient;
		factor?: number;
		/** vocab/scaling.yaml: how amounts show at a factor other than 1 (plan 05). */
		rules?: ScalingRules | null;
		/** Recipe page: an amount is a button; tapped, the page asks what she has (plan 05, Q8 B). */
		onscale?: (base: ScaleBase) => void;
		lang: Lang;
		titles?: Record<string, string>;
		/** How the line resolved (recipe page only): the name links to its entry, or is marked not linked. */
		link?: { item?: string; key?: string };
		/** Recipe page: a sub-recipe's link at the amount this line needs (plan 05, Q5 A); else its page as written. */
		subHref?: (line: Ingredient) => string;
	} = $props();

	const parts = $derived(ingredientParts(item, { factor, lang, rules }));
</script>

{#each parts as p, i (i)}{#if p.kind === 'approx'}<abbr class="approx" title={t.scaling.approxTitle}>{p.text.trim()}</abbr>{' '}{:else if p.kind === 'amount'}{#if onscale && p.base}<button type="button" class="amount tap" title={t.scaling.tapTitle} onclick={() => onscale(p.base!)}>{p.text}</button>{:else}<span class="amount">{p.text}</span>{/if}{:else if p.kind === 'name'}{#if p.recipe && titles[p.recipe]}<a
				class="name"
				href={subHref && p.line ? subHref(p.line) : `/r/${p.recipe}`}><Marked text={p.text} /></a
			>{:else if link?.item}<a class="name item" href={ingredientHref(link.item)} title={t.cost.linkTitle(link.item)}><Marked text={p.text} /></a
			>{:else}<span class="name"><Marked text={p.text} /></span>{#if link?.key}{' '}<a class="unlinked no-print" href={queueHref(link.key)} title={t.cost.unlinkedTitle}
					>{t.cost.unlinked}</a
				>{/if}{/if}{:else if p.kind === 'muted'}{#if onscale && p.base}<button type="button" class="muted tap" title={t.scaling.tapTitle} onclick={() => onscale(p.base!)}>{p.text}</button>{:else}<span class="muted"
			><Marked text={p.text} /></span
		>{/if}{:else}<Marked text={p.text} />{/if}{/each}

<style>
	.approx {
		text-decoration: none;
		font-weight: 700;
		color: var(--rule-red);
		cursor: help;
	}
	.amount {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.muted {
		color: var(--ink-soft);
	}
	/* A tappable amount: reads as the amount, with a dotted underline. */
	.tap {
		font: inherit;
		font-weight: inherit;
		color: inherit;
		background: none;
		border: 0;
		padding: 0.15rem 0;
		margin: -0.15rem 0;
		cursor: pointer;
		text-decoration: underline dotted var(--ink-soft);
		text-underline-offset: 0.25em;
	}
	.amount.tap {
		font-weight: 700;
	}
	@media print {
		.tap {
			text-decoration: none;
		}
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
