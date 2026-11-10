<script lang="ts">
	// One time of the recipe (plan 04, Phase 5.5): one box she types the time
	// in as she would say it — « 1 h 30 », « 90 min », « 1h30 », « 20 à 25 min »
	// — read as she types and echoed under the box in grey, on a line whose
	// room is always kept (an echo appearing moves nothing). Same FormDuration
	// as ever: what is not a time stays as typed and blocks Save.
	import { untrack } from 'svelte';
	import { durationFromInput, durationInputText, readDurationInput, type FormDuration } from '$lib/form';
	import { form as f } from '$lib/i18n';
	import { afterPress } from './press';

	let { d, id, label, error, placeholder }: { d: FormDuration; id: string; label: string; error?: string; placeholder?: string } = $props();

	const W = f.timeWords;
	let text = $state(untrack(() => durationInputText(d, W)));
	let focused = $state(false);
	const read = $derived(readDurationInput(text));
	const echo = $derived(read && text.trim() ? durationInputText({ ...read }, W, true) : '');
	/** The echo only when it says more than the box: never « 20 min » beside « 20 min ». */
	const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase();
	const showEcho = $derived(!!echo && squash(echo) !== squash(text));

	const same = (a: number | null, b: number | null) => Object.is(a, b);
	// The form swapped under the box (a draft resumed, their version taken): the box follows.
	$effect(() => {
		const want = durationInputText(d, W);
		const mine = untrack(() => durationFromInput(text));
		const typed = (d.typed && Object.values(d.typed).find((v) => v !== undefined)) ?? undefined;
		const agree =
			same(mine.hours, d.hours) &&
			same(mine.minutes, d.minutes) &&
			same(mine.maxHours, d.maxHours) &&
			same(mine.maxMinutes, d.maxMinutes) &&
			(mine.typed?.hours ?? undefined) === typed;
		if (!agree) untrack(() => (text = want));
	});

	function set(value: string) {
		text = value;
		const v = durationFromInput(value);
		d.hours = v.hours;
		d.minutes = v.minutes;
		d.maxHours = v.maxHours;
		d.maxMinutes = v.maxMinutes;
		d.typed = v.typed;
	}
	// While she types « 20 à » the box is not a time yet: said once she leaves it.
	const shownError = $derived(focused && !read ? undefined : error);
</script>

<div class="dur">
	<label for={id}>{label}</label>
	<div class="line">
		<input
			{id}
			type="text"
			autocomplete="off"
			spellcheck="false"
			{placeholder}
			value={text}
			oninput={(e) => set(e.currentTarget.value)}
			onfocus={() => (focused = true)}
			onblur={() => afterPress(() => (focused = false))}
			aria-invalid={!!shownError || undefined}
			aria-describedby={shownError ? `${id}-err` : showEcho ? `${id}-echo` : undefined}
			data-testid={id}
		/>
	</div>
	<!-- The echo's line, kept even empty; an error (once she has left the box) takes its place. -->
	<p class="under">
		{#if shownError}<span class="err" id="{id}-err">{shownError}</span>{:else if showEcho}<span class="echo" id="{id}-echo">= {echo}</span>{/if}
	</p>
</div>

<style>
	.dur {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}
	label {
		font-size: var(--step--1);
		font-weight: 600;
		color: var(--ink-soft);
	}
	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.2rem 0.45rem;
	}
	/* The whole column: « 50 min à 1 h » reads whole. */
	input {
		flex: 1 1 auto;
		width: 100%;
		min-width: 0;
		min-height: 44px;
		font-variant-numeric: tabular-nums;
	}
	input::placeholder {
		font-weight: 400;
		color: var(--pencil);
		opacity: 1;
	}
	input[aria-invalid='true'] {
		border-color: var(--danger);
	}
	.under {
		min-height: 1.35em;
		margin: 0;
		font-size: var(--step--1);
		line-height: 1.35;
	}
	.echo {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--pencil);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.err {
		color: var(--danger);
	}
</style>
