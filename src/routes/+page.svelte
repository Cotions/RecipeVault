<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { t, tagLabel, familyLabel, form as tf } from '$lib/i18n/fr';
	import DiagnosticItem from '$lib/components/DiagnosticItem.svelte';
	import RecipeCard from '$lib/components/RecipeCard.svelte';
	import type { FacetName } from '$lib/server/index/query';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// URL parameter per facet: state lives in the URL so a filtered view can be
	// bookmarked and the back button works.
	const PARAM: Record<FacetName, string> = {
		family: 'famille',
		tags: 'tag',
		season: 'saison',
		time: 'temps',
		servings: 'portions',
		source: 'source',
		author: 'auteur',
		status: 'etat',
		unresolved: 'relies'
	};
	const ORDER: FacetName[] = ['family', 'tags', 'season', 'time', 'servings', 'status', 'source', 'author', 'unresolved'];
	const SHOWN = 8;

	// svelte-ignore state_referenced_locally -- kept in sync by the effect below
	let q = $state(data.params.q ?? '');
	let sheetOpen = $state(false);
	let expanded = $state<Record<string, boolean>>({});
	let timer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		// Back/forward: the box follows the URL, unless the person is typing.
		const fromUrl = data.params.q ?? '';
		if (document.activeElement?.id !== 'search') q = fromUrl;
	});

	function href(mutate: (s: URLSearchParams) => void): string {
		const s = new URLSearchParams(page.url.searchParams);
		mutate(s);
		s.delete('page');
		const qs = s.toString();
		return qs ? `/?${qs}` : '/';
	}

	function toggle(facet: FacetName, value: string): string {
		const key = PARAM[facet];
		return href((s) => {
			const current = s.getAll(key);
			if (facet === 'tags') {
				s.delete(key);
				const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
				next.forEach((v) => s.append(key, v));
			} else if (current.includes(value)) s.delete(key);
			else s.set(key, value);
		});
	}

	function active(facet: FacetName, value: string): boolean {
		return page.url.searchParams.getAll(PARAM[facet]).includes(value);
	}

	/** The values listed before "N de plus": the first SHOWN, plus every active one further down (never hidden). */
	function shown<V extends { value: string }>(facet: FacetName, values: V[]): V[] {
		if (expanded[facet]) return values;
		return values.filter((v, i) => i < SHOWN || active(facet, v.value));
	}

	const activeCount = $derived(ORDER.reduce((n, f) => n + page.url.searchParams.getAll(PARAM[f]).length, 0));

	function label(facet: FacetName, value: string): string {
		switch (facet) {
			case 'family':
				return familyLabel(value, data.familyLabels[value]);
			case 'tags':
				return tagLabel(value, data.tagLabels?.[value]);
			case 'season':
				return t.season[value] ?? value;
			case 'time':
				return t.time[value] ?? value;
			case 'servings':
				return t.servings[value] ?? value;
			case 'status':
				return t.status[value] ?? value;
			case 'source':
				return t.source[value] ?? value;
			case 'unresolved':
				return t.browse.unresolved[value] ?? value;
			default:
				return value;
		}
	}

	function search() {
		clearTimeout(timer);
		timer = setTimeout(() => {
			const target = href((s) => {
				if (q.trim()) s.set('q', q.trim());
				else s.delete('q');
				if (!q.trim() && s.get('sort') === 'relevance') s.delete('sort');
			});
			goto(target, { keepFocus: true, replaceState: true, noScroll: true });
		}, 180);
	}

	function sortTo(value: string) {
		goto(
			href((s) => {
				if (value) s.set('sort', value);
				else s.delete('sort');
			}),
			{ noScroll: true }
		);
	}

	function pageHref(p: number): string {
		const s = new URLSearchParams(page.url.searchParams);
		if (p > 1) s.set('page', String(p));
		else s.delete('page');
		return `/?${s.toString()}`;
	}

	const r = $derived(data.result);
	const currentSort = $derived(data.params.sort ?? (data.params.q ? 'relevance' : 'title'));
</script>

<svelte:head>
	<title>{t.browse.title}</title>
</svelte:head>

<form class="search" role="search" onsubmit={(e) => (e.preventDefault(), search())}>
	<label class="visually-hidden" for="search">{t.browse.searchLabel}</label>
	<input id="search" type="search" name="q" placeholder={t.browse.search} autocomplete="off" bind:value={q} oninput={search} />
</form>

{#if data.problems.length}
	<details class="problems">
		<summary>{t.browse.problems(data.problems.length)}</summary>
		<ul>
			{#each data.problems as p (p.file_path)}
				<li>
					<code class="file">{p.file_path}</code>
					<ul class="diags">
						{#each p.diagnostics as d, i (i)}<DiagnosticItem {d} />{/each}
					</ul>
				</li>
			{/each}
		</ul>
		<p class="hint">{t.diagnostics.vaultHint}</p>
	</details>
{/if}

<div class="layout">
	<aside class="facets" class:open={sheetOpen} aria-label={t.browse.filters}>
		<div class="sheet-head">
			<h2>{t.browse.filters}</h2>
			{#if activeCount}<a class="clear" href={data.params.q ? `/?q=${encodeURIComponent(data.params.q)}` : '/'}>{t.browse.clear}</a>{/if}
		</div>
		{#each ORDER as facet (facet)}
			{@const values = r.facets[facet]}
			{@const listed = shown(facet, values)}
			{#if values.length}
				<section>
					<h3>{t.browse.facets[facet]}</h3>
					<ul>
						{#each listed as v (v.value)}
							<li>
								<a
									href={toggle(facet, v.value)}
									data-sveltekit-noscroll
									data-sveltekit-keepfocus
									class:active={active(facet, v.value)}
									aria-current={active(facet, v.value) ? 'true' : undefined}
									title={v.pending ? t.browse.pending : undefined}
								>
									<span class="v" class:pending={v.pending}>{label(facet, v.value)}</span>
									<span class="n">{v.count}</span>
								</a>
							</li>
						{/each}
					</ul>
					{#if expanded[facet] ? values.length > SHOWN : listed.length < values.length}
						<button class="btn quiet more" type="button" onclick={() => (expanded[facet] = !expanded[facet])}>
							{expanded[facet] ? t.browse.less : t.browse.more(values.length - listed.length)}
						</button>
					{/if}
				</section>
			{/if}
		{/each}
		<button class="btn primary close" type="button" onclick={() => (sheetOpen = false)}>{t.browse.closeFilters} ({r.total})</button>
	</aside>

	<section class="results" aria-live="polite">
		<div class="toolbar">
			<p class="count">{t.browse.count(r.total)}</p>
			{#if data.user}<a class="btn primary new" href="/nouvelle" data-testid="new-recipe">{tf.nav}</a>{/if}
			<button class="btn filters-btn" type="button" onclick={() => (sheetOpen = true)}>
				{t.browse.showFilters}{#if activeCount}&nbsp;({activeCount}){/if}
			</button>
			<label class="sort">
				<span>{t.browse.sort}</span>
				<select value={currentSort} onchange={(e) => sortTo(e.currentTarget.value)}>
					{#each Object.entries(t.browse.sorts) as [value, text] (value)}
						{#if value !== 'relevance' || data.params.q}
							<option {value}>{text}</option>
						{/if}
					{/each}
				</select>
			</label>
		</div>

		{#if r.items.length}
			<ul class="cards">
				{#each r.items as card (card.slug)}
					<RecipeCard {card} />
				{/each}
			</ul>
			{#if r.pages > 1}
				<nav class="pager" aria-label="Pages">
					{#if r.page > 1}<a class="btn" href={pageHref(r.page - 1)}>{t.browse.prev}</a>{:else}<span></span>{/if}
					<span>{t.browse.page(r.page, r.pages)}</span>
					{#if r.page < r.pages}<a class="btn" href={pageHref(r.page + 1)}>{t.browse.next}</a>{:else}<span></span>{/if}
				</nav>
			{/if}
		{:else if data.vaultEmpty}
			<p class="empty">{t.browse.emptyVault} <a href="/nouvelle">{tf.nav}</a></p>
		{:else}
			<p class="empty">{t.browse.empty}</p>
		{/if}
	</section>
</div>

<style>
	.search input {
		width: 100%;
		font-size: var(--step-1);
		min-height: 3.25rem;
		padding: 0.6rem 0.9rem;
		border-width: 2px;
		border-color: var(--ink);
		font-family: var(--serif);
	}
	.problems {
		margin-top: 0.75rem;
		background: #fbeceb;
		border-left: 4px solid var(--rule-red);
		padding: 0.5rem 0.9rem;
	}
	.problems summary {
		cursor: pointer;
		font-weight: 600;
	}
	.problems > ul {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0;
	}
	.problems .file {
		font-weight: 600;
	}
	.problems .diags {
		padding: 0;
		margin: 0.2rem 0 0.6rem;
	}
	.problems .hint {
		font-size: var(--step--1);
		color: var(--ink-soft);
		margin: 0.25rem 0 0;
	}
	.layout {
		display: grid;
		gap: 1.5rem;
		margin-top: 1.25rem;
	}
	@media (min-width: 60rem) {
		.layout {
			grid-template-columns: 15rem 1fr;
			gap: 2.5rem;
		}
	}
	.facets h2 {
		font-size: var(--step-1);
	}
	.sheet-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	.clear {
		font-size: var(--step--1);
	}
	.facets section {
		margin-top: 1.1rem;
	}
	.facets h3 {
		font-family: var(--sans);
		font-size: var(--step--1);
		font-weight: 700;
		color: var(--ink-soft);
		margin-bottom: 0.25rem;
	}
	.facets ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.facets li a {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.3rem 0.4rem;
		margin-inline: -0.4rem;
		border-radius: var(--radius);
		color: var(--ink);
		text-decoration: none;
	}
	.facets li a:hover {
		background: #e8edf3;
	}
	.facets li a.active {
		background: var(--ink);
		color: #fff;
	}
	.facets .n {
		color: var(--ink-soft);
		font-variant-numeric: tabular-nums;
		font-size: var(--step--1);
	}
	.facets a.active .n {
		color: #cdd5e1;
	}
	.pending {
		font-style: italic;
	}
	.more {
		font-size: var(--step--1);
		min-height: 2rem;
		margin-left: -0.4rem;
	}
	.close,
	.filters-btn {
		display: none;
	}
	/* Phone: the filters are a sheet over the list. */
	@media (max-width: 59.99rem) {
		.facets {
			display: none;
		}
		.facets.open {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 40;
			overflow-y: auto;
			background: var(--paper);
			padding: 1rem 1rem 5rem;
		}
		.facets.open .close {
			display: flex;
			justify-content: center;
			position: fixed;
			inset: auto 1rem 1rem;
		}
		.filters-btn {
			display: inline-flex;
		}
	}
	.toolbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		margin-bottom: 0.75rem;
	}
	.count {
		margin: 0;
		font-weight: 700;
		margin-right: auto;
	}
	.sort {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.cards {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.75rem;
	}
	@media (min-width: 40rem) {
		.cards {
			grid-template-columns: repeat(auto-fill, minmax(19rem, 1fr));
		}
	}
	.pager {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: 1.5rem;
		color: var(--ink-soft);
	}
	.empty {
		padding: 2rem 0;
		color: var(--ink-soft);
		font-size: var(--step-1);
		font-family: var(--serif);
	}
</style>
