<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { t, familyLabel } from '$lib/i18n/fr';
	import RecipeView from '$lib/components/RecipeView.svelte';
	import CostLine from '$lib/components/CostLine.svelte';
	import Marked from '$lib/components/Marked.svelte';
	import DiagnosticItem from '$lib/components/DiagnosticItem.svelte';
	import { parseRecipe } from '$lib/vault/parse';
	import { plainText } from '$lib/render/markers';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// SvelteKit keeps this component when going from one recipe to another, so
	// the scaling is derived from the recipe: it resets on every new recipe and
	// can still be changed by hand in between.
	// Keyed on the slug alone, so a form action reloading the same recipe keeps them.
	const slug = $derived(data.recipe.slug);
	let servings = $derived.by(() => {
		void slug;
		return untrack(() => data.recipe.servings ?? 0);
	});
	let multiplier = $derived.by(() => {
		void slug;
		return 1;
	});
	let copied = $state(false);
	/** The file on disk that fails, to name the places of its errors. */
	const brokenFile = $derived(data.broken ? parseRecipe(data.file.text) : undefined);
	/** The file as parsed, to name the ingredients that are not linked. */
	const unresolvedFile = $derived(data.unresolved.length ? parseRecipe(data.file.text) : undefined);

	const uncertain = $derived(data.recipe.markers.some((m) => m.kind !== 'added'));
	// Always say how much: an old kitchen session must not win over what this page shows.
	const kitchenHref = $derived(`/r/${data.recipe.slug}/cuisine${data.recipe.servings ? `?portions=${servings}` : `?fois=${multiplier}`}`);

	async function copyFile() {
		await navigator.clipboard.writeText(data.file.text);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<svelte:head>
	<title>{plainText(data.recipe.title)} — {t.app.name}</title>
</svelte:head>

{#if data.broken}
	<div class="banner" role="alert">
		<p>{t.recipe.broken}</p>
		<ul>
			{#each data.broken as d, i (i)}
				<DiagnosticItem {d} file={brokenFile} />
			{/each}
		</ul>
		<p class="hint">{t.diagnostics.vaultHint}</p>
	</div>
{/if}

{#if form?.message}
	<p class="flash no-print" class:error={!form.ok} role="status">{form.message}</p>
{/if}

<div class="actions no-print">
	<a class="btn primary" href={kitchenHref}>{t.recipe.cookMode}</a>
	<button class="btn" type="button" onclick={() => window.print()}>{t.recipe.print}</button>
	{#if data.recipe.status !== 'verified'}
		<form method="POST" action="?/verify" use:enhance>
			<input type="hidden" name="hash" value={data.file.hash} />
			<button class="btn" type="submit" disabled={uncertain} title={uncertain ? t.recipe.verifyBlocked : t.recipe.verifyHelp}>{t.recipe.verify}</button>
		</form>
	{/if}
	<form
		method="POST"
		action="?/remove"
		use:enhance={({ cancel }) => {
			if (!confirm(t.recipe.removeConfirm)) cancel();
		}}
	>
		<input type="hidden" name="hash" value={data.file.hash} />
		<button class="btn danger" type="submit">{t.recipe.remove}</button>
	</form>
</div>
{#if uncertain && data.recipe.status !== 'verified'}
	<p class="hint no-print">{t.recipe.verifyBlocked}</p>
{/if}

<RecipeView
	recipe={data.recipe}
	body={data.body}
	titles={data.titles}
	photo={data.photo}
	familyName={data.familyName}
	itemLinks={data.links}
	bind:servings
	bind:multiplier
>
	{#snippet cost(factor: number)}
		{#if data.cost}<CostLine cost={data.cost} {factor} money={data.money} />{/if}
	{/snippet}
</RecipeView>

{#if data.variants.length || data.usedBy.length}
	<nav class="related no-print">
		{#if data.variants.length}
			<section>
				<h2>{t.recipe.variants}{#if data.recipe.family}{' — '}<a href="/famille/{data.recipe.family}">{familyLabel(data.recipe.family, data.familyName)}</a>{/if}</h2>
				<ul>
					{#each data.variants as v (v.slug)}
						<li><a href="/r/{v.slug}"><Marked text={v.title} /></a></li>
					{/each}
				</ul>
			</section>
		{/if}
		{#if data.usedBy.length}
			<section>
				<h2>{t.recipe.usedBy}</h2>
				<ul>
					{#each data.usedBy as u (u.slug)}
						<li><a href="/r/{u.slug}"><Marked text={u.title} /></a></li>
					{/each}
				</ul>
			</section>
		{/if}
	</nav>
{/if}

{#if data.unresolved.length}
	<details class="unresolved no-print">
		<summary>{t.recipe.unresolved(data.unresolved.length)}</summary>
		<p class="hint">{t.recipe.unresolvedHelp}</p>
		<ul>
			{#each data.unresolved as d, i (i)}
				<DiagnosticItem {d} file={unresolvedFile} />
			{/each}
		</ul>
	</details>
{/if}

<details class="file no-print">
	<summary>{t.recipe.file}</summary>
	<p class="hint">{t.recipe.fileHelp}</p>
	<button class="btn" type="button" onclick={copyFile}>{copied ? t.recipe.copied : t.recipe.copy}</button>
	<pre><code>{data.file.text}</code></pre>
</details>

<style>
	.banner {
		background: #fbeceb;
		border-left: 4px solid var(--rule-red);
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
	}
	.banner p {
		margin: 0 0 0.25rem;
		font-weight: 600;
	}
	.banner ul {
		margin: 0;
		padding: 0;
	}
	.banner p.hint {
		font-weight: 400;
		font-size: var(--step--1);
		color: var(--ink-soft);
		margin: 0.4rem 0 0;
	}
	.flash {
		padding: 0.6rem 1rem;
		background: #e7f2ec;
		border-left: 4px solid var(--ok);
		margin: 0 0 1rem;
	}
	.flash.error {
		background: #fbeceb;
		border-left-color: var(--rule-red);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}
	.actions form {
		display: contents;
	}
	.hint {
		color: var(--ink-soft);
		font-size: var(--step--1);
		margin: 0 0 0.75rem;
	}
	.related {
		display: grid;
		gap: 1.5rem;
		margin-top: 2rem;
	}
	@media (min-width: 48rem) {
		.related {
			grid-template-columns: 1fr 1fr;
		}
	}
	.related h2 {
		font-size: var(--step-1);
		margin-bottom: 0.5rem;
	}
	.related ul {
		margin: 0;
		padding-left: 1.1rem;
	}
	.file,
	.unresolved {
		margin-top: 2rem;
		border-top: 1px solid var(--line);
		padding-top: 1rem;
	}
	.unresolved ul {
		list-style: none;
		padding: 0;
	}
	.file summary,
	.unresolved summary {
		cursor: pointer;
		color: var(--link);
		font-weight: 600;
	}
	.file pre {
		background: var(--card);
		border: 1px solid var(--line);
		padding: 1rem;
		overflow: auto;
		font-size: 0.85rem;
		max-height: 32rem;
		white-space: pre-wrap;
	}
</style>
