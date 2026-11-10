<script lang="ts">
	// Pending tags, one row each (docs/VOCAB.md, "Tags"): the tag and its
	// recipes, then its three answers on one line — « Garder « Érable » » (✎
	// changes the name first), « C'est comme… » (an existing tag, the likely
	// one preselected) and « Retirer ». Each answer folds the row away and says
	// so in the toast, with « Annuler » (lib/settle.svelte.ts).
	import PageHead from '$lib/components/PageHead.svelte';
	import { enhance } from '$app/forms';
	import { t, tagLabel } from '$lib/i18n';
	import Marked from '$lib/components/Marked.svelte';
	import { Settling } from '$lib/settle.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const s = t.pendingTags;
	const labelOf = (tag: string) => data.canonical.find((c) => c.tag === tag)?.label ?? tagLabel(tag);
	const settling = new Settling();
	/** The name she typed under ✎, by tag: what « Garder » says and sends. */
	let names = $state<Record<string, string>>({});
	const nameOf = (tag: string, fallback: string) => (names[tag]?.trim() || fallback);
</script>

<svelte:head><title>{s.title} — {t.app.name}</title></svelte:head>

<PageHead title={s.title} count={data.pending.length ? s.count(data.pending.length) : null} intro={data.pending.length ? s.intro : undefined} />

<!-- Without JavaScript the decision comes back with the page; with it, in the toast. -->
{#if form?.message}
	<p class="flash" class:error={!form.ok} role="status">{form.message}</p>
{/if}

{#if !data.pending.length}
	<p class="empty">{s.empty}</p>
{:else}
	<ul class="pending" class:busy={settling.busy}>
		{#each data.pending as p (p.tag)}
			{@const n = p.recipes.length}
			<li class="row" class:gone={settling.gone.has(p.tag)} data-tag={p.tag}>
				<div class="what">
					<h2 class="chip">{p.forms[0]}</h2>
					<details class="recipes-of">
						<summary class="count">{s.recipes(n)}</summary>
						<ul aria-label={s.recipesOf}>
							{#each p.recipes as r (r.slug)}
								<li><a href="/r/{r.slug}"><Marked text={r.title} /></a>{#if r.broken} <span class="broken">({s.broken})</span>{/if}</li>
							{/each}
						</ul>
					</details>
					{#if p.forms.length > 1}<span class="meta">{s.written(p.forms)}</span>{/if}
					{#if p.suggestion}<span class="meta near">{s.suggestion(labelOf(p.suggestion))}</span>{/if}
				</div>

				<div class="acts">
					{#if p.slug}
						<!-- Keep it as a new tag, under the name shown on the button; ✎ changes that name first. -->
						<form class="keep" id="accept-{p.tag}" method="POST" action="?/accept" use:enhance={settling.form(p.tag)}>
							<input type="hidden" name="tag" value={p.tag} />
							<input type="hidden" name="version" value={data.version} />
							<button class="btn" class:primary={!p.suggestion} type="submit">{s.keep(nameOf(p.tag, p.label))}</button>
						</form>
						<details class="rename">
							<summary aria-label={s.rename} title={s.rename}><span aria-hidden="true">✎</span></summary>
							<div class="rename-field">
								<label for="label-{p.tag}">{s.label}</label>
								<input
									id="label-{p.tag}"
									form="accept-{p.tag}"
									name="label"
									type="text"
									maxlength={data.labelMax}
									value={p.label}
									oninput={(e) => (names[p.tag] = e.currentTarget.value)}
								/>
							</div>
						</details>
					{/if}

					<!-- The same as an existing tag: the likely one preselected, else « C'est comme… » to pick. -->
					<form class="map" method="POST" action="?/map" use:enhance={settling.form(p.tag)}>
						<input type="hidden" name="tag" value={p.tag} />
						<input type="hidden" name="form" value={p.forms[0]} />
						<input type="hidden" name="version" value={data.version} />
						<select name="canonical" required aria-label={s.mapLabel} title={s.mapHelp}>
							{#if !p.suggestion}<option value="" selected disabled>{s.map}</option>{/if}
							{#each data.canonical as c (c.tag)}
								<option value={c.tag} selected={c.tag === p.suggestion}>{c.label}</option>
							{/each}
						</select>
						<button class="btn" class:primary={!!p.suggestion} type="submit">{s.mapSave}</button>
					</form>

					<!-- The one answer that rewrites recipes: one tap, « Annuler » in the toast puts them back. -->
					<form class="drop" method="POST" action="?/drop" use:enhance={settling.form(p.tag)}>
						<input type="hidden" name="tag" value={p.tag} />
						<input type="hidden" name="form" value={p.forms[0]} />
						{#each p.recipes as r (r.slug)}<input type="hidden" name="recette" value="{r.slug} {r.hash}" />{/each}
						<button class="btn quiet" type="submit" title={s.dropHelp(n)} aria-label={s.dropSave(n)}>{s.drop}</button>
					</form>
				</div>
				{#if !p.slug}<p class="help">{s.acceptNoSlug}</p>{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.empty {
		color: var(--ink-soft);
	}
	.flash {
		padding: 0.6rem 1rem;
		background: var(--ok-bg);
		border-left: 4px solid var(--ok);
		margin: 0 0 1rem;
		max-width: 40rem;
	}
	.flash.error {
		background: var(--danger-bg);
		border-left-color: var(--danger);
	}
	/* A decision made: the row folds away at once, and no click lands on the one moving up. */
	.pending.busy {
		pointer-events: none;
	}
	.row.gone {
		display: none;
	}
	.pending {
		list-style: none;
		padding: 0;
		margin: 0;
		max-width: 60rem;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: var(--radius);
	}
	/* One row per tag: what it is on the left, its three answers on the right; they wrap on a phone. */
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		padding: 0.6rem 1rem;
		border-top: 1px solid var(--line);
	}
	.row:first-child {
		border-top: 0;
	}
	.what {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.75rem;
		min-width: 0;
		flex: 1 1 14rem;
	}
	.chip {
		display: inline-block;
		margin: 0;
		background: var(--highlight);
		color: var(--highlight-ink);
		padding: 0.1rem 0.6rem;
		border-radius: 999px;
		font-family: var(--sans);
		font-size: 1rem;
		font-weight: 600;
		line-height: 1.5;
	}
	.count,
	.meta {
		color: var(--ink-soft);
		font-size: 0.9375rem;
	}
	.near {
		color: var(--ink);
	}
	.recipes-of summary {
		cursor: pointer;
		text-decoration: underline dotted;
		text-underline-offset: 0.2em;
	}
	.recipes-of[open] {
		flex-basis: 100%;
		order: 9;
	}
	.recipes-of ul {
		margin: 0.25rem 0 0;
		padding-left: 1.2rem;
	}
	.recipes-of li {
		padding: 0.15rem 0;
	}
	.broken {
		color: var(--danger);
		font-size: 0.875rem;
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.acts form {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0;
	}
	.rename summary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		min-height: 44px;
		box-sizing: border-box;
		cursor: pointer;
		list-style: none;
		color: var(--link);
		border: 1px solid var(--field-edge);
		border-radius: var(--radius);
		background: var(--card);
		font-size: 1.05rem;
	}
	.rename summary::-webkit-details-marker {
		display: none;
	}
	.rename[open] {
		flex-basis: 100%;
		order: -1;
	}
	.rename[open] summary {
		color: var(--ink);
		background: var(--hover);
	}
	.rename-field {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.6rem;
		margin-top: 0.4rem;
	}
	.rename-field label {
		font-weight: 600;
		font-size: 0.9375rem;
	}
	select,
	input[type='text'] {
		min-height: 44px;
		box-sizing: border-box;
		font: inherit;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--field-edge);
		border-radius: var(--radius);
		background: var(--card);
		color: var(--ink);
	}
	select {
		max-width: 14rem;
	}
	input[type='text'] {
		flex: 1 1 12rem;
	}
	.btn {
		min-height: 44px;
	}
	/* « Retirer »: there, but quiet beside the two answers that keep the tag. */
	.btn.quiet {
		color: var(--ink-soft);
		background: transparent;
		border-color: transparent;
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	@media (hover: hover) {
		.btn.quiet:hover {
			color: var(--danger);
		}
	}
	.help {
		flex-basis: 100%;
		margin: 0;
		font-size: 0.9375rem;
		color: var(--ink-soft);
	}
	@media (max-width: 40rem) {
		.row {
			padding: 0.7rem 0.75rem;
		}
		.acts {
			width: 100%;
		}
		.map {
			flex: 1 1 auto;
		}
		select {
			flex: 1 1 auto;
			max-width: none;
			min-width: 0;
		}
	}
</style>
