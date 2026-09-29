<script lang="ts">
	// The family picker (plan 04, Phase 5.1; Q10 A): existing families first,
	// with their number of recipes; "Nouvelle famille « … »" only once nothing
	// is within the W502 distance. Picking a family makes the variant required,
	// pre-filled from the title's words the family's name lacks.
	import Suggest, { type Option } from './Suggest.svelte';
	import { blockOn, familyChoices, variantFrom, type Block, type FamilyOption, type FormHint, type FormRecipe } from '$lib/form';
	import { familyLabel, form as f } from '$lib/i18n/fr';
	import { formHintText } from '$lib/i18n/diagnostics';
	import { blockText } from './formui';

	let {
		form,
		families,
		blocks,
		hints,
		newLabel = $bindable('')
	}: {
		form: FormRecipe;
		families: FamilyOption[];
		blocks: Block[];
		hints: FormHint[];
		/** A new family's name as she typed it: its label, written with the recipe (Q10 A). */
		newLabel?: string;
	} = $props();

	let query = $state('');
	let changing = $state(false);
	const current = $derived(families.find((x) => x.slug === form.family));
	const name = $derived(newLabel || familyLabel(form.family, current?.label));
	const w502 = $derived(hints.find((h) => h.code === 'W502' && h.suggestion && h.suggestion !== form.family));
	const variantBlock = $derived(blockOn(blocks, 'recipe', 'variant'));
	const familyBlock = $derived(blockOn(blocks, 'recipe', 'family'));

	function load(q: string): Option[] {
		const c = familyChoices(families, q);
		const list: Option[] = c.matches.map((m) => ({ value: m.slug, label: familyLabel(m.slug, m.label), meta: f.familyCount(m.count) }));
		if (c.offerNew) list.push({ value: `new:${c.offerNew.slug}`, label: f.familyNew(c.offerNew.label), meta: f.familyNewHelp, special: true });
		return list;
	}

	function choose(slug: string, label: string) {
		form.family = slug;
		changing = false;
		query = '';
		if (!form.variant.trim()) form.variant = variantFrom(form.title, label);
	}

	function pick(o: Option) {
		if (o.value.startsWith('new:')) {
			newLabel = query.trim();
			choose(o.value.slice(4), newLabel);
		} else {
			newLabel = '';
			const m = families.find((x) => x.slug === o.value);
			choose(o.value, familyLabel(o.value, m?.label));
		}
	}
</script>

<div class="family" data-testid="family">
	<h3>{f.family}</h3>
	{#if form.family && !changing}
		<p class="chosen">
			<span>{f.familyIs} <strong data-testid="family-name">{name}</strong>{#if current} <small>({f.familyCount(current.count)})</small>{/if}</span>
			<button type="button" class="btn quiet" onclick={() => ((changing = true), (query = ''))}>{f.familyChange}</button>
			<button
				type="button"
				class="btn quiet"
				onclick={() => {
					form.family = '';
					form.variant = '';
					newLabel = '';
				}}>{f.familyRemove}</button
			>
		</p>
		{#if newLabel}<p class="note">{f.familyNewNote}</p>{/if}
		{#if w502}
			<p class="hint">
				{formHintText.W502({ suggestion: familyLabel(w502.suggestion!, w502.label) })}
				<button
					type="button"
					class="btn"
					onclick={() => {
						newLabel = '';
						form.family = w502.suggestion!;
					}}>{f.useSuggestion(familyLabel(w502.suggestion!, w502.label))}</button
				>
			</p>
		{/if}
		<div class="field">
			<label for="variant">{f.variant} <span class="req">({f.required})</span></label>
			<input id="variant" type="text" bind:value={form.variant} placeholder={f.variantPlaceholder} aria-invalid={!!variantBlock || undefined} aria-describedby={variantBlock ? 'variant-err' : undefined} />
			{#if variantBlock}<p class="err" id="variant-err">{blockText(variantBlock)}</p>{/if}
		</div>
	{:else}
		<p class="help">{f.familyHelp}</p>
		<Suggest id="family-search" label={f.familySearch} bind:value={query} {load} onpick={pick} testid="family-search" />
		{#if changing}<button type="button" class="btn quiet" onclick={() => (changing = false)}>{f.familyKeep}</button>{/if}
		{#if familyBlock}<p class="err">{familyBlock.reason === 'required' ? f.blocks.family : blockText(familyBlock)}</p>{/if}
	{/if}
</div>

<style>
	h3 {
		font-size: var(--step-1);
		margin-bottom: 0.3rem;
	}
	.chosen {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.5rem;
		margin: 0 0 0.4rem;
	}
	.btn.quiet {
		min-height: 44px;
	}
	.help,
	.note {
		margin: 0 0 0.4rem;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		max-width: 28rem;
	}
	.field label {
		font-size: var(--step--1);
		font-weight: 600;
		color: var(--ink-soft);
	}
	.req {
		font-weight: 400;
	}
	input {
		min-height: 44px;
	}
	input[aria-invalid='true'] {
		border-color: var(--rule-red);
	}
	.err {
		margin: 0.2rem 0 0;
		font-size: var(--step--1);
		color: var(--rule-red);
	}
	.hint {
		margin: 0 0 0.5rem;
		padding: 0.35rem 0.6rem;
		border-left: 3px solid var(--link);
		background: #eef2f7;
		font-size: var(--step--1);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem 0.6rem;
	}
	.hint .btn {
		min-height: 44px;
	}
</style>
