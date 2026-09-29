<script lang="ts">
	import RecipeForm from '$lib/components/form/RecipeForm.svelte';
	import { t, form as f } from '$lib/i18n/fr';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{f.editTitle} — {t.app.name}</title>
</svelte:head>

{#if data.broken}
	<div class="broken" role="alert">
		<p>{f.broken}</p>
		<a class="btn" href="/r/{data.slug}">{f.brokenBack}</a>
	</div>
{:else}
	{#key data.slug}<RecipeForm {data} />{/key}
{/if}

<style>
	.broken {
		max-width: 40rem;
		margin: 2rem auto;
		padding: 1rem;
		background: var(--card);
		border-left: 4px solid var(--rule-red);
	}
	.broken p {
		margin: 0 0 0.75rem;
	}
</style>
