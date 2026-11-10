<script lang="ts">
	// The family picker (plan 04, Phase 5.1; Q10 A): existing families first,
	// with their number of recipes; "Nouvelle famille « … »" only once nothing
	// is within the W502 distance (said to be new only when nothing is listed).
	// Picking a family makes the variant required, pre-filled with who the
	// recipe is from when no other recipe of the group is (else empty, examples
	// in the placeholder); « Elle rejoindra : … » lists the group's recipes
	// before the save. While she types, the line under the field
	// says which group it will be — the list's first — and Enter or leaving the
	// field picks it: a name typed is never silently left unpicked.
	import Suggest, { type Option } from './Suggest.svelte';
	import { untrack } from 'svelte';
	import { blockOn, familyChoices, variantPrefill, variantShown, type Block, type FamilyOption, type FormHint, type FormRecipe } from '$lib/form';
	import { familyLabel, form as f } from '$lib/i18n';
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
	/** A family's name as shown: its label, else as its recipes write it, else from its slug. */
	const shown = (o: FamilyOption | undefined, slug: string) => familyLabel(slug, o?.label ?? o?.name);
	const name = $derived(newLabel || shown(current, form.family));
	const w502 = $derived(hints.find((h) => h.code === 'W502' && h.suggestion && h.suggestion !== form.family));
	const variantBlock = $derived(blockOn(blocks, 'recipe', 'variant'));
	const familyBlock = $derived(blockOn(blocks, 'recipe', 'family'));

	function load(q: string): Option[] {
		const c = familyChoices(families, q);
		const list: Option[] = c.matches.map((m) => ({ value: m.slug, label: shown(m, m.slug), meta: f.familyCount(m.count) }));
		// « Aucun groupe existant n'a un nom proche » only when that is so: not under a group listed above.
		if (c.offerNew) list.push({ value: `new:${c.offerNew.slug}`, label: f.familyNew(c.offerNew.label), meta: c.matches.length ? undefined : f.familyNewHelp, special: true });
		return list;
	}
	/** What Enter, or leaving the field, picks: the list's first. */
	const top = $derived(query.trim() ? load(query)[0] : undefined);
	const topName = $derived(top ? (top.value.startsWith('new:') ? f.familyWillBeNew(query.trim()) : f.familyWillBe(top.label)) : '');
	/** A press on « Garder ce groupe »: leaving the field for it picks nothing. */
	let keeping = false;
	function pickTop() {
		if (keeping || !top) return;
		pick(top);
	}

	/** What the variant was pre-filled with: taken back if a recipe of the group turns out to be from the same person. */
	let prefilled = '';
	function choose(slug: string) {
		form.family = slug;
		changing = false;
		query = '';
		if (!form.variant.trim()) form.variant = prefilled = variantPrefill(form.source.author);
	}

	// The group's recipes (/famille/<slug>/membres), for « Elle rejoindra : … »: read when the group changes.
	type Member = { slug: string; title: string; variant: string | null; author: string | null };
	const initial = untrack(() => form.family);
	let members = $state<{ family: string; list: Member[] } | null>(null);
	$effect(() => {
		const fam = form.family;
		if (!fam || newLabel) return;
		if (members?.family === fam) return;
		const ctl = new AbortController();
		fetch(`/famille/${encodeURIComponent(fam)}/membres`, { signal: ctl.signal })
			.then((r) => (r.ok ? r.json() : null))
			.then((d: { members: Member[] } | null) => {
				if (!d) return;
				members = { family: fam, list: d.members };
				if (prefilled && form.variant === prefilled && !variantPrefill(prefilled, d.members.map((m) => m.author))) form.variant = prefilled = '';
			})
			.catch(() => {});
		return () => ctl.abort();
	});
	/** The others of the group (not this recipe itself, when it is one of them already). */
	const others = $derived(members && members.family === form.family && !newLabel ? members.list.filter((m) => m.slug !== form.slug) : []);

	function pick(o: Option) {
		if (o.value.startsWith('new:')) {
			newLabel = query.trim();
			choose(o.value.slice(4));
		} else {
			newLabel = '';
			choose(o.value);
		}
	}
</script>

<div class="family" data-testid="family">
	<!-- Chosen, the line says « Variante de : … » itself. -->
	<h3 class:visually-hidden={!!form.family && !changing}>{f.family}</h3>
	{#if form.family && !changing}
		<p class="chosen">
			<span>{f.familyIs} <strong data-testid="family-name">{name}</strong>{#if current}{' '}<small>({f.familyCount(current.count)})</small>{/if}</span>
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
		{#if others.length}
			<!-- Before the save: the group she is joining, and who is in it already. -->
			<div class="joins" data-testid="family-joins">
				<p>{form.family === initial ? f.familyWith : f.familyJoins(name, others.length)}</p>
				<ul>
					{#each others as m (m.slug)}
						<li><a href="/r/{m.slug}" target="_blank" rel="noopener">{m.title}</a>{#if m.variant}<span>{` — ${variantShown(m.variant, m.author)}`}</span>{/if}</li>
					{/each}
				</ul>
			</div>
		{/if}
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
		<Suggest
			id="family-search"
			label={f.familySearch}
			bind:value={query}
			{load}
			onpick={pick}
			onenter={pickTop}
			onblur={pickTop}
			describedby={top ? 'family-will-be' : undefined}
			testid="family-search"
		/>
		{#if top}<p class="will" id="family-will-be" data-testid="family-will-be"><strong>{topName}</strong> <span>{f.familyEnter}</span></p>{/if}
		{#if changing}<button
				type="button"
				class="btn quiet"
				onpointerdown={() => (keeping = true)}
				onclick={() => ((keeping = false), (changing = false), (query = ''))}>{f.familyKeep}</button
			>{/if}
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
	.will {
		margin: 0.3rem 0 0.4rem;
		font-size: var(--step--1);
	}
	.will span {
		color: var(--ink-soft);
	}
	.joins {
		margin: 0 0 0.5rem;
		font-size: var(--step--1);
	}
	.joins p {
		margin: 0 0 0.15rem;
		font-weight: 600;
	}
	.joins ul {
		margin: 0;
		padding-left: 1.1rem;
	}
	.joins li span {
		color: var(--ink-soft);
	}
	/* A finger: each recipe of the group a 44 px line to touch (round 3). */
	@media (pointer: coarse), (max-width: 37.5rem) {
		.joins li a {
			display: inline-flex;
			align-items: center;
			min-height: 44px;
		}
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
		border-color: var(--danger);
	}
	.err {
		margin: 0.2rem 0 0;
		font-size: var(--step--1);
		color: var(--danger);
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
