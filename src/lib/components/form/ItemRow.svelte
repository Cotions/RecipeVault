<script lang="ts">
	// One ingredient row (plan 04, Q6 A): quantity, unit, name on the line;
	// the rest behind "Détails" — préparation, note, marque, au goût,
	// facultatif, jusqu'à, ou en mesure, ou remplacer par, and "C'est une autre
	// recette" (Phase 5.6). An `or` entry is drawn by this same component, nested.
	import { untrack } from 'svelte';
	import ItemRow from './ItemRow.svelte';
	import Marks from './Marks.svelte';
	import QtyInput from './QtyInput.svelte';
	import Suggest, { type Option } from './Suggest.svelte';
	import { applyNameHint, blockOn, nameHint, newItem, setToTaste, type Block, type FormHint, type FormItem } from '$lib/form';
	import { form as f } from '$lib/i18n/fr';
	import { formHintText } from '$lib/i18n/diagnostics';
	import { blockText } from './formui';
	import { unitLabel } from '$lib/render/ingredient';
	import type { CheckWords } from '$lib/vault/words';
	import type { Lang, Unit } from '$lib/vault/types';

	let {
		item,
		lang,
		units,
		words,
		own,
		blocks,
		hints,
		label,
		nested = false,
		first = false,
		last = false,
		onmove,
		onremove,
		onenter,
		qtyInput = $bindable()
	}: {
		item: FormItem;
		lang: Lang;
		units: Unit[];
		words?: CheckWords;
		/** This recipe's slug, left out of the sub-recipe picker with every recipe that uses it (E213). */
		own: string;
		blocks: Block[];
		hints: FormHint[];
		/** "Ingrédient 3", for the hidden labels. */
		label: string;
		nested?: boolean;
		first?: boolean;
		last?: boolean;
		onmove?: (by: -1 | 1) => void;
		onremove: () => void;
		onenter?: () => void;
		qtyInput?: HTMLInputElement;
	} = $props();

	const id = $derived(`it-${item.id}`);
	const hasDetails = (it: FormItem) =>
		!!(it.prep || it.note || it.brand || it.toTaste || it.optional || it.qtyMax || it.alt || it.or.length || it.recipe);
	let open = $state(untrack(() => hasDetails(item)));
	let linked = $state<boolean | null>(null);
	let subTitle = $state('');
	let picking = $state(false);

	const hint = $derived(nameHint(item.name, words));
	const b = (field: string) => blockOn(blocks, item.id, field);
	const unitName = (u: Unit) => (u === 'piece' ? f.piece : unitLabel(u, 1, 'fr'));
	/**
	 * The name as it stood when she last left the field (or picked a suggestion).
	 * "Pas encore relié" (W303 / W305) waits for it: not under every half-typed
	 * name while she types (issue #11). Still only a soft line, never a block.
	 */
	let settledName = $state(untrack(() => item.name));
	const settled = $derived(item.name.trim() === settledName.trim());
	const myHints = $derived(
		hints.filter((h) => h.target === item.id && (h.code === 'W306' || ((h.code === 'W303' || h.code === 'W305') && settled)))
	);
	/** Blocks on this row with no field of their own on screen: said at the row's end. */
	const SHOWN = ['qty', 'unit', 'name', 'prep', 'note', 'brand', 'qtyMax', 'alt', 'alt.qtyMax'];
	const others = $derived(blocks.filter((x) => x.id === item.id && !SHOWN.includes(x.field) && (nested || x.field !== 'recipe')));
	const detailsFlagged = $derived(['prep', 'note', 'brand', 'qtyMax', 'alt', 'alt.qtyMax', 'recipe'].some((k) => b(k)) || !!others.length);
	$effect(() => {
		if (detailsFlagged) open = true;
	});

	async function names(q: string): Promise<Option[]> {
		if (!q.trim()) return [];
		const res = await fetch(`/api/suggest?kind=name&lang=${lang}&q=${encodeURIComponent(q)}`);
		if (!res.ok) return [];
		const data = (await res.json()) as { items: { name: string; linked: boolean }[]; linked: boolean };
		linked = data.linked;
		return data.items.filter((i) => i.name !== q).map((i) => ({ value: i.name, label: i.name, meta: i.linked ? f.linked : undefined }));
	}

	async function recipes(q: string): Promise<Option[]> {
		const res = await fetch(`/api/suggest?kind=recipe&q=${encodeURIComponent(q)}${own ? `&own=${own}` : ''}`);
		if (!res.ok) return [];
		const data = (await res.json()) as { items: { slug: string; title: string }[] };
		return data.items.map((r) => ({ value: r.slug, label: r.title }));
	}

	const err = (field: string): string | undefined => blockText(b(field));
</script>

<div class="row" class:nested data-testid="item-row">
	<div class="line">
		<QtyInput
			id="{id}-qty"
			label="{label} — {f.qty}"
			bind:value={item.qty}
			bind:input={qtyInput}
			disabled={item.toTaste}
			invalid={!!b('qty')}
			describedby={b('qty') ? `${id}-err` : undefined}
			testid="qty"
		/>
		<label class="visually-hidden" for="{id}-unit">{label} — {f.unit}</label>
		<select id="{id}-unit" bind:value={item.unit} disabled={item.toTaste} aria-invalid={!!b('unit') || undefined} data-testid="unit">
			<option value="">{f.noUnit}</option>
			{#each units as u (u)}<option value={u}>{unitName(u)}</option>{/each}
		</select>
		<Suggest
			id="{id}-name"
			bind:value={item.name}
			load={names}
			onpick={(o) => {
				item.name = o.value;
				settledName = o.value;
				linked = o.meta === f.linked;
			}}
			oninput={() => (linked = null)}
			onblur={() => (settledName = item.name)}
			{onenter}
			placeholder={f.namePlaceholder}
			invalid={!!b('name')}
			testid="name"
		/>
		<div class="tools">
			{#if !nested}
				<button type="button" class="icon" aria-label="{f.moveUp} — {label}" disabled={first} onclick={() => onmove?.(-1)}>↑</button>
				<button type="button" class="icon" aria-label="{f.moveDown} — {label}" disabled={last} onclick={() => onmove?.(1)}>↓</button>
			{/if}
			<button type="button" class="icon" aria-label="{f.remove} — {label}" onclick={onremove}>✕</button>
		</div>
	</div>
	<label class="visually-hidden" for="{id}-name">{label} — {f.name}</label>
	{#if linked && item.name.trim()}<span class="linked" title={f.linkedTitle}>✓ {f.linked}</span>{/if}
	{#if b('qty') || b('unit') || b('name')}
		<p class="err" id="{id}-err">{err('qty') ?? err('unit') ?? err('name')}</p>
	{/if}
	{#if hint}
		<p class="hint" data-testid="name-hint">
			{formHintText[hint.code]({ word: hint.word })}
			<button type="button" class="btn" onclick={() => {
					applyNameHint(item, hint);
					settledName = item.name;
				}}>{f.useSuggestion(hint.word)}</button>
		</p>
	{/if}
	{#each myHints as h (h.code)}
		<p class="soft" data-testid="row-hint">{formHintText[h.code]({})}</p>
	{/each}
	<Marks owner={item} key="qty" {lang} text={item.qty} />
	<Marks owner={item} key="name" {lang} text={item.name} onpick={(a) => (item.name = settledName = a)} />

	{#each others as x, k (k)}<p class="err">{blockText(x)}</p>{/each}

	<button type="button" class="more" aria-expanded={open} aria-controls="{id}-details" onclick={() => (open = !open)}>
		{open ? f.hideDetails : f.details}{#if !open && hasDetails(item)}<span class="dot" aria-hidden="true">•</span>{/if}
	</button>

	<div class="details" id="{id}-details" hidden={!open}>
		<div class="grid">
			<div class="field">
				<label for="{id}-prep">{f.prep}</label>
				<input id="{id}-prep" type="text" bind:value={item.prep} aria-invalid={!!b('prep') || undefined} placeholder={f.prepPlaceholder} />
				{#if b('prep')}<p class="err" data-testid="err-prep">{err('prep')}</p>{/if}
				<Marks owner={item} key="prep" {lang} text={item.prep} onpick={(a) => (item.prep = a)} />
			</div>
			<div class="field">
				<label for="{id}-note">{f.note}</label>
				<input id="{id}-note" type="text" bind:value={item.note} aria-invalid={!!b('note') || undefined} />
				{#if b('note')}<p class="err" data-testid="err-note">{err('note')}</p>{/if}
				<Marks owner={item} key="note" {lang} text={item.note} onpick={(a) => (item.note = a)} />
			</div>
			<div class="field">
				<label for="{id}-brand">{f.brand}</label>
				<input id="{id}-brand" type="text" bind:value={item.brand} aria-invalid={!!b('brand') || undefined} />
				{#if b('brand')}<p class="err" data-testid="err-brand">{err('brand')}</p>{/if}
				<Marks owner={item} key="brand" {lang} text={item.brand} onpick={(a) => (item.brand = a)} />
			</div>
			<div class="field">
				<label for="{id}-max">{f.upTo}</label>
				<QtyInput id="{id}-max" label={f.upTo} bind:value={item.qtyMax} placeholder="" disabled={item.toTaste} invalid={!!b('qtyMax')} describedby="{id}-max-help" testid="qty-max" />
				<small id="{id}-max-help" class:err={!!b('qtyMax')}>{err('qtyMax') ?? f.upToHelp}</small>
			</div>
		</div>
		<div class="checks">
			<label class="check"><input type="checkbox" checked={item.toTaste} onchange={(e) => setToTaste(item, e.currentTarget.checked)} data-testid="to-taste" /> {f.toTaste}</label>
			<label class="check"><input type="checkbox" bind:checked={item.optional} /> {f.optional}</label>
		</div>

		{#if !item.toTaste}
			{#if item.alt}
				<fieldset class="sub">
					<legend>{f.alt}</legend>
					<div class="line alt">
						<QtyInput id="{id}-alt-qty" label="{f.alt} — {f.qty}" bind:value={item.alt.qty} invalid={!!b('alt')} />
						<label class="visually-hidden" for="{id}-alt-unit">{f.alt} — {f.unit}</label>
						<select id="{id}-alt-unit" bind:value={item.alt.unit}>
							<option value="">{f.noUnit}</option>
							{#each units as u (u)}<option value={u}>{unitName(u)}</option>{/each}
						</select>
						<button type="button" class="icon" aria-label={f.altRemove} onclick={() => (item.alt = null)}>✕</button>
					</div>
					<small class:err={!!(b('alt') || b('alt.qtyMax'))}>{b('alt') ? f.field.incomplete : (err('alt.qtyMax') ?? f.altHelp)}</small>
				</fieldset>
			{:else}
				<button type="button" class="btn quiet" onclick={() => (item.alt = { qty: '', qtyMax: '', unit: '', written: {} })}>+ {f.altAdd}</button>
			{/if}
		{/if}

		{#if !nested}
			<fieldset class="sub">
				<legend>{f.or}</legend>
				{#each item.or as o, k (o.id)}
					<ItemRow
						item={o}
						{lang}
						{units}
						{words}
						{own}
						{blocks}
						{hints}
						label="{label} — {f.or} {k + 1}"
						nested
						onremove={() => item.or.splice(k, 1)}
					/>
				{/each}
				<button type="button" class="btn quiet" onclick={() => item.or.push(newItem())}>+ {f.orAdd}</button>
			</fieldset>

			<fieldset class="sub">
				<legend>{f.subRecipe}</legend>
				{#if item.recipe}
					<p class="picked">
						<a href="/r/{item.recipe}" target="_blank" rel="noopener">{subTitle || item.recipe}</a>
						<button type="button" class="btn quiet" onclick={() => ((item.recipe = ''), (item.buyInstead = false), (subTitle = ''))}>{f.subRecipeRemove}</button>
					</p>
					<label class="check"><input type="checkbox" bind:checked={item.buyInstead} /> {f.buyInstead}</label>
					{#if b('recipe')}<p class="err">{err('recipe')}</p>{/if}
				{:else if picking}
					<Suggest
						id="{id}-sub"
						label={f.subRecipePick}
						load={recipes}
						onpick={(o) => {
							item.recipe = o.value;
							subTitle = o.label;
							if (!item.name.trim()) item.name = o.label;
							picking = false;
						}}
						testid="sub-recipe"
					/>
				{:else}
					<button type="button" class="btn quiet" onclick={() => (picking = true)}>+ {f.subRecipePick}</button>
				{/if}
			</fieldset>
		{/if}
	</div>
</div>

<style>
	.row {
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--rule-blue);
	}
	.row.nested {
		border-bottom: 0;
		padding-left: 0.5rem;
		border-left: 2px solid var(--rule-blue);
	}
	.line {
		display: grid;
		grid-template-columns: 4.6rem minmax(5.5rem, 8rem) minmax(0, 1fr) auto;
		gap: 0.35rem;
		align-items: start;
	}
	.line.alt {
		grid-template-columns: 4.6rem minmax(5.5rem, 8rem) auto;
	}
	select {
		min-height: 44px;
		min-width: 0;
		width: 100%;
	}
	select[aria-invalid='true'] {
		border-color: var(--rule-red);
	}
	.tools {
		display: flex;
		gap: 2px;
	}
	.icon {
		min-width: 44px;
		min-height: 44px;
		border: 1px solid transparent;
		border-radius: var(--radius);
		background: none;
		color: var(--ink-soft);
		font-size: 1.05rem;
		cursor: pointer;
	}
	.icon:hover:not(:disabled) {
		border-color: var(--line);
		color: var(--ink);
	}
	.icon:disabled {
		opacity: 0.3;
		cursor: default;
	}
	/* A phone: quantity and unit on one line, the name under them, tools at the end. */
	@media (max-width: 34rem) {
		.line {
			grid-template-columns: 4.6rem minmax(0, 1fr) auto;
		}
		.line > :global(.suggest) {
			grid-column: 1 / 3;
			grid-row: 2;
		}
		.tools {
			grid-column: 3;
			grid-row: 1 / 3;
			flex-direction: column;
		}
		.nested .tools {
			grid-row: 1;
		}
	}
	.linked {
		display: inline-block;
		margin-top: 0.15rem;
		font-size: var(--step--1);
		color: var(--ok);
		font-weight: 600;
	}
	.err {
		margin: 0.2rem 0 0;
		font-size: var(--step--1);
		color: var(--rule-red);
	}
	small.err {
		margin: 0;
	}
	.hint {
		margin: 0.3rem 0 0;
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
	.soft {
		margin: 0.15rem 0 0;
		font-size: var(--step--1);
		color: var(--pencil);
	}
	.more {
		min-height: 44px;
		background: none;
		border: 0;
		padding: 0 0.1rem;
		color: var(--link);
		font-weight: 600;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	.dot {
		color: var(--rule-red);
		margin-left: 0.25rem;
	}
	.details {
		padding: 0.25rem 0 0.5rem 0.75rem;
		border-left: 2px solid var(--line);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
		gap: 0.5rem 0.75rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}
	.field label,
	legend {
		font-size: var(--step--1);
		font-weight: 600;
		color: var(--ink-soft);
	}
	.field input {
		min-height: 44px;
	}
	small {
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.checks {
		display: flex;
		flex-wrap: wrap;
		gap: 0 1.25rem;
		margin-top: 0.4rem;
	}
	.check {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		min-height: 44px;
		cursor: pointer;
	}
	.check input {
		width: 1.25rem;
		height: 1.25rem;
	}
	.sub {
		border: 0;
		margin: 0.4rem 0 0;
		padding: 0;
		min-width: 0;
	}
	.btn.quiet {
		min-height: 44px;
	}
	.picked {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
	}
</style>
