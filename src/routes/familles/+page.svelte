<script lang="ts">
	import { t, familyLabel } from '$lib/i18n/fr';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>{t.families.title}</title></svelte:head>

<h1>{t.families.title}</h1>
<p class="intro">{t.families.intro}</p>

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
	h1 {
		font-size: var(--step-3);
	}
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
		max-width: 40rem;
	}
	.list li {
		display: flex;
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
