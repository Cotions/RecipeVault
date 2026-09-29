<script lang="ts">
	import { enhance } from '$app/forms';
	import { t, tagLabel } from '$lib/i18n/fr';
	import Marked from '$lib/components/Marked.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const s = t.pendingTags;
	const labelOf = (tag: string) => data.canonical.find((c) => c.tag === tag)?.label ?? tagLabel(tag);
	const keep = () => ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
</script>

<svelte:head><title>{s.title}</title></svelte:head>

<h1>{s.title}</h1>
<p class="intro">{s.intro}</p>

{#if form?.message}
	<p class="flash" class:error={!form.ok} role="status">{form.message}</p>
{/if}

{#if !data.pending.length}
	<p class="empty">{s.empty}</p>
{:else}
	<ul class="pending">
		{#each data.pending as p (p.tag)}
			{@const n = p.recipes.length}
			<li class="card" data-tag={p.tag}>
				<header>
					<h2><span class="chip">{p.forms[0]}</span></h2>
					<span class="count">{s.recipes(n)}</span>
				</header>
				{#if p.forms.length > 1}
					<p class="meta">{s.written} : {p.forms.map((f) => `« ${f} »`).join(', ')}</p>
				{/if}
				{#if p.suggestion}
					<p class="meta near">{s.suggestion(labelOf(p.suggestion))}</p>
				{/if}
				<ul class="recipes">
					{#each p.recipes as r (r.slug)}
						<li><a href="/r/{r.slug}"><Marked text={r.title} /></a>{#if r.broken} <span class="broken">({s.broken})</span>{/if}</li>
					{/each}
				</ul>

				<div class="actions">
					<details name="tag-{p.tag}">
						<summary>{s.map}</summary>
						<form method="POST" action="?/map" use:enhance={keep}>
							<input type="hidden" name="tag" value={p.tag} />
							<input type="hidden" name="version" value={data.version} />
							<p class="help">{s.mapHelp}</p>
							<label for="map-{p.tag}">{s.mapLabel}</label>
							<div class="row">
								<select id="map-{p.tag}" name="canonical" required>
									{#if !p.suggestion}<option value="" selected disabled>—</option>{/if}
									{#each data.canonical as c (c.tag)}
										<option value={c.tag} selected={c.tag === p.suggestion}>{c.label}</option>
									{/each}
								</select>
								<button class="btn primary" type="submit">{s.mapSave}</button>
							</div>
						</form>
					</details>

					<details name="tag-{p.tag}">
						<summary>{s.accept}</summary>
						{#if p.slug}
							<form method="POST" action="?/accept" use:enhance={keep}>
								<input type="hidden" name="tag" value={p.tag} />
								<input type="hidden" name="version" value={data.version} />
								<p class="help" id="accept-help-{p.tag}">{s.acceptHelp(p.slug)}</p>
								<label for="accept-{p.tag}">{s.label}</label>
								<div class="row">
									<input
										id="accept-{p.tag}"
										name="label"
										type="text"
										maxlength={data.labelMax}
										value={p.label}
										aria-describedby="accept-help-{p.tag}"
									/>
									<button class="btn primary" type="submit">{s.acceptSave}</button>
								</div>
							</form>
						{:else}
							<p class="help">{s.acceptNoSlug}</p>
						{/if}
					</details>

					<details name="tag-{p.tag}">
						<summary>{s.drop}</summary>
						<form method="POST" action="?/drop" use:enhance={keep}>
							<input type="hidden" name="tag" value={p.tag} />
							{#each p.recipes as r (r.slug)}<input type="hidden" name="recette" value="{r.slug} {r.hash}" />{/each}
							<p class="help">{s.dropHelp(n)}</p>
							<button class="btn danger" type="submit">{s.dropSave(n)}</button>
						</form>
					</details>
				</div>
			</li>
		{/each}
	</ul>
{/if}

<style>
	h1 {
		font-size: var(--step-4);
	}
	.intro {
		color: var(--ink-soft);
		max-width: var(--measure);
		margin: 0.4rem 0 1.25rem;
	}
	.empty {
		color: var(--ink-soft);
	}
	.flash {
		padding: 0.6rem 1rem;
		background: #e7f2ec;
		border-left: 4px solid var(--ok);
		margin: 0 0 1rem;
		max-width: 40rem;
	}
	.flash.error {
		background: #fbeceb;
		border-left-color: var(--rule-red);
	}
	.pending {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 1rem;
		max-width: 44rem;
	}
	.card {
		background: var(--card);
		border: 1px solid var(--line);
		border-top: 3px solid var(--rule-red);
		border-radius: var(--radius);
		padding: 0.9rem 1rem 1rem;
	}
	header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	h2 {
		font-size: var(--step-1);
	}
	.chip {
		display: inline-block;
		background: var(--highlight);
		color: var(--highlight-ink);
		padding: 0.05rem 0.55rem;
		border-radius: 999px;
		font-family: var(--sans);
		font-weight: 600;
	}
	.count,
	.meta {
		color: var(--ink-soft);
		font-size: var(--step--1);
	}
	.meta {
		margin: 0.35rem 0 0;
	}
	.near {
		color: var(--ink);
	}
	.recipes {
		margin: 0.6rem 0 0.8rem;
		padding-left: 1.2rem;
	}
	.recipes li {
		padding: 0.15rem 0;
	}
	.broken {
		color: var(--rule-red);
		font-size: var(--step--1);
	}
	.actions {
		display: grid;
		gap: 0.25rem;
		border-top: 1px solid var(--line);
		padding-top: 0.5rem;
	}
	summary {
		cursor: pointer;
		color: var(--link);
		font-weight: 600;
		/* a thumb-sized target on a phone */
		min-height: 44px;
		display: flex;
		align-items: center;
	}
	details[open] summary {
		color: var(--ink);
	}
	details form {
		padding: 0 0 0.75rem;
	}
	.help {
		margin: 0 0 0.5rem;
		font-size: var(--step--1);
		color: var(--ink-soft);
		max-width: var(--measure);
	}
	label {
		display: block;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	select,
	input[type='text'] {
		flex: 1 1 14rem;
		min-height: 44px;
		font: inherit;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--card);
		color: var(--ink);
	}
	.btn {
		min-height: 44px;
	}
</style>
