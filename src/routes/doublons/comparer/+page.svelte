<script lang="ts">
	// Two recipes of a possible duplicate side by side, read-only (plan 05,
	// Phase 7): the form's stale-compare table, every field where they differ.
	import { form as f, t } from '$lib/i18n/fr';
	import Marked from '$lib/components/Marked.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const s = t.duplicates;
	const name = (key: string, n?: number) => {
		const c = f.compare[key as keyof typeof f.compare];
		return typeof c === 'function' ? c(n ?? 1) : c;
	};
	const onlyTitle = $derived(data.rows.every((r) => r.key === 'title'));
</script>

<svelte:head><title>{s.compareTitle}</title></svelte:head>

<p><a class="back" href="/doublons">← {s.back}</a></p>
<h1>{s.compareTitle}</h1>
<p class="help">{onlyTitle ? s.compareSame : s.compareHelp}</p>

<div class="wrap">
	<table data-testid="compare">
		<thead>
			<tr>
				<th scope="col"></th>
				<th scope="col"><a href="/r/{data.a.slug}"><Marked text={data.a.title} /></a></th>
				<th scope="col"><a href="/r/{data.b.slug}"><Marked text={data.b.title} /></a></th>
			</tr>
		</thead>
		<tbody>
			{#each data.rows as r, i (i)}
				<tr>
					<th scope="row">{name(r.key, r.n)}</th>
					<td>{r.mine || '—'}</td>
					<td>{r.theirs || '—'}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	h1 {
		font-size: var(--step-3);
	}
	.back {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
	}
	.help {
		color: var(--ink-soft);
		margin: 0.3rem 0 0.75rem;
	}
	.wrap {
		overflow-x: auto;
		max-width: 60rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--step--1);
		background: var(--card);
	}
	th,
	td {
		text-align: left;
		vertical-align: top;
		padding: 0.4rem 0.5rem;
		border-bottom: 1px solid var(--rule-blue);
	}
	tbody th {
		font-weight: 600;
		color: var(--ink-soft);
		white-space: nowrap;
	}
</style>
