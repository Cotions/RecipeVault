<script lang="ts">
	// A quantity field (plan 04, Q7 A): typed as she would write it (2, 1 ½,
	// 0,5, 1/2) with the common fractions a tap away — a phone keyboard has none.
	import { form as f } from '$lib/i18n';
	import { FRACTIONS, withFraction } from './formui';

	let {
		value = $bindable(''),
		id,
		label,
		invalid = false,
		disabled = false,
		describedby,
		testid,
		placeholder = f.qtyPlaceholder,
		inlineOnPhone = false,
		input = $bindable()
	}: {
		value?: string;
		id: string;
		label: string;
		invalid?: boolean;
		disabled?: boolean;
		describedby?: string;
		testid?: string;
		/** An example quantity; none where it would read as a value (the "Jusqu'à" box, a disabled box: « au goût »). */
		placeholder?: string;
		input?: HTMLInputElement;
		/** The row draws the fractions in a line of its own (ItemRow), in the flow: none float here (usability round 5: they covered the row's error and the add button). */
		inlineOnPhone?: boolean;
	} = $props();

	let focused = $state(false);

	function chip(g: string) {
		value = withFraction(value, g);
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
		placeholder={disabled ? '' : placeholder}
		{disabled}
		aria-invalid={invalid || undefined}
		aria-describedby={describedby}
		data-testid={testid}
		bind:value
	/>
	{#if focused && !disabled && !inlineOnPhone}
		<div class="chips" role="group" aria-label={f.fractions}>
			{#each FRACTIONS as g (g)}
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
		border-color: var(--danger);
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
	/* A phone: above the box — under it is the name's line (ItemRow), the field she types next. */
	@media (max-width: 37.5rem) {
		.chips {
			top: auto;
			bottom: 100%;
			margin: 0 0 2px;
		}
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
