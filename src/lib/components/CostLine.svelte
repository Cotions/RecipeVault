<script lang="ts">
	// The cost line at the foot of the method (plan 03, Phase 5; docs/INGREDIENTS.md,
	// "Partial pricing"). Totals come at the base servings; the total follows
	// the servings adjuster, the cost per serving does not change. Not printed.
	import { t } from '$lib/i18n';
	import { ingredientHref, queueHref } from '$lib/render/links';
	import { formatMoney, type Money } from '$lib/render/money';
	import type { CostView } from '$lib/ingredients/cost';

	let {
		cost,
		factor,
		money,
		keeper = false
	}: {
		cost: CostView;
		factor: number;
		money: Money;
		/** Whoever keeps the archive (the Markdown tools): the only one told there are not enough prices yet. */
		keeper?: boolean;
	} = $props();

	// Plain words: « Coût estimé : ≈ 20,26 $ · 5,07 $ par portion », and one
	// denominator, the ingredient lines (optional ones aside), as the
	// disclosure's summary: « 9 ingrédients sur 15 ont un prix »; behind it the
	// 6 others, each with why, then the priced ones. Whether the total is shown
	// still follows the counted lines (staples and « au goût » aside,
	// docs/INGREDIENTS.md); a line that does not count says so in the list.
	// Below the threshold the family sees nothing: missing prices are work for
	// the keeper, not news for the reader; the keeper reads one line,
	// « Coût : 7 prix manquants › », which opens on them (usability round 6).
	const unpriced = $derived(cost.lines.filter((l) => l.cost === undefined));
	const priced = $derived(cost.lines.filter((l) => l.cost !== undefined));
	const fmt = (n: number) => formatMoney(n, money);
	// The page lists a sub-recipe as one line (« 4 pâte brisée »); the cost
	// counts the lines inside it. Said after the count, so 15 adds up with the
	// 11 lines shown: « (dont 5 dans Pâte brisée) ».
	const fromSubs = $derived.by(() => {
		const n = new Map<string, number>();
		for (const l of cost.lines) if (l.via) n.set(l.via, (n.get(l.via) ?? 0) + 1);
		return [...n].map(([title, count]) => ({ title, n: count }));
	});
</script>

{#if cost.lines.length && cost.enough}
	<div class="cost no-print">
		<p class="line">
			<span class="label">{t.cost.label}</span>
			<strong class="total">{t.cost.approx(fmt(cost.total * factor))}</strong>
			{#if cost.perServing !== null}<span class="sep" aria-hidden="true">·</span> <span class="per">{t.cost.perServing(fmt(cost.perServing))}</span>{/if}
			{#if cost.stale}<span class="sep" aria-hidden="true">·</span> <span class="stale">{t.cost.stale}</span>{/if}
		</p>
		<details class="detail">
			<summary><span class="coverage">{t.cost.coverage(priced.length, cost.lines.length)}</span>{#if fromSubs.length}{' '}<span class="from">{t.cost.coverageFrom(fromSubs)}</span>{/if}</summary>
			<p class="help">{t.cost.unpricedHelp}</p>
			{#if unpriced.length}
				<h3>{t.cost.unpriced(unpriced.length)}</h3>
				{@render unpricedList()}
			{/if}
			{#if priced.length}
				<h3>{t.cost.priced(priced.length)}</h3>
				<ul>
					{#each priced as l, i (i)}
						<li class="priced">
							{#if l.item}<a href={ingredientHref(l.item)}>{l.name}</a>{:else}{l.name}{/if}
							<span class="money">{fmt(l.cost! * factor)}</span>
							{#if l.via}<span class="why">{t.cost.via(l.via)}</span>{/if}
							{#if l.stale}<span class="why">{t.ingredients.stale}</span>{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</details>
	</div>
{:else if cost.lines.length && keeper && unpriced.length}
	<!-- Not enough prices, for the keeper only (usability round 6): one quiet line, « Coût : 7 prix manquants › »,
	     that opens on the missing ones, each a link to where its price is entered. -->
	<details class="cost missing no-print">
		<summary class="line"><span class="label">{t.cost.short}</span> <span class="go">{t.cost.missing(unpriced.length)}</span></summary>
		{@render unpricedList()}
	</details>
{/if}

{#snippet unpricedList()}
	<ul>
		{#each unpriced as l, i (i)}
			<li class="unpriced">
				{#if l.item}<a href={ingredientHref(l.item)}>{l.name}</a>{:else if l.key && keeper}<a href={queueHref(l.key)}>{l.name}</a>{:else}{l.name}{/if}
				<!-- « pas encore relié » is the keeper's to-do; the family reads only that it has no price. -->
				<span class="why"
					>{t.cost.reason[l.reason === 'unresolved' && !keeper ? 'no-price' : (l.reason ?? '')] ?? l.reason}{#if l.via}, {t.cost.via(l.via)}{/if}{#if !l.counted}, {l.staple ? t.cost.staple : t.cost.toTaste}{/if}</span
				>
			</li>
		{/each}
	</ul>
{/snippet}

<style>
	/* Quiet: a footnote of the method, in the ingredients' sans at the
	   smallest read size (15 px) and one weight; the figure in full ink, the
	   rest in the soft ink. */
	.cost {
		margin-top: 1.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--line);
		font-family: var(--sans);
		font-size: var(--step--1);
		font-weight: 400;
		line-height: 1.45;
		color: var(--ink-soft);
	}
	.line {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.1rem 0.4rem;
		align-items: baseline;
	}
	.label {
		color: var(--ink-soft);
	}
	.total {
		font-weight: 400;
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}
	.sep,
	.per,
	.why {
		color: var(--ink-soft);
	}
	.stale {
		color: var(--highlight-ink);
	}
	.detail summary,
	.missing summary {
		width: fit-content;
		padding-block: 0.4rem;
		cursor: pointer;
		color: var(--link);
	}
	/* « Coût : 7 prix manquants › »: the line itself is the way in, the count in the link's ink. */
	.missing summary {
		display: flex;
		gap: 0.3rem;
		list-style: none;
		color: var(--ink-soft);
	}
	.missing summary::-webkit-details-marker {
		display: none;
	}
	.missing .go {
		color: var(--link);
		text-decoration: underline;
		text-decoration-color: var(--link-line);
		text-underline-offset: 0.18em;
	}
	.missing summary:hover .go {
		color: var(--link-hover);
	}
	.missing ul {
		margin-top: 0.2rem;
	}
	@media (pointer: coarse) {
		.missing summary,
		.detail summary {
			padding-block: 0.7rem;
		}
	}
	.help {
		color: var(--ink-soft);
		margin: 0.3rem 0;
	}
	.detail h3 {
		margin: 0.6rem 0 0.2rem;
		font-family: var(--sans);
		font-size: var(--step--1);
		font-weight: 400;
		color: var(--ink);
	}
	.from {
		color: var(--ink-soft);
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
