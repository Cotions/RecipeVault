<script lang="ts">
	// One time of the recipe (plan 04, Phase 5.5): hours and minutes, and an
	// optional "à" for a range. Numbers only; the file's format is the app's.
	import { untrack } from 'svelte';
	import type { FormDuration } from '$lib/form';
	import { form as f } from '$lib/i18n/fr-form';

	let { d, id, label, error }: { d: FormDuration; id: string; label: string; error?: string } = $props();

	let range = $state(untrack(() => d.maxHours !== null || d.maxMinutes !== null));
	const num = (s: string): number | null => (s.trim() === '' ? null : /^\d+$/.test(s.trim()) ? Number(s) : NaN);
</script>

<fieldset class="dur" aria-describedby={error ? `${id}-err` : undefined}>
	<legend>{label}</legend>
	<div class="line">
		{@render pair('hours', 'minutes', '')}
		{#if range}
			<span class="to">{f.range}</span>
			{@render pair('maxHours', 'maxMinutes', '-max')}
			<button
				type="button"
				class="btn quiet"
				aria-label={f.rangeRemove}
				onclick={() => {
					d.maxHours = null;
					d.maxMinutes = null;
					range = false;
				}}>✕</button
			>
		{:else}
			<button type="button" class="btn quiet" onclick={() => (range = true)}>{f.rangeAdd}</button>
		{/if}
	</div>
	{#if error}<p class="err" id="{id}-err">{error}</p>{/if}
</fieldset>

{#snippet pair(h: 'hours' | 'maxHours', m: 'minutes' | 'maxMinutes', suffix: string)}
	<span class="unit">
		<input
			id="{id}{suffix}-h"
			type="text"
			inputmode="numeric"
			autocomplete="off"
			size="2"
			value={d[h] ?? ''}
			oninput={(e) => (d[h] = num(e.currentTarget.value))}
			aria-label="{label} {suffix ? f.range + ' ' : ''}{f.hoursLabel}"
		/>
		<span aria-hidden="true">{f.hours}</span>
	</span>
	<span class="unit">
		<input
			id="{id}{suffix}-m"
			type="text"
			inputmode="numeric"
			autocomplete="off"
			size="2"
			value={d[m] ?? ''}
			oninput={(e) => (d[m] = num(e.currentTarget.value))}
			aria-label="{label} {suffix ? f.range + ' ' : ''}{f.minutesLabel}"
		/>
		<span aria-hidden="true">{f.minutes}</span>
	</span>
{/snippet}

<style>
	.dur {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}
	legend {
		font-size: var(--step--1);
		font-weight: 600;
		color: var(--ink-soft);
		padding: 0;
		margin-bottom: 0.2rem;
	}
	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
	}
	.unit {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
	}
	input {
		width: 3.4rem;
		min-height: 44px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.to {
		font-style: italic;
		color: var(--ink-soft);
	}
	.btn.quiet {
		min-height: 44px;
	}
	.err {
		margin: 0.2rem 0 0;
		font-size: var(--step--1);
		color: var(--rule-red);
	}
</style>
