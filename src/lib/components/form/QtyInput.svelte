<script lang="ts">
	// A quantity field (plan 04, Q7 A): typed as she would write it (2, 1 ½,
	// 0,5, 1/2) with the common fractions a tap away — a phone keyboard has none.
	import { form as f } from '$lib/i18n/fr';

	let {
		value = $bindable(''),
		id,
		label,
		invalid = false,
		disabled = false,
		describedby,
		testid,
		input = $bindable()
	}: {
		value?: string;
		id: string;
		label: string;
		invalid?: boolean;
		disabled?: boolean;
		describedby?: string;
		testid?: string;
		input?: HTMLInputElement;
	} = $props();

	const CHIPS = ['¼', '⅓', '½', '⅔', '¾'];
	let focused = $state(false);

	function chip(g: string) {
		const v = value.trim().replace(/\s*[¼⅓½⅔¾]$/, '');
		value = /^\d+$/.test(v) ? `${v} ${g}` : g;
		input?.focus();
	}
</script>

<div class="qty" onfocusin={() => (focused = true)} onfocusout={() => (focused = false)}>
	<label class="visually-hidden" for={id}>{label}</label>
	<input
		bind:this={input}
		{id}
		type="text"
		inputmode="decimal"
		autocomplete="off"
		placeholder="1 ½"
		{disabled}
		aria-invalid={invalid || undefined}
		aria-describedby={describedby}
		data-testid={testid}
		bind:value
	/>
	{#if focused && !disabled}
		<div class="chips" role="group" aria-label={f.fractions}>
			{#each CHIPS as g (g)}
				<button type="button" tabindex="-1" onpointerdown={(e) => e.preventDefault()} onclick={() => chip(g)}>{g}</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.qty {
		position: relative;
		min-width: 0;
	}
	input {
		width: 100%;
		min-height: 44px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	input[aria-invalid='true'] {
		border-color: var(--rule-red);
	}
	.chips {
		position: absolute;
		top: 100%;
		left: 0;
		z-index: 15;
		display: flex;
		gap: 2px;
		margin-top: 2px;
		padding: 2px;
		background: var(--ink);
		border-radius: var(--radius);
	}
	.chips button {
		min-width: 44px;
		min-height: 44px;
		border: 0;
		border-radius: 2px;
		background: var(--card);
		font-family: var(--serif);
		font-size: var(--step-1);
		cursor: pointer;
	}
</style>
