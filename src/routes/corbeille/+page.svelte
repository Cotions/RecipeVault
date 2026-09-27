<script lang="ts">
	import { enhance } from '$app/forms';
	import { t } from '$lib/i18n/fr';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const date = (iso: string) => new Date(iso).toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' });
</script>

<svelte:head><title>{t.trash.title}</title></svelte:head>

<h1>{t.trash.title}</h1>
<p class="intro">{t.trash.intro}</p>

{#if data.deleted}
	<p class="flash" role="status">{t.recipe.removed}</p>
{/if}
{#if form?.ok}
	<p class="flash" role="status">{t.trash.restored} <a href="/r/{form.slug}">/r/{form.slug}</a></p>
{:else if form?.message}
	<p class="flash error" role="alert">{form.message}</p>
{/if}

{#if data.entries.length}
	<ul class="list">
		{#each data.entries as e (e.slug)}
			<li>
				<div>
					<span class="title">{e.title}</span>
					<span class="when">{t.trash.deleted} {date(e.deleted)}</span>
				</div>
				{#if e.taken}
					<span class="when">{t.trash.taken}</span>
				{:else}
					<form method="POST" action="?/restore" use:enhance>
						<input type="hidden" name="slug" value={e.slug} />
						<button class="btn" type="submit">{t.trash.restore}</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{:else}
	<p class="intro">{t.trash.empty}</p>
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
		max-width: var(--measure);
	}
	.flash {
		padding: 0.6rem 1rem;
		background: #e7f2ec;
		border-left: 4px solid var(--ok);
		max-width: 40rem;
	}
	.flash.error {
		background: #fbeceb;
		border-left-color: var(--rule-red);
	}
	.list {
		list-style: none;
		padding: 0;
		margin: 0;
		max-width: 44rem;
		background: var(--card);
		border-top: 3px solid var(--rule-red);
	}
	.list li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
		padding: 0.6rem 1rem;
		border-bottom: 1px solid var(--rule-blue);
	}
	.title {
		display: block;
		font-family: var(--serif);
		font-weight: 700;
		font-size: var(--step-1);
	}
	.when {
		color: var(--ink-soft);
		font-size: var(--step--1);
	}
</style>
