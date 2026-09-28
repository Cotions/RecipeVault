<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { t } from '$lib/i18n/fr';
	import { ingredientHref } from '$lib/render/links';
	import Marked from '$lib/components/Marked.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const KEY = 'recipevault:garde-manger';
	const LISTS = [
		{ key: 'have', label: t.pantry.have },
		{ key: 'must', label: t.pantry.must },
		{ key: 'avoid', label: t.pantry.avoid }
	] as const;

	/** This pantry without one slug in one list. */
	function without(list: string, slug: string): string {
		const q = new URLSearchParams(data.qs);
		const rest = (q.get(list) ?? '').split(',').filter((s) => s && s !== slug);
		if (rest.length) q.set(list, rest.join(','));
		else q.delete(list);
		const s = q.toString().replace(/%2C/g, ',');
		return `/garde-manger${s ? `?${s}` : ''}`;
	}
	function moreHref(tier: string): string {
		const q = new URLSearchParams(data.qs);
		q.set('voir', tier);
		return `/garde-manger?${q.toString().replace(/%2C/g, ',')}#${tier}`;
	}
	const name = (s: string) => data.names[s] ?? s;
	const searched = $derived(data.lists.have.length + data.lists.must.length > 0);
	const found = $derived(data.tiers.reduce((n, x) => n + x.total, 0));

	// The last pantry is kept on this device: an empty /garde-manger reopens it.
	onMount(() => {
		const q = page.url.searchParams;
		if (![...q.keys()].length) {
			const last = localStorage.getItem(KEY);
			if (last) goto(`/garde-manger?${last}`, { replaceState: true });
		}
	});
	// On every navigation, not only the first: the route stays mounted.
	$effect(() => {
		if (page.url.searchParams.has('vide')) localStorage.removeItem(KEY);
		else if (data.lists.have.length || data.lists.must.length) localStorage.setItem(KEY, data.qs);
	});
</script>

<svelte:head><title>{t.pantry.title} — {t.app.name}</title></svelte:head>

<h1>{t.pantry.title}</h1>
<p class="meta">{t.pantry.intro}</p>

{#if data.unknown}<p class="flash error" role="alert">{t.pantry.unknown(data.unknown)}</p>{/if}

<form method="GET" class="pantry no-print" data-sveltekit-keepfocus>
	<input type="hidden" name="form" value="1" />
	{#each LISTS as l (l.key)}
		{#if data.lists[l.key].length}<input type="hidden" name={l.key} value={data.lists[l.key].map((x) => x.slug).join(',')} />{/if}
	{/each}
	<div class="add">
		<label>
			{t.pantry.add}
			<input name="ajout" list="pantry-names" autocomplete="off" aria-describedby="pantry-add-help" value={data.unknown ?? ''} />
		</label>
		<label>
			{t.pantry.addTo}
			<select name="ou">
				{#each LISTS as l (l.key)}<option value={l.key}>{l.label}</option>{/each}
			</select>
		</label>
		<button>{t.pantry.addSubmit}</button>
		<datalist id="pantry-names">
			{#each data.aliases as a (a)}<option value={a}></option>{/each}
		</datalist>
	</div>
	<p class="soft" id="pantry-add-help">{t.pantry.addHelp}</p>

	{#each LISTS as l (l.key)}
		{#if data.lists[l.key].length}
			<div class="chips {l.key}">
				<span class="label">{l.label}</span>
				<ul>
					{#each data.lists[l.key] as x (x.slug)}
						<li><a href={without(l.key, x.slug)} aria-label={t.pantry.remove(x.name)} data-slug={x.slug}>{x.name} <span aria-hidden="true">×</span></a></li>
					{/each}
				</ul>
			</div>
		{/if}
	{/each}

	<fieldset class="options">
		{#if data.allergenList.length}
			<legend>{t.pantry.allergens}</legend>
			{#each data.allergenList as a (a.slug)}
				<label class="check"><input type="checkbox" name="allergene" value={a.slug} checked={data.allergens.includes(a.slug)} /> {a.label}</label>
			{/each}
		{/if}
		<label class="check staples"><input type="checkbox" name="essentiels" value="oui" checked={data.assume} /> {t.pantry.staples}</label>
		<button>{t.pantry.apply}</button>
		{#if searched}<a class="clear" href="/garde-manger?vide=1">{t.pantry.clear}</a>{/if}
	</fieldset>
</form>

{#if !searched}
	<p class="soft">{t.pantry.empty}</p>
{:else if !found}
	<p class="soft">{t.pantry.none}</p>
{:else}
	{#each data.tiers as tier (tier.tier)}
		{#if tier.total}
			<section class="tier" id={tier.tier} data-tier={tier.tier}>
				<h2>{t.pantry.tiers[tier.tier]} <span class="soft">({t.pantry.count(tier.total)})</span></h2>
				<p class="soft">{t.pantry.tierHelp[tier.tier]}</p>
				<ol class="results">
					{#each tier.results as r (r.slug)}
						<li>
							<a class="title" href="/r/{r.slug}"><Marked text={r.title} /></a>
							<span class="coverage" title={t.pantry.coverageTitle}>{t.pantry.coverage(r.matched, r.required)}</span>
							{#if r.swaps.length}
								<span class="swaps">{t.pantry.swaps}
									{#each r.swaps as s, i (s.missing)}{i ? ', ' : ' '}<a href={ingredientHref(s.missing)}>{name(s.missing)}</a> → <a href={ingredientHref(s.with)}>{name(s.with)}</a>{/each}</span>
							{:else if r.missing.length}
								<span class="missing">{t.pantry.missing}
									{#each r.missing as m, i (i)}{i ? ', ' : ' '}{#each m as s, j (s)}{j ? t.pantry.or : ''}<a href={ingredientHref(s)}>{name(s)}</a>{/each}{/each}</span>
							{/if}
							{#if r.unresolved}<span class="unresolved" title={t.pantry.unresolvedTitle}>{t.pantry.unresolved(r.unresolved)}</span>{/if}
						</li>
					{/each}
				</ol>
				{#if tier.total > tier.results.length}
					<p><a href={moreHref(tier.tier)}>{t.pantry.more(tier.total - tier.results.length)}</a></p>
				{/if}
			</section>
		{/if}
	{/each}
{/if}

<style>
	h1 {
		font-size: var(--step-3);
		margin: 0;
	}
	h2 {
		font-size: var(--step-1);
		margin: 1.5rem 0 0.2rem;
	}
	.meta,
	.soft {
		color: var(--ink-soft);
	}
	.soft {
		font-size: var(--step--1);
		margin: 0.2rem 0;
	}
	.flash.error {
		padding: 0.6rem 1rem;
		background: #fbeceb;
		border-left: 4px solid var(--rule-red);
		margin: 0.75rem 0;
		max-width: 48rem;
	}
	.pantry {
		margin: 1rem 0;
		max-width: 48rem;
	}
	.add {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: end;
	}
	.add label {
		display: flex;
		flex-direction: column;
		font-size: var(--step--1);
	}
	.chips {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
		margin: 0.5rem 0;
	}
	.chips .label {
		font-size: var(--step--1);
		color: var(--ink-soft);
		min-width: 6rem;
	}
	.chips ul {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.chips a {
		display: inline-block;
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 0.1rem 0.6rem;
		text-decoration: none;
		color: inherit;
	}
	.chips.avoid a {
		text-decoration: line-through;
	}
	.options {
		border: 0;
		padding: 0;
		margin: 0.75rem 0 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1rem;
		align-items: center;
	}
	.options legend {
		font-size: var(--step--1);
		color: var(--ink-soft);
		padding: 0;
	}
	.check {
		font-size: var(--step--1);
	}
	.results {
		padding-left: 1.5rem;
		max-width: 48rem;
	}
	.results li {
		margin: 0.3rem 0;
	}
	.results li > span {
		font-size: var(--step--1);
		color: var(--ink-soft);
		margin-left: 0.5rem;
	}
	.coverage {
		font-variant-numeric: tabular-nums;
	}
</style>
