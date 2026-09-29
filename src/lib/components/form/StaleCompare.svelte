<script lang="ts">
	// A stale save (plan 04, Q18 A): the recipe changed since the form opened.
	// Her version stays; the two are shown side by side, field by field, and
	// she keeps one — "Garder ma version" saves hers over the other.
	import { compareForms, type FormRecipe } from '$lib/form';
	import { form as f } from '$lib/i18n/fr-form';

	let { mine, theirs, onkeep, ontake }: { mine: FormRecipe; theirs: FormRecipe; onkeep: () => void; ontake: () => void } = $props();

	const rows = $derived(compareForms(mine, theirs));
	const name = (key: string, n?: number) => {
		const c = f.compare[key as keyof typeof f.compare];
		return typeof c === 'function' ? c(n ?? 1) : c;
	};
</script>

<section class="stale" role="alert" aria-labelledby="stale-title" data-testid="stale">
	<h2 id="stale-title">{f.stale}</h2>
	<p>{f.staleHelp}</p>
	{#if rows.length}
		<table>
			<thead>
				<tr><th scope="col"></th><th scope="col">{f.mine}</th><th scope="col">{f.theirs}</th></tr>
			</thead>
			<tbody>
				{#each rows as r, i (i)}
					<tr>
						<th scope="row">{name(r.key, r.n)}</th>
						<td class="mine">{r.mine || '—'}</td>
						<td>{r.theirs || '—'}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
	<div class="acts">
		<button type="button" class="btn primary" onclick={onkeep}>{f.keepMine}</button>
		<button type="button" class="btn" onclick={ontake}>{f.takeTheirs}</button>
	</div>
</section>

<style>
	.stale {
		margin: 0 0 1.25rem;
		padding: 1rem;
		background: var(--card);
		border: 2px solid var(--rule-red);
		border-radius: var(--radius);
	}
	h2 {
		font-size: var(--step-1);
	}
	p {
		margin: 0.3rem 0 0.75rem;
		color: var(--ink-soft);
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--step--1);
		margin-bottom: 0.75rem;
	}
	th,
	td {
		text-align: left;
		vertical-align: top;
		padding: 0.4rem 0.5rem;
		border-bottom: 1px solid var(--rule-blue);
	}
	thead th {
		font-weight: 700;
	}
	tbody th {
		font-weight: 600;
		color: var(--ink-soft);
		white-space: nowrap;
	}
	td.mine {
		background: #fffbe0;
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.acts .btn {
		min-height: 44px;
	}
</style>
