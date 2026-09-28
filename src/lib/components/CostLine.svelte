<script lang="ts">
	// The cost line under the servings (plan 03, Phase 5; docs/INGREDIENTS.md,
	// "Partial pricing"). Totals come at the base servings; the total follows
	// the servings adjuster, the cost per serving does not change. Not printed.
	import { t } from '$lib/i18n/fr';
	import { ingredientHref, queueHref } from '$lib/render/links';
	import { formatMoney, type Money } from '$lib/render/money';
	import type { CostView } from '$lib/ingredients/cost';

	let {
		cost,
		factor,
		money
	}: {
		cost: CostView;
		factor: number;
		money: Money;
	} = $props();

	// Staples without a price are listed too: they do not count, but a price would still add to the total.
	const unpriced = $derived(cost.lines.filter((l) => (l.counted || l.staple) && l.cost === undefined));
	const priced = $derived(cost.lines.filter((l) => l.cost !== undefined));
	const fmt = (n: number) => formatMoney(n, money);
</script>

{#if unpriced.length || priced.length}
	<div class="cost no-print">
		<p class="line">
			<span class="label">{t.cost.label}</span>
			{#if cost.enough}
				<strong class="total">{t.cost.approx(fmt(cost.total * factor))}</strong>
				{#if cost.perServing !== null}<span class="sep">·</span> <span class="per">{t.cost.perServing(fmt(cost.perServing))}</span>{/if}
				{#if cost.counted}<span class="sep">·</span> <span class="coverage">{t.cost.coverage(cost.priced, cost.counted)}</span>{/if}
				{#if cost.stale}<span class="sep">·</span> <span class="stale">{t.cost.stale}</span>{/if}
			{:else}
				<span class="short">{t.cost.notEnough(cost.priced, cost.counted)}</span>
			{/if}
		</p>
		{#if unpriced.length || priced.length}
			<details class="detail" open={!cost.enough && unpriced.length > 0}>
				<summary>{unpriced.length ? t.cost.unpriced(unpriced.length) : t.cost.label}</summary>
				<p class="help">{t.cost.unpricedHelp}</p>
				<ul>
					{#each unpriced as l, i (i)}
						<li class="unpriced">
							{#if l.item}<a href={ingredientHref(l.item)}>{l.name}</a>{:else if l.key}<a href={queueHref(l.key)}>{l.name}</a>{:else}{l.name}{/if}
							<span class="why">{t.cost.reason[l.reason ?? ''] ?? l.reason}{#if l.via}, {t.cost.via(l.via)}{/if}</span>
						</li>
					{/each}
					{#each priced as l, i (i)}
						<li class="priced">
							{#if l.item}<a href={ingredientHref(l.item)}>{l.name}</a>{:else}{l.name}{/if}
							<span class="money">{fmt(l.cost! * factor)}</span>
							{#if l.via}<span class="why">{t.cost.via(l.via)}</span>{/if}
							{#if l.stale}<span class="why">{t.ingredients.stale}</span>{/if}
						</li>
					{/each}
				</ul>
			</details>
		{/if}
	</div>
{/if}

<style>
	.cost {
		margin: -0.25rem 0 1rem;
		font-size: var(--step--1);
	}
	.line {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.1rem 0.4rem;
		align-items: baseline;
	}
	.label {
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--ink-soft);
		font-size: 0.8em;
		font-weight: 600;
	}
	.total {
		font-variant-numeric: tabular-nums;
	}
	.sep,
	.coverage,
	.per,
	.short,
	.why {
		color: var(--ink-soft);
	}
	.stale {
		color: var(--rule-red);
	}
	.detail summary {
		cursor: pointer;
		color: var(--link);
	}
	.help {
		color: var(--ink-soft);
		margin: 0.3rem 0;
	}
	.detail ul {
		margin: 0;
		padding-left: 1.1rem;
	}
	.money {
		font-variant-numeric: tabular-nums;
		margin-left: 0.3rem;
	}
	.why {
		margin-left: 0.3rem;
	}
</style>
