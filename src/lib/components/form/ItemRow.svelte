<script lang="ts">
	// One ingredient row (plan 04, Q6 A): quantity, unit, name and ⋯ on one
	// line, on a phone too (round 5: a narrow quantity, the unit in its short
	// word, the name taking the rest). What else the row holds is one line
	// under the name (« haché · ou ½ lb · au goût ✎ ») that opens the details
	// in place; a row with none offers « + précision » (beside ⋯ on a wide
	// screen, under the row on a phone, on the row she works on). Open, the row shows
	// the details it has — préparation, note, marque, jusqu'à, au goût,
	// facultatif, ou en mesure, ou remplacer par, « C'est une autre recette »
	// (Phase 5.6) — and one « Ajouter un détail » for the others. Monter,
	// Descendre, Détails and Retirer are behind the row's ⋯. An `or` entry is
	// drawn by this same component, nested.
	//
	// On a phone (UI pass 3) a filled row the form is not working on shows as
	// one read-only line (« 1 ½ lb porc haché · ou 675 g »); a touch (or Enter)
	// opens it as the editor, and the row opened before folds back (the form
	// keeps one open at a time). An empty row, a row with something to fix, a
	// suggestion or an uncertain reading stays open. Only CSS tells a phone: the
	// line is in the page on every screen, shown at ≤ 600 px.
	import { tick, untrack } from 'svelte';
	import ItemRow from './ItemRow.svelte';
	import Marks from './Marks.svelte';
	import QtyInput from './QtyInput.svelte';
	import Suggest, { type Option } from './Suggest.svelte';
	import Menu from '../Menu.svelte';
	import { applyNameHint, applyNameSplit, blockOn, fieldMarkers, fractionSlip, nameHint, nameSplit, newItem, parseQuantityInput, setToTaste, showQuantity, unitMenu, type Block, type FormHint, type FormItem } from '$lib/form';
	import { form as f } from '$lib/i18n';
	import { locale } from '$lib/prefs';
	import { formHintText } from '$lib/i18n/diagnostics';
	import { fold } from '$lib/vault/normalize';
	import { blockText, FRACTIONS, withFraction } from './formui';
	import { unitLabel } from '$lib/render/ingredient';
	import type { CheckWords } from '$lib/vault/words';
	import type { Lang, Unit } from '$lib/vault/types';
	import { afterPress } from './press';

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
		compactable = false,
		onactivate,
		example,
		reveal = false,
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
		/** A phone may fold this row to one line: the form is working on another one. */
		compactable?: boolean;
		/** She works on this row now (a field of it focused, its line touched): the others may fold. */
		onactivate?: () => void;
		/** Its place in the list: only the first row shows an example (« ex. farine »); the others say what the box is for (UI round 1: a grey « 2 » read as a value). */
		example?: number;
		/** Save was tried: what the row lacks is said even while she is in it. */
		reveal?: boolean;
		qtyInput?: HTMLInputElement;
	} = $props();

	type Detail = 'prep' | 'note' | 'brand' | 'qtyMax' | 'toTaste' | 'optional' | 'alt' | 'or' | 'recipe';
	const DETAILS: Detail[] = ['prep', 'note', 'brand', 'qtyMax', 'toTaste', 'optional', 'alt', 'or', 'recipe'];
	const DETAIL_NAME: Record<Detail, string> = {
		prep: f.prep,
		note: f.note,
		brand: f.brand,
		qtyMax: f.upTo,
		toTaste: f.toTaste,
		optional: f.optional,
		alt: f.alt,
		or: f.or,
		recipe: f.subRecipe
	};

	const id = $derived(`it-${item.id}`);
	// Every row starts as one line; she opens the one she works on.
	let open = $state(false);
	/** Details she asked for with « Ajouter un détail », still empty. */
	let asked = $state<Detail[]>([]);
	let linked = $state<boolean | null>(null);
	/**
	 * The name's type-ahead and its « relié » mark, asked with the row's unit:
	 * a `when` rule links « soda » by the spoon to baking soda, as the paste
	 * check does (usability round 4).
	 */
	const nameQuery = (q: string) => `/api/suggest?kind=name&lang=${lang}&q=${encodeURIComponent(q)}${item.unit ? `&unit=${encodeURIComponent(item.unit)}` : ''}`;
	/** The unit changed under a name already marked (or not): ask again. */
	let unitAsked = untrack(() => item.unit);
	$effect(() => {
		const unit = item.unit;
		if (unit === unitAsked) return;
		unitAsked = unit;
		const name = untrack(() => item.name.trim());
		if (!name || untrack(() => linked) === null) return;
		fetch(nameQuery(name))
			.then(async (res) => {
				if (res.ok && item.name.trim() === name && item.unit === unit) linked = ((await res.json()) as { linked: boolean }).linked;
			})
			.catch(() => {
				/* offline: the next check says it */
			});
	});
	let subTitle = $state('');
	let picking = $state(false);

	const has = (k: Detail): boolean => {
		switch (k) {
			case 'prep':
			case 'note':
			case 'brand':
				return !!item[k].trim();
			case 'qtyMax':
				return !!item.qtyMax.trim();
			case 'toTaste':
				return item.toTaste;
			case 'optional':
				return item.optional;
			case 'alt':
				return item.alt !== null;
			case 'or':
				return item.or.length > 0;
			case 'recipe':
				return !!item.recipe || picking;
		}
	};
	const offered = (k: Detail) => !(nested && (k === 'or' || k === 'recipe')) && !(item.toTaste && (k === 'qtyMax' || k === 'alt'));
	const shown = (k: Detail) => offered(k) && (has(k) || asked.includes(k) || !!b(k));
	const missing = $derived(DETAILS.filter((k) => offered(k) && !shown(k)));

	const hint = $derived(nameHint(item.name, words));
	/**
	 * « 1 pincée de sel » typed whole in the name, the amount boxes empty: the
	 * paste reader's reading of it, offered as [Séparer : 1 · pincée · sel].
	 */
	const split = $derived(!item.qty.trim() && !item.unit && !item.toTaste ? nameSplit(item.name, lang) : undefined);
	const splitText = $derived.by(() => {
		if (!split) return '';
		const amount = [showQuantity(split.qty!.raw, lang), split.qtyMax ? `${f.range} ${showQuantity(split.qtyMax.raw, lang)}` : ''].filter(Boolean).join(' ');
		return [amount, split.unit ? unitName(split.unit, (split.qtyMax ?? split.qty)!.value) : '', split.name].filter(Boolean).join(' · ');
	});

	/**
	 * A quantity typed in a row with no unit yet: the unit is « à l'unité »
	 * (`piece`, a count — the file needs a unit, docs/RECIPE-SCHEMA.md), shown
	 * in the box so she sees it and can change it; never a « Choisissez
	 * l'unité » the moment Tab reaches the box (usability round 3). Only what
	 * she types sets it (a row loaded without a unit still asks), and it goes
	 * again if she empties the quantity before choosing anything.
	 */
	let rowEl: HTMLDivElement | undefined = $state();
	let autoUnit = false;
	let hadQty = untrack(() => !!item.qty.trim());
	$effect(() => {
		const has = !!item.qty.trim();
		untrack(() => {
			if (has && !hadQty && !item.unit && !item.toTaste && rowEl?.contains(document.activeElement)) {
				item.unit = 'piece';
				autoUnit = true;
			} else if (!has && hadQty && autoUnit && item.unit === 'piece') {
				item.unit = '';
				autoUnit = false;
			}
			hadQty = has;
		});
	});
	const b = (field: string) => blockOn(blocks, item.id, field);
	/**
	 * What the row lacks (a name, a quantity for its unit) waits until she
	 * leaves the row — never under a box the moment Tab reaches it (usability
	 * round 3) — unless Save was tried. What is wrong (a format, a range) shows
	 * at once. A row that came filled (an edit, a paste) has been left.
	 */
	let left = $state(untrack(() => !!(item.qty.trim() || item.unit || item.name.trim())));
	const LACKS = ['required', 'qty', 'unit'];
	const shownB = (field: string) => {
		const x = b(field);
		return x && (left || reveal || !LACKS.includes(x.reason)) ? x : undefined;
	};
	const unitName = (u: Unit, n = 1) => (u === 'piece' ? f.piece : unitLabel(u, n, locale()));
	/** The vault's most used units first, family by family, « sans unité » after them; the rest under « Autres unités » (usability round 4). */
	const menu = $derived(unitMenu(units));
	/**
	 * The name as it stood when she last left the field (or picked a suggestion).
	 * "Pas encore relié" (W303 / W305) waits for it: not under every half-typed
	 * name while she types (issue #11). Still only a soft line, never a block.
	 */
	let settledName = $state(untrack(() => item.name));
	const settled = $derived(item.name.trim() === settledName.trim());
	const myHints = $derived(
		hints.filter(
			(h) =>
				h.target === item.id &&
				(h.code === 'W306' || ((h.code === 'W303' || h.code === 'W305') && settled && (h.value === undefined || fold(h.value) === fold(item.name))))
		)
	);
	/**
	 * « Vouliez-vous dire « oignon » ? [Oui] » (round 2 of the usability pass):
	 * an unlinked name a letter off one registry name; Oui writes that name.
	 */
	async function takeNear(name: string) {
		item.name = settledName = name;
		linked = null;
		try {
			const res = await fetch(nameQuery(name));
			if (res.ok && item.name === name) linked = ((await res.json()) as { linked: boolean }).linked;
		} catch {
			/* offline: the next check says it */
		}
	}
	/** Blocks on this row with no field of their own on screen: said at the row's end. */
	const SHOWN = ['qty', 'unit', 'name', 'prep', 'note', 'brand', 'qtyMax', 'alt', 'alt.qtyMax'];
	const others = $derived(blocks.filter((x) => x.id === item.id && !SHOWN.includes(x.field) && (nested || x.field !== 'recipe')));
	/** Something in the details needs her: a field to fix, an uncertain reading to confirm. The row opens for it. */
	const detailsFlagged = $derived(
		['prep', 'note', 'brand', 'qtyMax', 'alt', 'alt.qtyMax', 'recipe'].some((k) => b(k)) ||
			!!others.length ||
			(['prep', 'note', 'brand'] as const).some((k) => fieldMarkers(item, k, lang).uncertain) ||
			(!!item.alt && fieldMarkers(item.alt, 'qty', lang).uncertain)
	);
	$effect(() => {
		if (detailsFlagged) open = true;
	});
	// Open, a detail stays on screen while she empties it (to type it again); closed and opened again, only what is filled.
	$effect(() => {
		if (!open) return;
		const now = DETAILS.filter(has);
		untrack(() => {
			const more = now.filter((k) => !asked.includes(k));
			if (more.length) asked = [...asked, ...more];
		});
	});
	function close() {
		open = false;
		asked = [];
	}

	/**
	 * The row as one line on a phone, when nothing in it needs her: a name, no
	 * block, no suggestion, no uncertain reading, its details closed.
	 */
	const compact = $derived(
		compactable &&
			!nested &&
			!open &&
			!!item.name.trim() &&
			!b('qty') &&
			!b('unit') &&
			!b('name') &&
			!hint &&
			!myHints.some((h) => h.suggestion) &&
			!detailsFlagged &&
			!fieldMarkers(item, 'qty', lang).uncertain &&
			!fieldMarkers(item, 'name', lang).uncertain
	);
	/** « 1 ½ lb », « 2 » (à l'unité says no word), « 1 gousse »: the amount of the folded line. */
	const amount = $derived.by(() => {
		const q = item.qty.trim();
		const p = parseQuantityInput(q);
		const u = item.unit ? unitLabel(item.unit, p.ok ? p.value : 1, locale()) : '';
		return [q, u].filter(Boolean).join(' ');
	});
	async function unfold() {
		onactivate?.();
		await tick();
		qtyInput?.focus();
	}
	const TYPED = 'input, select, textarea';

	/** « 21/2 »: a whole number run into its fraction — what it reads as, and the likely meaning a tap away (usability round 5). */
	const slip = $derived(nested ? undefined : fractionSlip(item.qty, lang));
	/**
	 * The quantity has the focus: a wide screen shows the fractions' line under
	 * the row then (in the flow, so it covers neither the row's error nor « +
	 * Ajouter un ingrédient »; usability round 5). It goes once the press that
	 * took the focus away is over, so nothing moves under the pointer.
	 */
	let qtyFocus = $state(false);

	/** The name box's hint: an example in the first row only, the column's word elsewhere. The quantity box always says « qté » (QtyInput). */
	const namePlaceholder = $derived(example === 0 && !nested ? f.namePlaceholder : f.nameHint);
	/**
	 * The unit as the closed box shows it on a phone: the word, or « sans
	 * unité » when none is chosen. Never the row's example: a grey « tasse »
	 * in an empty box read as a unit chosen (round 1 of the usability pass).
	 */
	const unitFace = $derived(item.unit ? unitName(item.unit) : f.noUnit);

	/** « ou 4 tasses »: the unit word in the number its amount needs (French plural from 2), as on the recipe page. */
	const altText = (a: NonNullable<FormItem['alt']>) => {
		const n = parseQuantityInput(a.qty);
		const word = !a.unit ? '' : a.unit === 'piece' ? f.piece : unitLabel(a.unit, n.ok ? n.value : 1, locale());
		return [a.qty.trim(), word].filter(Boolean).join(' ');
	};
	/** The closed row's grey line: what the details hold, in the order of the recipe line. */
	const summary = $derived.by(() => {
		const out: string[] = [];
		if (item.qtyMax.trim()) out.push(f.sum.upTo(item.qtyMax.trim()));
		if (item.alt && altText(item.alt)) out.push(f.sum.alt(altText(item.alt)));
		if (item.prep.trim()) out.push(item.prep.trim());
		if (item.note.trim()) out.push(item.note.trim());
		if (item.brand.trim()) out.push(item.brand.trim());
		if (item.toTaste) out.push(f.sum.toTaste);
		if (item.optional) out.push(f.sum.optional);
		for (const o of item.or) if (o.name.trim()) out.push(f.sum.or(o.name.trim()));
		if (item.recipe) out.push(f.sum.recipe);
		return out.join(' · ');
	});

	async function names(q: string): Promise<Option[]> {
		if (!q.trim()) return [];
		const res = await fetch(nameQuery(q));
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

	async function focus(elId: string) {
		await tick();
		document.getElementById(elId)?.focus();
	}

	async function toggle() {
		if (open) return close();
		open = true;
		// Opened with nothing in it: straight to « Ajouter un détail ».
		if (open && !DETAILS.some(shown)) focus(`${id}-add`);
	}

	/** The grey line touched: the details open where they are, the first field focused. */
	async function openDetails() {
		onactivate?.();
		open = true;
		await tick();
		const first = document.getElementById(`${id}-details`)?.querySelector<HTMLElement>('input:not([type=checkbox]):not(:disabled), select, input');
		first?.focus();
	}

	/** « + précision »: the row opens on a préparation box (« haché », « tamisée »), the others a pick away. */
	function addPrecision() {
		onactivate?.();
		open = true;
		addDetail('prep');
	}

	/** « Ajouter un détail »: the field appears, the focus in it. */
	function addDetail(k: Detail) {
		if (!asked.includes(k)) asked = [...asked, k];
		switch (k) {
			case 'toTaste':
				setToTaste(item, true);
				return focus(`${id}-taste`);
			case 'optional':
				item.optional = true;
				return focus(`${id}-optional`);
			case 'alt':
				item.alt = { qty: '', qtyMax: '', unit: '', written: {} };
				return focus(`${id}-alt-qty`);
			case 'or': {
				const o = newItem();
				item.or.push(o);
				return focus(`it-${o.id}-qty`);
			}
			case 'recipe':
				picking = true;
				return focus(`${id}-sub`);
			case 'qtyMax':
				return focus(`${id}-max`);
			default:
				return focus(`${id}-${k}`);
		}
	}
</script>

{#snippet unitOptions()}
	<optgroup label={f.unitsCommon}>
		{#each menu.common as u (u)}<option value={u}>{unitName(u)}</option>{/each}
		<option value="">{f.noUnit}</option>
	</optgroup>
	<optgroup label={f.unitsOther}>
		{#each menu.rest as u (u)}<option value={u}>{unitName(u)}</option>{/each}
	</optgroup>
{/snippet}

<!-- The focusin only tells the form which row she works on; it adds no interaction. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={rowEl}
	class="row"
	class:nested
	class:open
	class:compact
	data-testid="item-row"
	onfocusout={(e) => {
		// Focus gone out of the row (not to its own details or ⋯): what it lacks may be said now.
		if (!rowEl?.contains(e.relatedTarget as Node | null)) left = true;
		if (e.target === qtyInput) afterPress(() => (qtyFocus = !!qtyInput && document.activeElement === qtyInput));
	}}
	onfocusin={(e) => {
		if (e.target === qtyInput) qtyFocus = true;
		// The row before folds once the press is over: folding under the finger, it would move this row away from it.
		if (!nested && (e.target as HTMLElement).matches?.(TYPED)) afterPress(() => onactivate?.());
	}}
>
	<div class="main" class:summed={!open && !!summary}>
		{#if compact}
			<button type="button" class="line-view" onclick={unfold} data-testid="item-line">
				<span class="visually-hidden">{`${f.editItem} : `}</span>{#if amount}<span class="amt">{amount}</span>{' '}{/if}<span class="nm">{item.name}</span
				>{#if summary}<span class="more">{' · '}{summary}</span>{/if}
			</button>
		{/if}
		<QtyInput
			id="{id}-qty"
			label="{label} — {f.qty}"
			bind:value={item.qty}
			bind:input={qtyInput}
			inlineOnPhone={!nested}
			disabled={item.toTaste}
			invalid={!!shownB('qty')}
			describedby={shownB('qty') ? `${id}-err` : undefined}
			testid="qty"
		/>
		<label class="visually-hidden" for="{id}-unit">{label} — {f.unit}</label>
		<div class="unit" class:empty={!item.unit}>
			<select id="{id}-unit" class:empty={!item.unit} bind:value={item.unit} onchange={() => (autoUnit = false)} disabled={item.toTaste} aria-invalid={!!shownB('unit') || undefined} aria-describedby={shownB('unit') ? `${id}-err` : undefined} data-testid="unit">
				{@render unitOptions()}
			</select>
			<!-- A phone: the closed box's word. -->
			<span class="unit-face" aria-hidden="true">{unitFace}</span>
		</div>
		<div class="name">
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
				onblur={() => afterPress(() => (settledName = item.name))}
				{onenter}
				placeholder={namePlaceholder}
				invalid={!!shownB('name')}
				testid="name"
			/>
		</div>
		{#if !open && summary}
			<!-- What the details hold, touched: they open in place, the first one focused. -->
			<button type="button" class="sum" aria-expanded="false" aria-controls="{id}-details" title={f.detailsEdit} onclick={openDetails} data-testid="item-summary">
				<span class="visually-hidden">{f.detailsEdit} : </span>{summary}<span class="pen" aria-hidden="true">✎</span>
			</button>
		{:else if !open && !nested && !item.toTaste}
			<!-- None yet: « + précision » (a préparation first; the others from « Ajouter un détail »). -->
			<button type="button" class="prec" class:active={!compactable} title={f.precisionTitle} onclick={() => addPrecision()} data-testid="item-precision">+ {f.precisionAdd}</button>
		{/if}
		<div class="tools">
			<Menu label={f.itemActions(label)} testid="item-menu">
				{#if !nested}
					<button type="button" disabled={first} onclick={() => onmove?.(-1)}>{f.moveUp}</button>
					<button type="button" disabled={last} onclick={() => onmove?.(1)}>{f.moveDown}</button>
				{/if}
				<button type="button" aria-expanded={open} aria-controls="{id}-details" onclick={toggle}>{open ? f.hideDetails : f.details}</button>
				{#if !nested && !item.recipe}
					<button type="button" onclick={() => ((open = true), addDetail('recipe'))}>{f.subRecipe}</button>
				{/if}
				<hr />
				<button type="button" class="danger" onclick={onremove}>{f.remove}</button>
			</Menu>
		</div>
	</div>
	{#if !nested && (!compactable || qtyFocus) && !item.toTaste}
		<!-- The fractions a keyboard lacks, a line of the row: a phone's on the row she works on, a wide screen's while the quantity has the focus — floating, they covered the row above, its error, the add button. -->
		<div class="fracs" class:on={qtyFocus} role="group" aria-label={f.fractions} data-testid="fracs">
			{#each FRACTIONS as g (g)}
				<button
					type="button"
					tabindex="-1"
					onpointerdown={(e) => e.preventDefault()}
					onclick={() => {
						item.qty = withFraction(item.qty, g);
						qtyInput?.focus();
					}}>{g}</button
				>
			{/each}
		</div>
	{/if}
	<label class="visually-hidden" for="{id}-name">{label} — {f.name}</label>
	{#if linked && item.name.trim()}<span class="linked" title={f.linkedTitle}>✓ {f.linked}</span>{/if}
	{#if shownB('qty') || shownB('unit') || shownB('name')}
		<p class="err" id="{id}-err">{blockText(shownB('qty') ?? shownB('unit') ?? shownB('name'))}</p>
	{/if}
	{#if slip}
		<p class="hint" data-testid="qty-slip">
			{f.qtySlip(item.qty.trim(), slip.reads, slip.meant)}
			<button
				type="button"
				class="btn"
				onclick={() => {
					item.qty = slip.meant;
					qtyInput?.focus();
				}}
				data-testid="qty-slip-yes">{f.qtySlipYes(slip.meant)}</button
			>
		</p>
	{/if}
	{#if split}
		<!-- The whole line in the name: one tap splits it as « Coller une liste » would. -->
		<p class="hint split" data-testid="name-split">
			<button
				type="button"
				class="btn"
				title={f.splitNameTitle}
				onclick={async () => {
					applyNameSplit(item, split, lang);
					settledName = item.name;
					await tick();
					document.getElementById(`${id}-name`)?.focus();
				}}
				data-testid="name-split-yes">{f.splitName(splitText)}</button
			>
		</p>
	{/if}
	{#if hint}
		<p class="hint" data-testid="name-hint">
			{formHintText[hint.code]({ word: hint.word })}
			<button
				type="button"
				class="btn"
				onclick={() => {
					applyNameHint(item, hint);
					settledName = item.name;
					// Where the word went, in sight.
					open = true;
				}}>{f.useSuggestion(hint.word)}</button
			>
		</p>
	{/if}
	{#each myHints as h (h.code)}
		{#if h.suggestion}
			{@const near = h.suggestion}
			<p class="hint near" data-testid="name-near">
				{formHintText[h.code]({ value: item.name.trim(), suggestion: near })}
				<button type="button" class="btn" title={f.nameNearYesTitle(near)} onclick={() => takeNear(near)} data-testid="name-near-yes">{f.nameNearYes}</button>
			</p>
		{:else}
			<p class="soft" data-testid="row-hint">{formHintText[h.code]({})}</p>
		{/if}
	{/each}
	<Marks owner={item} key="qty" {lang} text={item.qty} />
	<Marks owner={item} key="name" {lang} text={item.name} onpick={(a) => (item.name = settledName = a)} />

	{#each others as x, k (k)}<p class="err">{blockText(x)}</p>{/each}

	{#if open}
		<div class="details" id="{id}-details">
			{#if shown('prep') || shown('note') || shown('brand') || shown('qtyMax')}
				<div class="grid">
					{#if shown('qtyMax')}
						<div class="field max">
							<label for="{id}-max">{f.upTo}</label>
							<QtyInput id="{id}-max" label={f.upTo} bind:value={item.qtyMax} placeholder="" disabled={item.toTaste} invalid={!!b('qtyMax')} describedby="{id}-max-help" testid="qty-max" />
							<small id="{id}-max-help" class:err={!!b('qtyMax')}>{err('qtyMax') ?? f.upToHelp}</small>
						</div>
					{/if}
					{#if shown('prep')}
						<div class="field">
							<label for="{id}-prep">{f.prep}</label>
							<input id="{id}-prep" type="text" bind:value={item.prep} aria-invalid={!!b('prep') || undefined} placeholder={f.prepPlaceholder} />
							{#if b('prep')}<p class="err" data-testid="err-prep">{err('prep')}</p>{/if}
							<Marks owner={item} key="prep" {lang} text={item.prep} onpick={(a) => (item.prep = a)} />
						</div>
					{/if}
					{#if shown('note')}
						<div class="field">
							<label for="{id}-note">{f.note}</label>
							<input id="{id}-note" type="text" bind:value={item.note} aria-invalid={!!b('note') || undefined} />
							{#if b('note')}<p class="err" data-testid="err-note">{err('note')}</p>{/if}
							<Marks owner={item} key="note" {lang} text={item.note} onpick={(a) => (item.note = a)} />
						</div>
					{/if}
					{#if shown('brand')}
						<div class="field">
							<label for="{id}-brand">{f.brand}</label>
							<input id="{id}-brand" type="text" bind:value={item.brand} aria-invalid={!!b('brand') || undefined} />
							{#if b('brand')}<p class="err" data-testid="err-brand">{err('brand')}</p>{/if}
							<Marks owner={item} key="brand" {lang} text={item.brand} onpick={(a) => (item.brand = a)} />
						</div>
					{/if}
				</div>
			{/if}
			{#if shown('toTaste') || shown('optional')}
				<div class="checks">
					{#if shown('toTaste')}
						<label class="check"><input id="{id}-taste" type="checkbox" checked={item.toTaste} onchange={(e) => setToTaste(item, e.currentTarget.checked)} data-testid="to-taste" /> {f.toTaste}</label>
					{/if}
					{#if shown('optional')}
						<label class="check"><input id="{id}-optional" type="checkbox" bind:checked={item.optional} /> {f.optional}</label>
					{/if}
				</div>
			{/if}

			{#if shown('alt') && item.alt}
				<fieldset class="sub">
					<legend>{f.alt}</legend>
					<div class="line alt">
						<QtyInput id="{id}-alt-qty" label="{f.alt} — {f.qty}" bind:value={item.alt.qty} invalid={!!b('alt')} />
						<label class="visually-hidden" for="{id}-alt-unit">{f.alt} — {f.unit}</label>
						<select id="{id}-alt-unit" bind:value={item.alt.unit}>
							{@render unitOptions()}
						</select>
						<button
							type="button"
							class="icon"
							aria-label={f.altRemove}
							onclick={() => {
								item.alt = null;
								asked = asked.filter((k) => k !== 'alt');
							}}>✕</button
						>
					</div>
					<small class:err={!!(b('alt') || b('alt.qtyMax'))}>{b('alt') ? f.field.incomplete : (err('alt.qtyMax') ?? f.altHelp)}</small>
				</fieldset>
			{/if}

			{#if shown('or')}
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
							{reveal}
							onremove={() => item.or.splice(k, 1)}
						/>
					{/each}
					<button
						type="button"
						class="btn quiet"
						onclick={() => {
							const o = newItem();
							item.or.push(o);
							focus(`it-${o.id}-qty`);
						}}>+ {f.orAdd}</button
					>
				</fieldset>
			{/if}

			{#if shown('recipe')}
				<fieldset class="sub">
					<legend>{f.subRecipe}</legend>
					{#if item.recipe}
						<p class="picked">
							<a href="/r/{item.recipe}" target="_blank" rel="noopener">{subTitle || item.recipe}</a>
							<button
								type="button"
								class="btn quiet"
								onclick={() => {
									item.recipe = '';
									item.buyInstead = false;
									subTitle = '';
									asked = asked.filter((k) => k !== 'recipe');
								}}>{f.subRecipeRemove}</button
							>
						</p>
						<label class="check"><input type="checkbox" bind:checked={item.buyInstead} /> {f.buyInstead}</label>
						{#if b('recipe')}<p class="err">{err('recipe')}</p>{/if}
					{:else}
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
					{/if}
				</fieldset>
			{/if}

			<div class="foot">
				{#if missing.length}
					<label class="visually-hidden" for="{id}-add">{label} — {f.addDetail}</label>
					<select
						id="{id}-add"
						class="add"
						value=""
						onchange={(e) => {
							const k = e.currentTarget.value as Detail | '';
							e.currentTarget.value = '';
							if (k) addDetail(k);
						}}
						data-testid="add-detail"
					>
						<option value="">+ {f.addDetail}…</option>
						{#each missing as k (k)}<option value={k}>{DETAIL_NAME[k]}</option>{/each}
					</select>
				{/if}
				<button type="button" class="btn quiet less" aria-expanded="true" aria-controls="{id}-details" onclick={close}>{f.hideDetails}</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.row {
		padding: 0.25rem 0;
		border-bottom: 1px solid var(--rule-blue);
	}
	.row.nested {
		border-bottom: 0;
		padding-left: 0.5rem;
		border-left: 2px solid var(--rule-blue);
	}
	/* Quantity, unit, name, « + précision », ⋯ on one line; the details' line under the name. */
	.main {
		display: grid;
		grid-template-columns: 4.6rem 7.5rem minmax(0, 1fr) 6.5rem 44px;
		grid-template-areas: 'qty unit name prec tools' '. . sum sum .';
		gap: 0 0.35rem;
		align-items: start;
	}
	.main > :global(.qty) {
		grid-area: qty;
	}
	.main > .unit {
		grid-area: unit;
	}
	.main > .prec {
		grid-area: prec;
	}
	.unit {
		position: relative;
		min-width: 0;
	}
	.unit-face {
		display: none;
	}
	.main > .name {
		grid-area: name;
	}
	.main > .sum {
		grid-area: sum;
	}
	.main > .tools {
		grid-area: tools;
	}
	.line.alt {
		display: grid;
		grid-template-columns: 4.6rem minmax(6rem, 8rem) 44px;
		gap: 0.35rem;
		align-items: start;
	}
	/* A mouse: a denser list, 40 px lines, the form's one size for a mouse (a finger keeps 44 px; round 3). */
	@media (pointer: fine) and (min-width: 37.51rem) {
		.main > :global(.qty input),
		.main > .unit select,
		.name :global(.suggest input) {
			min-height: 2.5rem;
			padding-block: 0.2rem;
		}
		.main .tools :global(summary) {
			min-height: 2.5rem;
		}
		.row {
			padding: 0.125rem 0;
		}
	}
	/*
	 * A phone: quantity and unit on the first line (« + précision » beside
	 * them on the row she works on), the name on the whole second line with ⋯
	 * — on one line the name had 124 px of 390. The details' line under it.
	 * Every box 44 px high; the reading order stays quantity, unit, name.
	 */
	@media (max-width: 37.5rem) {
		.main {
			grid-template-columns: 4.2rem 9rem minmax(0, 1fr) 44px;
			grid-template-areas: 'qty unit prec prec' 'name name name tools' 'sum sum sum sum';
			gap: 0.3rem 0.3rem;
		}
		.main > .prec {
			justify-self: start;
		}
		.main > :global(.qty input) {
			padding-inline: 0.4rem;
		}
		.unit select,
		.unit select.empty {
			color: transparent;
			padding-left: 0.45rem;
			padding-right: 1.1rem;
			background-position: right 0.4rem center;
			background-size: 0.55rem auto;
		}
		.unit select option {
			color: var(--ink);
		}
		.unit-face {
			display: block;
			position: absolute;
			left: 0.5rem;
			right: 1.1rem;
			top: 50%;
			transform: translateY(-50%);
			overflow: hidden;
			white-space: nowrap;
			color: var(--ink);
			pointer-events: none;
		}
		.unit.empty .unit-face {
			color: var(--pencil);
		}
		.unit:has(select:disabled) .unit-face {
			opacity: 0.55;
		}
		.name :global(.suggest input) {
			padding-inline: 0.5rem;
		}
		.row {
			padding: 0.3rem 0;
		}
		.row.nested {
			padding-top: 0.25rem;
		}
	}
	/* The fractions' line, in the flow: a phone's on the row she works on, a wide screen's while the quantity has the focus. */
	.fracs {
		display: none;
	}
	@media (min-width: 37.51rem) {
		.fracs.on {
			display: flex;
			gap: 2px;
			margin-top: 0.25rem;
		}
		.fracs.on button {
			min-width: 40px;
			min-height: 40px;
			border: 1px solid var(--edge);
			border-radius: var(--radius);
			background: var(--card);
			color: var(--ink);
			font-family: var(--serif);
			font-size: var(--step-1);
			cursor: pointer;
		}
		.fracs.on button:hover {
			border-color: var(--ink);
		}
	}
	@media (max-width: 37.5rem) {
		.fracs {
			display: flex;
			gap: 2px;
			margin-top: 0.3rem;
		}
		.fracs button {
			min-width: 44px;
			min-height: 44px;
			border: 1px solid var(--edge);
			border-radius: var(--radius);
			background: var(--card);
			color: var(--ink);
			font-family: var(--serif);
			font-size: var(--step-1);
			cursor: pointer;
		}
	}
	/* The folded line: shown on a phone only (below), the editor's fields hidden while it is. */
	.line-view {
		display: none;
	}
	@media (max-width: 37.5rem) {
		.row.compact {
			padding: 0;
		}
		.row.compact .main {
			grid-template-areas: 'line line line tools';
		}
		/* QtyInput's box is another component's element: matched globally, under this row. */
		.row.compact .main > :global(:not(.line-view):not(.tools)) {
			display: none;
		}
		.line-view {
			grid-area: line;
			position: relative;
			display: block;
			min-width: 0;
			min-height: 44px;
			padding: 0.6rem 0.15rem 0.55rem;
			border: 0;
			background: none;
			color: var(--ink);
			font: inherit;
			line-height: 1.35;
			text-align: left;
			cursor: pointer;
		}
		.line-view .amt {
			font-weight: 700;
			font-variant-numeric: tabular-nums;
		}
		.line-view .more {
			color: var(--ink-soft);
			font-size: var(--step--1);
		}
	}
	/* The name. */
	.name {
		min-width: 0;
	}
	/*
	 * What the details hold, under the name: a line that reads as part of the
	 * ingredient (« ou ½ lb · haché »), in ink, a dotted underline and ✎ saying
	 * it is editable — not a grey label. A touch opens the details in place.
	 */
	.sum {
		justify-self: start;
		max-width: 100%;
		min-height: 1.6rem;
		margin-top: 0.1rem;
		padding: 0 0.15rem;
		border: 0;
		background: none;
		color: var(--ink);
		font-size: var(--step--1);
		font-style: italic;
		line-height: 1.3;
		text-align: left;
		text-decoration: underline dotted;
		text-decoration-color: color-mix(in srgb, var(--ink-soft) 70%, transparent);
		text-underline-offset: 0.25em;
		cursor: text;
	}
	.sum .pen {
		margin-left: 0.4rem;
		font-style: normal;
		color: var(--ink-soft);
		text-decoration: none;
		display: inline-block;
	}
	.sum:hover,
	.sum:hover .pen {
		color: var(--link);
	}
	/* None yet: « + précision », quiet; on a wide screen beside ⋯ while the pointer or the focus is on the row (its room always kept). */
	.prec {
		align-self: center;
		justify-self: end;
		min-height: 2.5rem;
		padding: 0 0.35rem;
		border: 0;
		border-radius: var(--radius);
		background: none;
		color: var(--link);
		font-size: var(--step--1);
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
		opacity: 0;
		pointer-events: none;
	}
	.row:hover .prec,
	.row:focus-within .prec,
	.prec.active {
		opacity: 1;
		pointer-events: auto;
	}
	.prec:hover {
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	/* A phone: under the row she works on only (the others keep one line). */
	@media (max-width: 37.5rem) {
		.prec {
			display: none;
			justify-self: start;
		}
		.prec.active {
			display: inline-flex;
			align-items: center;
		}
	}
	/* A finger, or a phone's width (a pointer emulated there measured 89 × 26): 44 px to touch. */
	@media (pointer: coarse), (max-width: 37.5rem) {
		.sum,
		.prec {
			min-height: 44px;
			margin-block: -0.4rem -0.3rem;
		}
	}
	select {
		min-height: 44px;
		min-width: 0;
		width: 100%;
	}
	select[aria-invalid='true'] {
		border-color: var(--danger);
	}
	/* No unit chosen: « sans unité » reads as a hint, like a placeholder (grey, upright). */
	select.empty {
		color: var(--pencil);
	}
	select.empty option {
		color: var(--ink);
	}
	.tools {
		display: flex;
		justify-content: flex-end;
	}
	.tools :global(summary) {
		min-width: 44px;
		min-height: 44px;
		justify-content: center;
		padding-inline: 0;
		border-color: transparent;
		background: none;
		color: var(--ink-soft);
	}
	.tools :global(summary:hover) {
		border-color: var(--edge);
		color: var(--ink);
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
		border-color: var(--edge);
		color: var(--ink);
	}
	/* « ✓ relié »: said on the row being typed in, not under every row of the list (UI round 2: ten identical confirmations were noise). */
	.linked {
		display: none;
		margin-top: 0.15rem;
		font-size: var(--step--1);
		color: var(--ok);
		font-weight: 600;
	}
	.row:focus-within > .linked {
		display: inline-block;
	}
	.err {
		margin: 0.2rem 0 0;
		font-size: var(--step--1);
		color: var(--danger);
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
	.details {
		margin: 0.35rem 0 0.4rem;
		padding: 0.5rem 0 0.25rem 0.75rem;
		border-left: 2px solid var(--edge);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
		gap: 0.5rem 0.75rem;
		margin-bottom: 0.25rem;
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
	.field.max :global(.qty) {
		max-width: 7rem;
	}
	small {
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.checks {
		display: flex;
		flex-wrap: wrap;
		gap: 0 1.25rem;
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
	.foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.75rem;
		margin-top: 0.35rem;
	}
	select.add {
		width: auto;
		max-width: 100%;
		border-style: dashed;
		color: var(--link);
		font-weight: 600;
		background-color: var(--card);
	}
	.less {
		margin-left: auto;
	}
</style>
