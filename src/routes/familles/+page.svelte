<script lang="ts">
	import PageHead from '$lib/components/PageHead.svelte';
	import { t, familyLabel } from '$lib/i18n';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>{t.families.title} — {t.app.name}</title></svelte:head>

<PageHead title={t.families.title} count={t.families.count(data.families.length)} intro={t.families.intro} />

{#if data.families.length}
	<ul class="list">
		{#each data.families as f (f.slug)}
			<li>
				<a href="/famille/{f.slug}">{familyLabel(f.slug, f.label)}</a>
				<span>{t.families.variants(f.count)}</span>
			</li>
		{/each}
	</ul>
{:else}
	<p class="intro">{t.families.empty}</p>
{/if}

<style>
	.intro {
		color: var(--ink-soft);
		font-family: var(--serif);
		font-size: var(--step-1);
		margin: 0.25rem 0 1.25rem;
	}
	.list {
		list-style: none;
		padding: 0;
		margin: 0;
		background: var(--card);
		border-top: 3px solid var(--rule-red);
		/* Alphabetical down each column: a wide screen shows the whole list. */
		columns: 3 18rem;
		column-gap: 0;
	}
	.list li {
		break-inside: avoid;
		display: flex;
		gap: 1rem;
		justify-content: space-between;
		align-items: baseline;
		padding: 0.7rem 1rem;
		border-bottom: 1px solid var(--rule-blue);
	}
	.list a {
		font-family: var(--serif);
		font-size: var(--step-1);
		font-weight: 700;
	}
	.list span {
		color: var(--ink-soft);
		font-size: var(--step--1);
	}
</style>
