<script lang="ts">
	// « Coller une liste » (plan 04, UI pass 2): a box where she pastes or types
	// many ingredients (or steps) at once, one per line. Under it, as she types,
	// what the app understood — quantity, unit, name, the rest — and a line it
	// could not read is said so (it goes whole into the name, to fix). Nothing
	// changes in the form until « Ajouter », which sits between the box and
	// that reading so the reading's growth never moves it.
	import { onMount } from 'svelte';
	import { parseIngredientList, parseStepList, showQuantity, type ListedGroup, type ListedStep } from '$lib/form';
	import { form as f } from '$lib/i18n';
	import { unitLabel } from '$lib/render/ingredient';
	import type { Ingredient, Lang } from '$lib/vault/types';

	let {
		id,
		kind,
		lang,
		onitems,
		onsteps,
		oncancel
	}: {
		id: string;
		kind: 'items' | 'steps';
		lang: Lang;
		onitems?: (list: ListedGroup[]) => void;
		onsteps?: (list: ListedStep[]) => void;
		oncancel: () => void;
	} = $props();

	let text = $state('');
	let box: HTMLTextAreaElement | undefined = $state();
	onMount(() => box?.focus());

	const groups = $derived(kind === 'items' ? parseIngredientList(text, lang) : []);
	const steps = $derived(kind === 'steps' ? parseStepList(text) : []);
	const count = $derived(kind === 'items' ? groups.reduce((n, g) => n + g.items.length, 0) : steps.filter((s) => s.type === 'step').length);
	const any = $derived(kind === 'items' ? groups.length > 0 : steps.length > 0);

	const amount = (it: Ingredient) =>
		it.qty ? showQuantity(it.qty.raw, lang) + (it.qtyMax ? ` ${f.range} ${showQuantity(it.qtyMax.raw, lang)}` : '') : '';
	const unit = (it: Ingredient) => (!it.unit ? '' : it.unit === 'piece' ? '' : unitLabel(it.unit, it.qtyMax?.value ?? it.qty?.value ?? 1, lang));
	const rest = (it: Ingredient) =>
		[
			it.alt?.qty ? f.sum.alt(`${showQuantity(it.alt.qty.raw, lang)}${it.alt.unit && it.alt.unit !== 'piece' ? ' ' + unitLabel(it.alt.unit, it.alt.qty.value, lang) : ''}`) : '',
			it.prep ?? '',
			it.note ?? '',
			it.toTaste ? f.sum.toTaste : ''
		]
			.filter(Boolean)
			.join(' · ');

	function add() {
		if (!count && !any) return;
		if (kind === 'items') onitems?.(groups);
		else onsteps?.(steps);
	}
</script>

<div class="paste" role="group" aria-labelledby="{id}-label" data-testid="list-paste">
	<label id="{id}-label" for="{id}-text">{kind === 'items' ? f.pasteItemsLabel : f.pasteStepsLabel}</label>
	<textarea
		id="{id}-text"
		bind:this={box}
		bind:value={text}
		rows="6"
		placeholder={kind === 'items' ? f.pasteItemsPlaceholder : f.pasteStepsPlaceholder}
		onkeydown={(e) => {
			if (e.key === 'Escape') oncancel();
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.preventDefault(), add());
		}}
		data-testid="list-paste-text"
	></textarea>
	<!-- « Ajouter » right under the box: what the app read grows below it as she types, so the button never moves away from the pointer. -->
	<div class="acts">
		<button type="button" class="btn primary" disabled={!any} onclick={add} data-testid="list-paste-add">
			{kind === 'items' ? f.pasteAddItems(count) : f.pasteAddSteps(count)}
		</button>
		<button type="button" class="btn quiet" onclick={oncancel}>{f.pasteCancel}</button>
	</div>
	{#if any}
		<div class="read" aria-live="polite">
			<p class="read-head">{f.pasteRead}</p>
			{#if kind === 'items'}
				{#each groups as g, gi (gi)}
					{#if g.name}<p class="group">{g.name}</p>{/if}
					<ul>
						{#each g.items as x, k (k)}
							<li class:unread={!x.read} data-testid="list-paste-item">
								{#if x.read}
									<span class="q">{amount(x.item)}</span>
									<span class="u">{unit(x.item)}</span>
									<span class="n">{x.item.name}</span>
									{#if rest(x.item)}<span class="r">{rest(x.item)}</span>{/if}
								{:else}
									<span class="q" aria-hidden="true">?</span>
									<span class="u"></span>
									<span class="n">{x.line}</span>
									<span class="r flag" title={f.pasteUnreadHelp}>{f.pasteUnread}</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/each}
			{:else}
				<ol>
					{#each steps as s, k (k)}
						<li class:heading={s.type === 'heading'} data-testid="list-paste-item">{s.text}</li>
					{/each}
				</ol>
			{/if}
		</div>
	{/if}
</div>

<style>
	.paste {
		margin: 0.5rem 0 0.25rem;
		padding: 0.75rem;
		border: 1px solid var(--edge);
		border-radius: var(--radius);
		background: var(--paper);
	}
	label {
		display: block;
		margin-bottom: 0.3rem;
		font-size: var(--step--1);
		font-weight: 600;
		color: var(--ink-soft);
	}
	textarea {
		width: 100%;
		min-height: 8rem;
		resize: vertical;
		line-height: 1.45;
	}
	.read {
		margin-top: 0.6rem;
	}
	.read-head {
		margin: 0 0 0.25rem;
		font-size: var(--step--1);
		font-weight: 600;
		color: var(--ink-soft);
	}
	.group {
		margin: 0.4rem 0 0.1rem;
		font-family: var(--serif);
		font-weight: 700;
	}
	ul,
	ol {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	ul li {
		display: grid;
		grid-template-columns: 3.5rem 6rem minmax(0, 1fr);
		column-gap: 0.4rem;
		padding: 0.2rem 0;
		border-bottom: 1px solid var(--rule-blue);
		font-size: var(--step--1);
	}
	.q {
		text-align: right;
		font-variant-numeric: tabular-nums;
		font-weight: 700;
	}
	.u {
		color: var(--ink-soft);
	}
	.n {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.r {
		grid-column: 3;
		color: var(--ink-soft);
	}
	.unread .q,
	.flag {
		color: var(--danger);
	}
	.flag {
		font-weight: 600;
	}
	ol {
		counter-reset: step;
	}
	ol li {
		position: relative;
		padding: 0.2rem 0 0.2rem 1.8rem;
		border-bottom: 1px solid var(--rule-blue);
		font-size: var(--step--1);
	}
	ol li:not(.heading) {
		counter-increment: step;
	}
	ol li:not(.heading)::before {
		content: counter(step) '.';
		position: absolute;
		left: 0;
		width: 1.4rem;
		text-align: right;
		font-weight: 700;
		color: var(--ink-soft);
	}
	ol li.heading {
		padding-left: 0;
		font-family: var(--serif);
		font-weight: 700;
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.6rem;
	}
	.acts .btn {
		min-height: 44px;
	}
	@media (max-width: 37.5rem) {
		ul li {
			grid-template-columns: 3rem 4.5rem minmax(0, 1fr);
		}
	}
</style>
