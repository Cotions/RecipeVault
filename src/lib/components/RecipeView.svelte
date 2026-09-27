<script lang="ts">
	// A recipe as read: used by the recipe page and, identically, by the paste
	// box preview. Quantities rescale with the servings adjuster, in print too.
	import { t, tagLabel, familyLabel } from '$lib/i18n/fr';
	import { formatDurationValue, formatSeconds } from '$lib/render/duration';
	import { formatAmount } from '$lib/render/ingredient';
	import { renderMarkdown } from '$lib/render/markdown';
	import { MULTIPLIERS } from '$lib/render/scale';
	import { formatOven } from '$lib/render/temperature';
	import { formatNumber } from '$lib/render/fraction';
	import type { Recipe } from '$lib/vault/types';
	import IngredientLine from './IngredientLine.svelte';
	import Marked from './Marked.svelte';
	import StatusBadge from './StatusBadge.svelte';

	let {
		recipe,
		body,
		titles = {},
		photo = null,
		links = true,
		servings = $bindable(recipe.servings ?? 0),
		multiplier = $bindable(1)
	}: {
		recipe: Recipe;
		body: string;
		/** Titles of recipes this one links to (sub-recipes, wikilinks) that exist. */
		titles?: Record<string, string>;
		photo?: string | null;
		/** False in the paste preview: tags and family do not link away. */
		links?: boolean;
		servings?: number;
		multiplier?: number;
	} = $props();

	const lang = $derived(recipe.lang);
	const factor = $derived(recipe.servings ? servings / recipe.servings : multiplier);
	const html = $derived(renderMarkdown(body, { resolve: (s) => titles[s] }));
	const oven = $derived(recipe.oven ? formatOven(recipe.oven) : null);
	const kinds = $derived(new Set(recipe.markers.map((m) => (m.kind === 'uncertain-alt' ? 'uncertain' : m.kind))));

	const src = $derived(recipe.source);
	const sourceParts = $derived.by(() => {
		if (!src) return [] as string[];
		const out: string[] = [];
		if (src.title) out.push(src.page !== undefined ? `${src.title}, ${t.recipe.page} ${src.page}` : src.title);
		else if (src.page !== undefined) out.push(`${t.recipe.page} ${src.page}`);
		if (src.note) out.push(src.note);
		return out;
	});

	const times = $derived(
		(
			[
				['prep', t.recipe.prep],
				['cook', t.recipe.cook],
				['rest', t.recipe.rest],
				['total', t.recipe.total]
			] as const
		)
			.map(([k, label]) => ({ label, value: recipe.times?.[k] }))
			.filter((x) => x.value)
	);
	const computedTotal = $derived.by(() => {
		const tm = recipe.times;
		if (!tm || tm.total) return null;
		const parts = [tm.prep, tm.cook, tm.rest].filter((d) => d !== undefined);
		if (parts.length < 2) return null;
		return parts.reduce((n, d) => n + (d.maxSeconds ?? d.seconds), 0);
	});

	const yieldText = $derived.by(() => {
		const y = recipe.yield;
		if (!y) return null;
		if (typeof y === 'string') return y;
		const amount = formatAmount(y, { lang, factor });
		return [amount, y.note].filter(Boolean).join(' ');
	});

	const heic = $derived(!!photo && /\.hei[cf]$/i.test(photo));

	function host(url: string): string {
		try {
			return new URL(url).hostname || url;
		} catch {
			return url;
		}
	}
</script>

<article class="recipe" lang={lang}>
	<header class="head">
		{#if recipe.family}
			<p class="family">
				{#if links}<a href="/famille/{recipe.family}">{familyLabel(recipe.family)}</a>{:else}{familyLabel(recipe.family)}{/if}
				{#if recipe.variant}<span class="variant">— {recipe.variant.replace(/-/g, ' ')}</span>{/if}
			</p>
		{/if}
		<h1><Marked text={recipe.title} /></h1>
		{#if src}
			<p class="source">
				{#if src.author}{t.recipe.by} <strong><Marked text={src.author} /></strong>{/if}
				{#if src.author && (sourceParts.length || src.url || src.type)}<span aria-hidden="true"> — </span>{/if}
				{#if !src.author}{t.source[src.type] ?? src.type}{#if sourceParts.length || src.url}<span aria-hidden="true"> — </span>{/if}{/if}
				{#each sourceParts as part, i (i)}{#if i > 0}, {/if}<Marked text={part} />{/each}
				{#if src.url}{#if sourceParts.length}, {/if}<a href={src.url} rel="noopener noreferrer external">{host(src.url)}</a>{/if}
			</p>
		{/if}
		<p class="status"><StatusBadge status={recipe.status} /></p>
	</header>

	<dl class="facts">
		{#each times as tm (tm.label)}
			<div><dt>{tm.label}</dt><dd>{formatDurationValue(tm.value!, lang)}</dd></div>
		{/each}
		{#if computedTotal}
			<div><dt>{t.recipe.total}</dt><dd>{formatSeconds(computedTotal, lang)}</dd></div>
		{/if}
		{#if oven}
			<div><dt>{t.recipe.oven}</dt><dd>{oven.written} <span class="conv">({oven.converted})</span></dd></div>
		{/if}
		{#if recipe.servings}
			<div>
				<dt>{t.recipe.servings}</dt>
				<dd>
					{formatNumber(servings, lang)}{#if recipe.servingsMax && servings === recipe.servings}&nbsp;à&nbsp;{recipe.servingsMax}{/if}
					{#if recipe.servingsNote}<span class="conv"><Marked text={recipe.servingsNote} /></span>{/if}
				</dd>
			</div>
		{/if}
		{#if yieldText}
			<div><dt>{t.recipe.yield}</dt><dd><Marked text={yieldText} /></dd></div>
		{/if}
	</dl>

	{#if recipe.tags.length || recipe.season.length}
		<ul class="tags" aria-label="Étiquettes">
			{#each recipe.tags as tag (tag)}
				<li>{#if links}<a href="/?tag={encodeURIComponent(tag)}">{tagLabel(tag)}</a>{:else}{tagLabel(tag)}{/if}</li>
			{/each}
			{#each recipe.season as s (s)}
				<li class="season">{t.season[s] ?? s}</li>
			{/each}
		</ul>
	{/if}

	{#if photo}
		<figure class="photo">
			{#if heic}
				<div class="heic">{t.recipe.heic}</div>
			{:else}
				<img src={photo} alt={t.recipe.photo} loading="lazy" decoding="async" />
			{/if}
		</figure>
	{/if}

	<div class="columns">
		<section class="ingredients" aria-labelledby="ingredients-title">
			<div class="ing-head">
				<h2 id="ingredients-title">{t.recipe.ingredients}</h2>
				<div class="scaler no-print">
					{#if recipe.servings}
						<button class="step" type="button" aria-label={t.recipe.decrease} disabled={servings <= 1} onclick={() => (servings = Math.max(1, servings - 1))}>−</button>
						<output aria-live="polite">{servings} <span class="unit">{t.recipe.scale.toLowerCase()}</span></output>
						<button class="step" type="button" aria-label={t.recipe.increase} onclick={() => (servings = servings + 1)}>+</button>
						{#if servings !== recipe.servings}
							<button class="btn quiet" type="button" onclick={() => (servings = recipe.servings!)}>{t.recipe.reset}</button>
						{/if}
					{:else}
						<label>
							<span class="visually-hidden">{t.recipe.scaleFactor}</span>
							<select bind:value={multiplier}>
								{#each MULTIPLIERS as m (m)}
									<option value={m}>× {formatNumber(m, lang)}</option>
								{/each}
							</select>
						</label>
					{/if}
				</div>
				{#if factor !== 1}
					<p class="print-only scaled">× {formatNumber(factor, lang)}</p>
				{/if}
			</div>
			{#each recipe.ingredients as g, gi (gi)}
				<div class="group" class:optional={g.optional}>
					{#if g.group || g.optional}
						<h3>
							{#if g.group}<Marked text={g.group} />{/if}
							{#if g.optional}<span class="opt">({t.recipe.optionalGroup})</span>{/if}
						</h3>
					{/if}
					<ul>
						{#each g.items as item, ii (ii)}
							<li><IngredientLine {item} {factor} {lang} {titles} /></li>
						{/each}
					</ul>
				</div>
			{/each}
		</section>

		<section class="method">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdown-it with html: false -->
			{@html html}
		</section>
	</div>

	{#if kinds.size}
		<aside class="legend" aria-label={t.recipe.legend}>
			{#if kinds.has('uncertain')}<span><mark class="mk mk-uncertain">[?]</mark> {t.recipe.legendUncertain}</span>{/if}
			{#if kinds.has('illegible')}<span><mark class="mk mk-illegible">[illisible]</mark> {t.recipe.legendIllegible}</span>{/if}
			{#if kinds.has('added')}<span><mark class="mk mk-added">[+]</mark> {t.recipe.legendAdded}</span>{/if}
		</aside>
	{/if}
</article>

<style>
	.recipe {
		background: var(--card);
		border-top: 3px solid var(--rule-red);
		padding: 1.25rem 1rem 1.5rem;
		box-shadow: 0 1px 0 var(--line);
	}
	@media (min-width: 48rem) {
		.recipe {
			padding: 2rem 2.25rem 2.25rem;
		}
	}
	.family {
		margin: 0 0 0.25rem;
		font-weight: 600;
		color: var(--ink-soft);
	}
	.variant {
		font-weight: 400;
	}
	h1 {
		font-size: var(--step-3);
		max-width: 30ch;
	}
	@media (min-width: 48rem) {
		h1 {
			font-size: var(--step-4);
		}
	}
	.source {
		margin: 0.5rem 0 0;
		font-family: var(--serif);
		font-size: var(--step-1);
		color: var(--ink-soft);
	}
	.source strong {
		color: var(--ink);
		font-weight: 600;
	}
	.status {
		margin: 0.5rem 0 0;
	}
	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.75rem;
		margin: 1.25rem 0 0;
		padding: 0.75rem 0;
		border-block: 1px solid var(--line);
	}
	.facts div {
		display: flex;
		flex-direction: column;
	}
	.facts dt {
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.facts dd {
		margin: 0;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.conv {
		font-weight: 400;
		color: var(--ink-soft);
	}
	.tags {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0.9rem 0 0;
		padding: 0;
	}
	.tags li {
		font-size: var(--step--1);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 0.05rem 0.5rem;
	}
	.tags a {
		text-decoration: none;
	}
	.tags .season {
		color: var(--ink-soft);
		border-style: dashed;
	}
	.photo {
		margin: 1.25rem 0 0;
	}
	.photo img {
		display: block;
		width: 100%;
		max-height: 26rem;
		object-fit: cover;
		border-radius: var(--radius);
	}
	.heic {
		padding: 2rem 1rem;
		text-align: center;
		color: var(--ink-soft);
		background: repeating-linear-gradient(45deg, #f1f3f5, #f1f3f5 10px, #e9ecf0 10px, #e9ecf0 20px);
	}
	.columns {
		display: grid;
		gap: 1.75rem;
		margin-top: 1.5rem;
	}
	@media (min-width: 56rem) {
		.columns {
			grid-template-columns: minmax(18rem, 5fr) 7fr;
			gap: 2.5rem;
		}
	}
	h2 {
		font-size: var(--step-2);
	}
	.ing-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding-bottom: 0.4rem;
		border-bottom: 2px solid var(--rule-red);
	}
	.scaler {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.scaler output {
		min-width: 5.5rem;
		text-align: center;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.scaler .unit {
		font-weight: 400;
		color: var(--ink-soft);
	}
	.step {
		width: 2.25rem;
		height: 2.25rem;
		border: 1.5px solid var(--ink);
		border-radius: 50%;
		background: var(--card);
		font-size: 1.25rem;
		line-height: 1;
		cursor: pointer;
	}
	.step:disabled {
		opacity: 0.4;
	}
	.print-only {
		display: none;
	}
	.group h3 {
		font-family: var(--sans);
		font-size: var(--step-0);
		margin: 1rem 0 0;
		color: var(--ink);
	}
	.group.optional h3 .opt {
		font-weight: 400;
		color: var(--ink-soft);
	}
	.group.optional ul {
		color: var(--ink-soft);
	}
	/* The faint blue ruled lines of the card. */
	.group ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.group li {
		padding: 0.45rem 0 0.35rem;
		border-bottom: 1px solid var(--rule-blue);
		line-height: 1.4;
	}
	.method {
		font-family: var(--serif);
		font-size: var(--step-1);
		line-height: 1.6;
		max-width: var(--measure);
	}
	.method :global(h2) {
		font-size: var(--step-2);
		margin: 0 0 0.5rem;
		padding-bottom: 0.4rem;
		border-bottom: 2px solid var(--rule-red);
	}
	.method :global(h2 ~ h2) {
		margin-top: 1.75rem;
	}
	.method :global(h3) {
		font-size: var(--step-1);
		margin: 1.25rem 0 0.25rem;
	}
	.method :global(ol) {
		padding-left: 1.6rem;
		margin: 0.5rem 0;
	}
	.method :global(ol li) {
		padding-left: 0.3rem;
		margin-bottom: 0.6rem;
	}
	.method :global(ol li::marker) {
		font-family: var(--sans);
		font-weight: 700;
		color: var(--rule-red);
	}
	.method :global(p) {
		margin: 0.5rem 0;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.5rem;
		margin-top: 1.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--line);
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	@media print {
		.recipe {
			border: 0;
			box-shadow: none;
			padding: 0;
		}
		h1 {
			font-size: 20pt;
		}
		.photo,
		.status {
			display: none;
		}
		.columns {
			grid-template-columns: 2fr 3fr;
			gap: 1.5rem;
			break-inside: avoid;
		}
		.method {
			font-size: 11pt;
		}
		.print-only {
			display: block;
			margin: 0;
		}
		.group li {
			padding: 0.15rem 0;
		}
	}
</style>
