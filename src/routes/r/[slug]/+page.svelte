<script lang="ts">
	import { enhance } from '$app/forms';
	import { t, familyLabel } from '$lib/i18n/fr';
	import RecipeView from '$lib/components/RecipeView.svelte';
	import Marked from '$lib/components/Marked.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// svelte-ignore state_referenced_locally -- a new recipe page remounts
	let servings = $state(data.recipe.servings ?? 0);
	let multiplier = $state(1);
	let copied = $state(false);

	const uncertain = $derived(data.recipe.markers.some((m) => m.kind !== 'added'));
	const kitchenHref = $derived(
		`/r/${data.recipe.slug}/cuisine${data.recipe.servings && servings !== data.recipe.servings ? `?portions=${servings}` : multiplier !== 1 ? `?fois=${multiplier}` : ''}`
	);

	async function copyFile() {
		await navigator.clipboard.writeText(data.file.text);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<svelte:head>
	<title>{data.recipe.title.replace(/\s*\[[^\]]*\]/g, '')} — {t.app.name}</title>
</svelte:head>

{#if data.broken}
	<div class="banner" role="alert">
		<p>{t.recipe.broken}</p>
		<ul>
			{#each data.broken as d, i (i)}
				<li><code>{d.code || '—'}</code>{#if d.path} <code>{d.path}</code>{/if} {d.message}</li>
			{/each}
		</ul>
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

<RecipeView recipe={data.recipe} body={data.body} titles={data.titles} photo={data.photo} bind:servings bind:multiplier />

{#if data.variants.length || data.usedBy.length}
	<nav class="related no-print">
		{#if data.variants.length}
			<section>
				<h2>{t.recipe.variants}{#if data.recipe.family}{' — '}<a href="/famille/{data.recipe.family}">{familyLabel(data.recipe.family)}</a>{/if}</h2>
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
		padding-left: 1.2rem;
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
	.file {
		margin-top: 2rem;
		border-top: 1px solid var(--line);
		padding-top: 1rem;
	}
	.file summary {
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
