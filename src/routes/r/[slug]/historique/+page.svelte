<script lang="ts">
	import { enhance } from '$app/forms';
	import { t } from '$lib/i18n/fr';
	import Marked from '$lib/components/Marked.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const h = t.history;
</script>

<svelte:head>
	<title>{h.title} — {data.title} — {t.app.name}</title>
</svelte:head>

<p class="back"><a href="/r/{data.slug}">← {h.back}</a></p>
<h1><span class="kicker">{h.title}</span> <Marked text={data.title} /></h1>
<p class="intro">{h.intro}</p>

{#if form?.message}
	<div class="flash" class:error={!form.ok} role={form.ok ? 'status' : 'alert'}>
		<p>{form.message}</p>
		{#if form.ok && form.commit}
			<form method="POST" action="?/annuler" use:enhance>
				<input type="hidden" name="commit" value={form.commit} />
				<button class="btn" type="submit">{form.action === 'revenir' ? h.undoRestore : form.result === 'undone' ? h.redo : h.undo}</button>
			</form>
		{/if}
	</div>
{/if}

{#if data.where === 'trash'}
	<p class="flash error" role="note">{h.inTrash} <a href="/corbeille">{t.trash.title}</a></p>
{/if}

{#if data.versions.length}
	<ol class="versions">
		{#each data.versions as v (v.commit)}
			<li class:current={v.current}>
				<div class="head">
					<span class="when">{v.when}</span>
					<span class="who">{h.by} {v.author}</span>
					{#if v.current}<span class="badge">{h.current}</span>{/if}
				</div>
				{#if v.summary.length}
					<ul class="summary">
						{#each v.summary as line, i (i)}
							<li>{line}</li>
						{/each}
					</ul>
				{/if}
				{#if v.restorable}
					<details class="restore">
						<summary class="btn">{h.restore}</summary>
						<div class="confirm">
							{#if v.toCurrent.length}
								<p>{h.restoreWill}</p>
								<ul class="summary">
									{#each v.toCurrent as line, i (i)}
										<li>{line}</li>
									{/each}
								</ul>
							{:else}
								<p>{h.restoreNothing}</p>
							{/if}
							<form method="POST" action="?/revenir" use:enhance>
								<input type="hidden" name="commit" value={v.commit} />
								<input type="hidden" name="hash" value={data.hash} />
								<button class="btn primary" type="submit">{h.restoreConfirm}</button>
							</form>
						</div>
					</details>
				{:else if v.blocked === 'invalid'}
					<p class="note">{h.invalidVersion}</p>
				{:else if v.blocked === 'other-slug'}
					<p class="note">{h.otherSlug}</p>
				{/if}
			</li>
		{/each}
	</ol>
{:else}
	<p class="intro">{h.empty}</p>
{/if}

<style>
	.back {
		margin: 0 0 0.5rem;
	}
	.back a {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
	}
	h1 {
		font-size: var(--step-3);
		margin: 0;
	}
	.kicker {
		display: block;
		font-size: var(--step--1);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--ink-soft);
		font-family: inherit;
	}
	.intro {
		color: var(--ink-soft);
		font-family: var(--serif);
		font-size: var(--step-1);
		margin: 0.5rem 0 1.25rem;
		max-width: var(--measure);
	}
	.flash {
		padding: 0.6rem 1rem;
		background: #e7f2ec;
		border-left: 4px solid var(--ok);
		max-width: 44rem;
		margin: 0 0 1rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
	}
	.flash p {
		margin: 0;
		flex: 1 1 14rem;
	}
	.flash.error {
		background: #fbeceb;
		border-left-color: var(--rule-red);
	}
	.versions {
		list-style: none;
		padding: 0;
		margin: 0;
		max-width: 44rem;
		background: var(--card);
		border-top: 3px solid var(--rule-red);
	}
	.versions > li {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--rule-blue);
	}
	.versions > li.current {
		background: #f6f8fb;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.75rem;
	}
	.when {
		font-family: var(--serif);
		font-weight: 700;
		font-size: var(--step-1);
	}
	.who {
		color: var(--ink-soft);
	}
	.badge {
		font-size: var(--step--1);
		border: 1px solid var(--ok);
		color: var(--ok);
		border-radius: 999px;
		padding: 0 0.6rem;
	}
	.summary {
		margin: 0.35rem 0 0;
		padding-left: 1.1rem;
	}
	.summary li {
		margin: 0.15rem 0;
	}
	.restore {
		margin-top: 0.6rem;
	}
	.restore > summary {
		list-style: none;
		cursor: pointer;
		min-height: 2.75rem;
	}
	.restore > summary::-webkit-details-marker {
		display: none;
	}
	.confirm {
		margin-top: 0.5rem;
		padding: 0.6rem 0.8rem;
		border-left: 3px solid var(--rule-blue);
	}
	.confirm p {
		margin: 0 0 0.25rem;
	}
	.confirm form {
		margin-top: 0.6rem;
	}
	.confirm .btn,
	.flash .btn {
		min-height: 2.75rem;
	}
	.note {
		color: var(--ink-soft);
		font-size: var(--step--1);
		margin: 0.5rem 0 0;
	}
</style>
