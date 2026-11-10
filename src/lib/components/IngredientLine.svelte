<script lang="ts">
	import { t } from '$lib/i18n';
	import { ingredientParts, type NameForms, type ScaleBase } from '$lib/render/ingredient';
	import type { ScalingRules } from '$lib/render/scale';
	import { ingredientHref, queueHref } from '$lib/render/links';
	import type { Ingredient, Lang, Unit } from '$lib/vault/types';
	import Marked from './Marked.svelte';

	let {
		item,
		factor = 1,
		lang,
		titles = {},
		link,
		rules = null,
		onscale,
		subHref,
		plainNames = false
	}: {
		item: Ingredient;
		factor?: number;
		/** vocab/scaling.yaml: how amounts show at a factor other than 1 (plan 05). */
		rules?: ScalingRules | null;
		/** Recipe page: an amount is a button; tapped, the page asks what she has (plan 05, Q8 B). */
		onscale?: (base: ScaleBase, from: HTMLElement) => void;
		lang: Lang;
		titles?: Record<string, string>;
		/** How the line resolved (recipe page only): the name links to its entry, or is marked not linked. */
		link?: { item?: string; key?: string; weights?: Partial<Record<Unit, number>>; forms?: NameForms };
		/** Recipe page: a sub-recipe's link at the amount this line needs (plan 05, Q5 A); else its page as written. */
		subHref?: (line: Ingredient) => string;
		/** Recipe page: names are words, never links (a tap on the line ticks it); the page puts the links after the line. */
		plainNames?: boolean;
	} = $props();

	const parts = $derived(ingredientParts(item, { factor, lang, rules, gramsPerUnit: link?.weights?.[item.unit ?? 'piece'], forms: link?.forms }));
</script>

{#each parts as p, i (i)}{#if p.kind === 'approx'}<abbr class="approx" title={t.scaling.approxTitle}>{p.text.trim()}</abbr>{' '}{:else if p.kind === 'amount'}{#if onscale && p.base}<button type="button" class="amount tap" title={t.scaling.tapTitle} onclick={(e) => onscale(p.base!, e.currentTarget)}>{p.text}</button>{:else}<span class="amount">{p.text}</span>{/if}{:else if p.kind === 'name'}{#if plainNames}<span class="name"><Marked text={p.text} /></span>{:else if p.recipe && titles[p.recipe]}<a
				class="name"
				href={subHref && p.line ? subHref(p.line) : `/r/${p.recipe}`}><Marked text={p.text} /></a
			>{:else if link?.item}<a class="name item" href={ingredientHref(link.item)} title={t.cost.linkTitle(link.item)}><Marked text={p.text} /></a
			>{:else}<span class="name"><Marked text={p.text} /></span>{#if link?.key}{' '}<a class="unlinked no-print" href={queueHref(link.key)} title={t.cost.unlinkedTitle}
					>{t.cost.unlinked}</a
				>{/if}{/if}{:else if p.kind === 'muted'}{#if onscale && p.base}{p.text.startsWith(' ') ? ' ' : ''}<button type="button" class="muted tap" title={t.scaling.tapTitle} onclick={(e) => onscale(p.base!, e.currentTarget)}>{p.text.trimStart()}</button>{:else}<span class="muted"
			><Marked text={p.text} /></span
		>{/if}{:else}<Marked text={p.text} />{/if}{/each}

<style>
	/* Rounding is routine, not an alarm: the soft ink, regular weight (UI round 2). Red is the card's rule and the errors'. */
	.approx {
		text-decoration: none;
		font-weight: 400;
		color: var(--ink-soft);
		cursor: help;
	}
	.amount {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.muted {
		color: var(--ink-soft);
	}
	/* A tappable amount: reads as the amount, with a dotted underline in the
	   ink (it can be tapped); its target is a thumb's height and at least a
	   thumb's width (an invisible band, ::after) without making the line any
	   taller. The band grows to the right only, so it never reaches over the
	   row's checkbox at its left (usability round 4). */
	.tap {
		position: relative;
		font: inherit;
		font-weight: inherit;
		color: inherit;
		background: none;
		border: 0;
		padding: 0;
		margin: 0;
		cursor: pointer;
		text-decoration: underline dotted var(--ink);
		text-decoration-thickness: 1.5px;
		text-underline-offset: 0.25em;
	}
	.tap::after {
		content: '';
		position: absolute;
		left: 0;
		width: max(100%, 2.75rem);
		top: 50%;
		height: 2.75rem;
		transform: translateY(-50%);
	}
	.tap:hover {
		text-decoration-style: solid;
	}
	.muted.tap {
		text-decoration-color: currentColor;
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
