<script lang="ts">
	import { enhance } from '$app/forms';
	import { t, familyLabel } from '$lib/i18n/fr';
	import { formatSeconds } from '$lib/render/duration';
	import Marked from '$lib/components/Marked.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const d = $derived(data.diff);
	const name = $derived(familyLabel(d.family, d.label));
	const stars = (n: number | null) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '—');
	const variantName = (v: { variant: string | null; title: string }) => v.variant?.replace(/-/g, ' ') ?? v.title;
</script>

<svelte:head><title>{name} — {t.families.title}</title></svelte:head>

<p class="up"><a href="/familles">{t.families.title}</a></p>
<h1>{name}</h1>
<p class="count">{t.families.variants(d.variants.length)}</p>

{#if form?.message}
	<p class="flash" class:error={!form.ok} role="status">{form.message}</p>
{/if}

<details class="rename" open={form?.ok === false}>
	<summary>{t.families.rename}</summary>
	<form method="POST" action="?/label" use:enhance={() => ({ update }) => update({ reset: false })}>
		<input type="hidden" name="hash" value={data.labelsHash} />
		<label for="family-label">{t.families.label}</label>
		<p class="help" id="family-label-help">{t.families.labelHelp(d.family)}</p>
		<div class="row">
			<input
				id="family-label"
				name="label"
				type="text"
				maxlength={data.labelMax}
				value={form?.ok === false ? (form.label ?? '') : (d.label ?? '')}
				placeholder={familyLabel(d.family)}
				aria-describedby="family-label-help"
			/>
			<button class="btn" type="submit">{t.families.labelSave}</button>
		</div>
	</form>
</details>

<ul class="variants">
	{#each d.variants as v (v.slug)}
		<li>
			<a href="/r/{v.slug}"><Marked text={v.title} /></a>
			{#if v.variant}<span class="tag">{variantName(v)}</span>{/if}
			<StatusBadge status={v.status === 'draft' ? null : v.status} />
			{#if d.unique[v.slug]?.length}
				<p class="only">{t.families.only} : {d.unique[v.slug].join(', ')}</p>
			{/if}
		</li>
	{/each}
</ul>

{#if d.variants.length > 1}
	<h2>{t.families.diff}</h2>
	<div class="scroll">
		<table>
			<thead>
				<tr>
					<th scope="col"></th>
					{#each d.variants as v (v.slug)}<th scope="col"><a href="/r/{v.slug}">{variantName(v)}</a></th>{/each}
				</tr>
			</thead>
			<tbody>
				{#if d.differs.total_s}
					<tr class="fact"><th scope="row">{t.families.totalTime}</th>{#each d.variants as v (v.slug)}<td>{v.total_s ? formatSeconds(v.total_s) : '—'}</td>{/each}</tr>
				{/if}
				{#if d.differs.servings}
					<tr class="fact"><th scope="row">{t.families.servings}</th>{#each d.variants as v (v.slug)}<td>{v.servings ?? '—'}{#if v.servings_max}–{v.servings_max}{/if}</td>{/each}</tr>
				{/if}
				{#if d.differs.difficulty}
					<tr class="fact"><th scope="row">{t.families.difficulty}</th>{#each d.variants as v (v.slug)}<td>{v.difficulty ?? '—'}</td>{/each}</tr>
				{/if}
				{#if d.differs.rating}
					<tr class="fact"><th scope="row">{t.families.rating}</th>{#each d.variants as v (v.slug)}<td class="stars">{stars(v.rating)}</td>{/each}</tr>
				{/if}
				{#each d.rows as row (row.item)}
					<tr>
						<th scope="row"><Marked text={row.label} /></th>
						{#each d.variants as v (v.slug)}
							<td class:yes={row.in.includes(v.slug)}>{#if row.in.includes(v.slug)}<span aria-label="oui">●</span>{:else}<span class="visually-hidden">non</span>{/if}</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if d.common.length}
		<details class="common">
			<summary>{t.families.common(d.common.length)}</summary>
			<p>{d.common.join(', ')}</p>
		</details>
	{/if}
{/if}

<style>
	.up {
		margin: 0;
		font-size: var(--step--1);
	}
	h1 {
		font-size: var(--step-4);
	}
	.count {
		color: var(--ink-soft);
		margin: 0.25rem 0 1.25rem;
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
	.rename {
		margin: 0 0 1.25rem;
		max-width: 40rem;
	}
	.rename summary {
		cursor: pointer;
		color: var(--link);
		font-weight: 600;
		font-size: var(--step--1);
	}
	.rename form {
		margin-top: 0.5rem;
	}
	.rename label {
		font-weight: 600;
	}
	.rename .help {
		margin: 0.15rem 0 0.4rem;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.rename .row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.rename input {
		flex: 1 1 14rem;
	}
	.variants {
		list-style: none;
		margin: 0 0 2rem;
		padding: 0;
		display: grid;
		gap: 0.6rem;
	}
	@media (min-width: 48rem) {
		.variants {
			grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
		}
	}
	.variants li {
		background: var(--card);
		border-top: 2px solid var(--rule-red);
		padding: 0.7rem 1rem;
	}
	.variants a {
		font-family: var(--serif);
		font-weight: 700;
		font-size: var(--step-1);
	}
	.tag {
		display: inline-block;
		margin-left: 0.4rem;
		color: var(--ink-soft);
		font-size: var(--step--1);
	}
	.only {
		margin: 0.3rem 0 0;
		font-size: var(--step--1);
		color: var(--ink);
	}
	h2 {
		font-size: var(--step-2);
		margin-bottom: 0.75rem;
	}
	.scroll {
		overflow-x: auto;
		background: var(--card);
		border-top: 3px solid var(--rule-red);
	}
	table {
		border-collapse: collapse;
		min-width: 100%;
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		padding: 0.45rem 0.8rem;
		border-bottom: 1px solid var(--rule-blue);
		text-align: center;
		white-space: nowrap;
	}
	th[scope='row'] {
		text-align: left;
		font-weight: 500;
		white-space: normal;
		min-width: 10rem;
	}
	thead th {
		font-family: var(--serif);
		vertical-align: bottom;
	}
	tr.fact th,
	tr.fact td {
		font-weight: 700;
		background: #f7f9fb;
	}
	td.yes {
		color: var(--rule-red);
	}
	.stars {
		color: var(--ink);
		letter-spacing: 0.05em;
	}
	.common {
		margin-top: 1rem;
		max-width: var(--measure);
	}
	.common summary {
		cursor: pointer;
		color: var(--link);
		font-weight: 600;
	}
</style>
