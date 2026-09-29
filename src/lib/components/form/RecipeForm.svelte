<script lang="ts" module>
	import type { FamilyOption, FormRecipe } from '$lib/form';
	import type { TagVocab } from './TagPicker.svelte';
	import type { CheckWords } from '$lib/vault/words';
	import type { Unit } from '$lib/vault/types';

	export interface FormPageData {
		form: FormRecipe;
		/** An edit: the recipe's slug and the hash of the file the form was opened from. */
		slug: string | null;
		hash: string | null;
		units: Unit[];
		families: FamilyOption[];
		tagVocab: TagVocab;
		tagLabels?: Record<string, string>;
		words?: CheckWords;
		/** The recipe's photo (an edit). */
		photo: { thumb: string | null } | null;
	}
</script>

<script lang="ts">
	// The recipe form (plan 04, Phases 4–5): a new recipe (/nouvelle) or an
	// edit (/r/[slug]/modifier). She never sees Markdown, YAML or marker
	// syntax; invalid states are prevented field by field and Save says what
	// is missing. One request saves; the toast offers "Annuler". The form state
	// is kept on the device while she types (Q17 A); a stale save shows both
	// versions side by side (Q18 A).
	import { onMount, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import ItemRow from './ItemRow.svelte';
	import Marks from './Marks.svelte';
	import DurationField from './DurationField.svelte';
	import FamilyPicker from './FamilyPicker.svelte';
	import TagPicker from './TagPicker.svelte';
	import StaleCompare from './StaleCompare.svelte';
	import Suggest, { type Option } from './Suggest.svelte';
	import { undoSave } from './undo';
	import { blockText, blocksImplicitSubmit, draftDiffers, invalidMessage, mergeBlocks, packDraft, reasonLine, unpackDraft, type DraftPair, type FormDraft } from './formui';
	import {
		addGroup,
		addItem,
		addStepRow,
		blockOn,
		blocks as blocksOf,
		clearDraft,
		draftKey,
		ensureSection,
		loadDraft,
		move,
		removeAt,
		restoreAt,
		saveDraft,
		showGroups,
		uncertainFields,
		type Block,
		type FormHint,
		type MethodSection,
		type TextKind,
		type TextSection
	} from '$lib/form';
	import { t, familyLabel, form as f } from '$lib/i18n/fr';
	import { formHintText } from '$lib/i18n/diagnostics';
	import { toast } from '$lib/toast.svelte';
	import { unitLabel } from '$lib/render/ingredient';
	import { SOURCE_TYPES, SEASONS } from '$lib/vault/vocab';
	import { slugify } from '$lib/vault/slug';

	let { data }: { data: FormPageData } = $props();

	const TEXT_KINDS: TextKind[] = ['notes', 'variants', 'alternatives'];
	const TAPS = [
		['difficulty', f.difficulty, f.difficultyLevels],
		['rating', f.rating, f.ratingLevels]
	] as const;
	const TIMES = [
		['prep', f.prepTime],
		['cook', f.cookTime],
		['rest', f.restTime],
		['total', f.totalTime]
	] as const;
	/** The form as she edits it: the three text sections always there (an empty one is not written). */
	function prepare(src: FormRecipe): FormRecipe {
		// A copy, never the proxy of a draft or a stale answer held in state.
		const copy = $state.snapshot(src) as FormRecipe;
		for (const k of TEXT_KINDS) ensureSection(copy, k);
		return copy;
	}

	// The page's data is read once: the form is hers from here on.
	const slug = untrack(() => data.slug);
	const key = draftKey(slug ?? undefined);
	let form = $state(prepare(untrack(() => data.form)));
	let base = $state(untrack(() => (data.slug && data.hash ? { slug: data.slug, hash: data.hash } : undefined)));
	let initial = untrack(() => $state.snapshot(form)) as FormRecipe;

	let newFamilyLabel = $state('');
	let pair = $state<DraftPair | null>(null);
	let hints = $state<FormHint[]>([]);
	let same = $state<{ slug: string; title: string; hash: string; family: string | null }[]>([]);
	let saving = $state(false);
	let message = $state<string | null>(null);
	let stale = $state<{ theirs: { form: FormRecipe; hash: string } } | null>(null);
	let foundDraft = $state<FormDraft | null>(null);
	let decided = $state(false);
	let photoFile = $state<File | null>(null);
	let photoPreview = $state<string | null>(null);
	let photoRemove = $state(false);
	let ovenRange = $state(false);
	const qtyInputs: Record<string, HTMLInputElement | undefined> = $state({});

	/** What the vault check (the live check, a refused save) found that the browser cannot: E213, E103. */
	let serverBlocks = $state<Block[]>([]);
	const blocks: Block[] = $derived(mergeBlocks(blocksOf(form), serverBlocks));
	const uncertain = $derived(uncertainFields(form).length);
	const groupsShown = $derived(showGroups(form));
	const method = $derived(form.sections.find((s) => s.kind === 'method') as MethodSection | undefined);
	const textSection = (k: TextKind) => form.sections.find((s) => s.kind === k) as TextSection;
	const units = untrack(() => data.units);
	const unitName = (u: Unit) => (u === 'piece' ? f.piece : unitLabel(u, 1, 'fr'));
	const recipeBlock = (field: string) => blockOn(blocks, 'recipe', field);
	/** The French line under a field of the recipe itself (the first of `fields` blocked). */
	const recipeErr = (...fields: string[]) => blockText(fields.map(recipeBlock).find(Boolean));
	const rowErr = (id: string, field: string) => blockText(blockOn(blocks, id, field));
	const titleHints = $derived(hints.filter((h) => h.code === 'W503'));
	const sameOffer = $derived(same.filter((s) => s.slug !== pair?.slug)[0]);

	/** What keeps Save disabled, as short French lines, once each. */
	const reasons = $derived.by(() => {
		const out = new Set<string>();
		for (const b of blocks) out.add(reasonLine(b));
		if (pair && !pair.variant.trim()) out.add(f.blocks.variant);
		return [...out];
	});

	// ---------------------------------------------------------------- draft (Q17 A)

	onMount(() => {
		const d = loadDraft(localStorage, key) as FormDraft | undefined;
		if (d && draftDiffers(d, initial)) foundDraft = d;
		else decided = true;
	});

	function resumeDraft() {
		if (!foundDraft) return;
		form = prepare(foundDraft.form);
		// What she chose beside the form: a new family's label, the W608 pair.
		({ familyLabel: newFamilyLabel, pair } = unpackDraft(foundDraft));
		// The draft was typed over the version it was opened from: the stale guard compares with that one.
		if (base && foundDraft.hash) base.hash = foundDraft.hash;
		foundDraft = null;
		decided = true;
	}

	function discardDraft() {
		clearDraft(localStorage, key);
		foundDraft = null;
		decided = true;
	}

	// Until she answers "brouillon trouvé" the form is inert (nothing typed, nothing lost),
	// and the old draft is not overwritten. After a save, nothing is written again.
	let draftTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const snap = $state.snapshot(form) as FormRecipe;
		const extras = { hash: base?.hash, familyLabel: newFamilyLabel, pair: pair ? ($state.snapshot(pair) as DraftPair) : null };
		if (!decided) return;
		draftTimer = setTimeout(() => {
			if (!decided) return;
			const d = packDraft(snap, extras, Date.now());
			if (!draftDiffers(d, initial)) clearDraft(localStorage, key);
			else saveDraft(localStorage, key, d);
		}, 400);
		return () => clearTimeout(draftTimer);
	});

	// ---------------------------------------------------------------- live check (Q9 A)

	let checkTimer: ReturnType<typeof setTimeout> | undefined;
	let checkSeq = 0;
	$effect(() => {
		const snap = $state.snapshot(form) as FormRecipe;
		const b = base ? { ...base } : undefined;
		clearTimeout(checkTimer);
		if (!snap.title.trim()) {
			hints = [];
			same = [];
			serverBlocks = [];
			return;
		}
		checkTimer = setTimeout(async () => {
			const mine = ++checkSeq;
			try {
				const res = await fetch('/api/form/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ form: snap, base: b }) });
				if (!res.ok || mine !== checkSeq) return;
				const got = await res.json();
				if (mine !== checkSeq) return;
				hints = got.hints ?? [];
				same = got.same ?? [];
				serverBlocks = Array.isArray(got.errors) ? got.errors : [];
			} catch {
				/* offline: no hints, nothing blocks */
			}
		}, 700);
	});

	// ---------------------------------------------------------------- rows

	function removed(text: string, undo: () => void) {
		toast.show({ text, action: { label: f.undo, run: () => (undo(), toast.close()) } }, 8000);
	}

	async function focusQty(id: string) {
		await tick();
		qtyInputs[id]?.focus();
	}

	function addRow(gi: number, after?: number) {
		const it = addItem(form.groups[gi], after);
		focusQty(it.id);
	}

	function removeItem(gi: number, i: number) {
		const g = form.groups[gi];
		const r = removeAt(g.items, i);
		if (!r) return;
		if (!g.items.length && form.groups.length === 1) addItem(g);
		removed(f.removedItem, () => {
			if (g.items.length === 1 && !g.items[0].name.trim() && !g.items[0].qty.trim()) g.items.splice(0, 1);
			restoreAt(g.items, r);
		});
	}

	function removeGroup(gi: number) {
		const r = removeAt(form.groups, gi);
		if (!r) return;
		if (!form.groups.length) addGroup(form);
		removed(f.removedGroup, () => restoreAt(form.groups, r));
	}

	function removeStep(i: number) {
		const m = method;
		if (!m) return;
		const r = removeAt(m.rows, i);
		if (!r) return;
		removed(f.removedStep, () => restoreAt(m.rows, r));
	}

	const stepNumber = (i: number) => (method ? method.rows.slice(0, i + 1).filter((r) => r.type === 'step').length : 0);

	function grow(el: HTMLTextAreaElement) {
		const fit = () => {
			el.style.height = 'auto';
			el.style.height = `${el.scrollHeight + 2}px`;
		};
		fit();
		el.addEventListener('input', fit);
		return { destroy: () => el.removeEventListener('input', fit) };
	}

	// ---------------------------------------------------------------- family pair (W608, Q10 A)

	function makePair(other: { slug: string; title: string; hash: string; family: string | null }) {
		if (other.family) {
			// The other recipe is already in a family: this one joins it.
			form.family = other.family;
			newFamilyLabel = '';
			return;
		}
		form.family = slugify(form.title);
		newFamilyLabel = form.title.trim();
		pair = { slug: other.slug, hash: other.hash, title: other.title, variant: '' };
	}

	// ---------------------------------------------------------------- source

	async function authors(q: string): Promise<Option[]> {
		const res = await fetch(`/api/suggest?kind=author&q=${encodeURIComponent(q)}`);
		if (!res.ok) return [];
		const d = (await res.json()) as { items: string[] };
		return d.items.filter((a) => a !== q).map((a) => ({ value: a, label: a }));
	}

	// ---------------------------------------------------------------- photo

	function pickPhoto(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (file.size > 25 * 1024 * 1024) {
			message = t.photo.tooBig(25);
			return;
		}
		if (photoPreview) URL.revokeObjectURL(photoPreview);
		photoFile = file;
		photoPreview = URL.createObjectURL(file);
		photoRemove = false;
	}

	function dropPhoto() {
		if (photoPreview) URL.revokeObjectURL(photoPreview);
		photoFile = null;
		photoPreview = null;
	}

	/** After the recipe is saved: send the photo she chose, or remove the one she took off. The commit, if any. */
	async function photoStep(s: string, hash: string): Promise<{ commit?: string; error?: string }> {
		try {
			if (photoFile) {
				const body = new FormData();
				body.set('slug', s);
				body.set('hash', hash);
				body.set('photo', photoFile);
				const res = await fetch('/api/photo', { method: 'POST', body });
				const d = await res.json().catch(() => ({}));
				return res.ok ? { commit: d.commit } : { error: d.message ?? t.photo.failed };
			}
			if (photoRemove && data.photo) {
				const res = await fetch('/api/photo', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: s, hash }) });
				const d = await res.json().catch(() => ({}));
				return res.ok ? { commit: d.commit } : { error: d.message ?? t.photo.failed };
			}
		} catch {
			return { error: t.photo.offline };
		}
		return {};
	}

	// ---------------------------------------------------------------- save

	async function save() {
		if (saving || reasons.length) return;
		message = null;
		if (typeof navigator !== 'undefined' && !navigator.onLine) {
			message = f.offline;
			return;
		}
		saving = true;
		const snap = $state.snapshot(form) as FormRecipe;
		const body = {
			form: snap,
			...(base ? { base: { ...base } } : {}),
			...(newFamilyLabel && form.family ? { familyLabel: newFamilyLabel } : {}),
			...(pair && form.family ? { pair: { slug: pair.slug, hash: pair.hash, variant: pair.variant } } : {})
		};
		try {
			const res = await fetch('/api/form/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
			if (res.status === 401) {
				message = f.signedOut;
				return;
			}
			if (!res.ok) {
				message = f.failed;
				return;
			}
			const r = await res.json();
			switch (r.status) {
				case 'saved':
				case 'unchanged': {
					const commits: string[] = r.status === 'saved' && r.commit ? [r.commit] : [];
					const photo = await photoStep(r.slug, r.hash);
					if (photo.commit) commits.unshift(photo.commit);
					// Saved: no pending autosave may write the form back as a draft.
					decided = false;
					clearTimeout(draftTimer);
					clearDraft(localStorage, key);
					dropPhoto();
					await goto(`/r/${r.slug}`, { invalidateAll: true });
					if (photo.error) toast.show({ text: f.photoFailed(photo.error), error: true });
					else
						toast.show({
							text: commits.length ? f.saved : f.unchanged,
							...(commits.length ? { action: { label: f.undo, run: () => undoSave(r.slug, commits) } } : {})
						});
					return;
				}
				case 'stale':
					if (r.theirs) stale = { theirs: r.theirs };
					else message = f.staleGone;
					window.scrollTo({ top: 0 });
					return;
				case 'invalid':
					// Each field named on its row; nothing written.
					serverBlocks = Array.isArray(r.errors) ? r.errors : [];
					message = invalidMessage(serverBlocks);
					return;
				case 'refused':
					message = r.reason === 'pair' ? f.pairChanged : r.reason === 'gone' ? f.gone : f.broken;
					if (r.reason === 'pair') pair = null;
					return;
				default:
					message = f.failed;
			}
		} catch {
			message = f.offline;
		} finally {
			saving = false;
		}
	}

	function keepMine() {
		if (!stale || !base) return;
		base.hash = stale.theirs.hash;
		stale = null;
		save();
	}

	function takeTheirs() {
		if (!stale || !base) return;
		base.hash = stale.theirs.hash;
		form = prepare(stale.theirs.form);
		initial = $state.snapshot(form) as FormRecipe;
		newFamilyLabel = '';
		pair = null;
		clearDraft(localStorage, key);
		stale = null;
	}

	const when = (ms: number) => new Date(ms).toLocaleString('fr-CA', { dateStyle: 'medium', timeStyle: 'short' });
</script>

<!-- The keydown only stops implicit submission; it adds no interaction. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<form
	class="recipe-form"
	novalidate
	onsubmit={(e) => (e.preventDefault(), save())}
	onkeydown={(e) => {
		// Enter in a one-line field saves nothing: only Enregistrer saves.
		if (blocksImplicitSubmit(e.key, e.target as HTMLElement & { type?: string })) e.preventDefault();
	}}
>
	<h1>{slug ? f.editTitle : f.newTitle}</h1>

	{#if foundDraft}
		<div class="banner" role="status" data-testid="draft-banner">
			<p>{f.draftFound(when(foundDraft.at))}</p>
			<div class="acts">
				<button type="button" class="btn primary" onclick={resumeDraft}>{f.draftResume}</button>
				<button type="button" class="btn" onclick={discardDraft}>{slug ? f.draftDiscard : f.draftDiscardNew}</button>
			</div>
		</div>
	{/if}

	<div class="body" inert={!!foundDraft} data-testid="form-body">
	{#if stale}
		<StaleCompare mine={form} theirs={stale.theirs.form} onkeep={keepMine} ontake={takeTheirs} />
	{/if}

	{#if message}<p class="msg" role="alert" data-testid="form-message">{message}</p>{/if}

	<!-- Title and language -->
	<section class="card" aria-labelledby="s-title">
		<h2 id="s-title" class="visually-hidden">{f.title}</h2>
		<div class="field">
			<label for="title">{f.title} <span class="req">({f.required})</span></label>
			<input
				id="title"
				class="title-input"
				type="text"
				bind:value={form.title}
				placeholder={f.titlePlaceholder}
				data-testid="title"
				aria-invalid={(!!recipeBlock('title') && recipeBlock('title')?.reason !== 'required') || undefined}
			/>
			{#if recipeBlock('title') && recipeBlock('title')?.reason !== 'required'}<p class="err" data-testid="err-title">{recipeErr('title')}</p>{/if}
			<Marks owner={form} key="title" lang={form.lang} text={form.title} onpick={(a) => (form.title = a)} />
		</div>
		{#each titleHints as h (h.slug)}
			<p class="hint">{formHintText.W503({ value: h.value })} <a href="/r/{h.slug}" target="_blank" rel="noopener">{f.near}</a></p>
		{/each}
		{#if sameOffer && !form.family}
			<div class="hint" data-testid="same-title">
				<span>{formHintText.W608({ value: sameOffer.title })} <a href="/r/{sameOffer.slug}" target="_blank" rel="noopener">{f.near}</a></span>
				<button type="button" class="btn" onclick={() => makePair(sameOffer)}>{f.sameTitle}</button>
			</div>
		{/if}
		{#if pair}
			<div class="pair" data-testid="pair">
				<p>{f.pairNote(pair.title)}</p>
				<div class="field">
					<label for="pair-variant">{f.pairVariant(pair.title)} <span class="req">({f.required})</span></label>
					<input id="pair-variant" type="text" bind:value={pair.variant} />
				</div>
				<button
					type="button"
					class="btn quiet"
					onclick={() => {
						pair = null;
						form.family = '';
						form.variant = '';
						newFamilyLabel = '';
					}}>{f.pairCancel}</button
				>
			</div>
		{/if}
		<div class="field narrow">
			<label for="lang">{f.lang}</label>
			<select id="lang" bind:value={form.lang}>
				{#each Object.entries(f.langs) as [v, l] (v)}<option value={v}>{l}</option>{/each}
			</select>
		</div>
	</section>

	<!-- Ingredients -->
	<section class="card" aria-labelledby="s-ingr">
		<h2 id="s-ingr">{f.ingredients}</h2>
		{#each form.groups as g, gi (g.id)}
			<div class="group" class:named={groupsShown} data-testid="group">
				{#if groupsShown}
					<div class="group-head">
						<div class="field">
							<label for="g-{g.id}">{f.groupName}</label>
							<input id="g-{g.id}" type="text" bind:value={g.name} placeholder={f.groupPlaceholder} data-testid="group-name" aria-invalid={!!blockOn(blocks, g.id, 'name') || undefined} />
							{#if blockOn(blocks, g.id, 'name')}<p class="err">{rowErr(g.id, 'name')}</p>{/if}
							<Marks owner={g} key="name" lang={form.lang} text={g.name} onpick={(v) => (g.name = v)} />
						</div>
						<label class="check"><input type="checkbox" bind:checked={g.optional} /> {f.groupOptional}</label>
						<div class="tools">
							<button type="button" class="icon" aria-label="{f.moveUp} — {f.group} {gi + 1}" disabled={gi === 0} onclick={() => move(form.groups, gi, -1)}>↑</button>
							<button type="button" class="icon" aria-label="{f.moveDown} — {f.group} {gi + 1}" disabled={gi === form.groups.length - 1} onclick={() => move(form.groups, gi, 1)}>↓</button>
							<button type="button" class="icon" aria-label="{f.removeGroup} {gi + 1}" onclick={() => removeGroup(gi)}>✕</button>
						</div>
					</div>
					{#if blockOn(blocks, g.id, 'items')}<p class="err">{f.field.items}</p>{/if}
				{/if}
				{#each g.items as it, i (it.id)}
					<ItemRow
						item={it}
						lang={form.lang}
						{units}
						words={data.words}
						own={slug ?? ''}
						{blocks}
						{hints}
						label="{f.name} {i + 1}{groupsShown ? ` (${g.name || f.group + ' ' + (gi + 1)})` : ''}"
						first={i === 0}
						last={i === g.items.length - 1}
						onmove={(by) => move(g.items, i, by)}
						onremove={() => removeItem(gi, i)}
						onenter={() => addRow(gi, i)}
						bind:qtyInput={qtyInputs[it.id]}
					/>
				{/each}
				<button type="button" class="btn add" onclick={() => addRow(gi)} data-testid="add-item">+ {f.addItem}</button>
			</div>
		{/each}
		<button
			type="button"
			class="btn quiet"
			onclick={async () => {
				const g = addGroup(form);
				await tick();
				document.getElementById(`g-${g.id}`)?.focus();
			}}
			data-testid="add-group">+ {f.addGroup}</button
		>
	</section>

	<!-- Method -->
	{#if method}
		<section class="card" aria-labelledby="s-method">
			<h2 id="s-method">{f.method}</h2>
			<p class="help">{f.stepHelp}</p>
			<ol class="steps">
				{#each method.rows as r, i (r.id)}
					<li class="step" class:heading={r.type === 'heading'} data-testid="step-row">
						<label for="r-{r.id}" class="num">{r.type === 'heading' ? f.heading : r.type === 'text' ? f.text : stepNumber(i)}</label>
						<div class="step-body">
							{#if r.type === 'heading'}
								<input id="r-{r.id}" type="text" bind:value={r.text} placeholder={f.headingPlaceholder} data-testid="heading" />
							{:else}
								<textarea id="r-{r.id}" rows="2" bind:value={r.text} use:grow aria-label={r.type === 'step' ? f.step(stepNumber(i)) : f.text} data-testid="step"></textarea>
							{/if}
							{#if blockOn(blocks, r.id, 'text')}<p class="err" data-testid="err-step">{rowErr(r.id, 'text')}</p>{/if}
							<Marks owner={r} key="text" lang={form.lang} text={r.text} onpick={(v) => (r.text = v)} />
						</div>
						<div class="tools">
							<button type="button" class="icon" aria-label="{f.moveUp} — {f.step(i + 1)}" disabled={i === 0} onclick={() => move(method!.rows, i, -1)}>↑</button>
							<button type="button" class="icon" aria-label="{f.moveDown} — {f.step(i + 1)}" disabled={i === method.rows.length - 1} onclick={() => move(method!.rows, i, 1)}>↓</button>
							<button type="button" class="icon" aria-label="{f.remove} — {f.step(i + 1)}" onclick={() => removeStep(i)}>✕</button>
						</div>
					</li>
				{/each}
			</ol>
			{#if blockOn(blocks, method.id, 'steps')}<p class="err" data-testid="err-steps">{rowErr(method.id, 'steps')}</p>{/if}
			<div class="acts">
				<button
					type="button"
					class="btn add"
					onclick={async () => {
						const r = addStepRow(method!.rows);
						await tick();
						document.getElementById(`r-${r.id}`)?.focus();
					}}
					data-testid="add-step">+ {f.addStep}</button
				>
				<button
					type="button"
					class="btn quiet"
					onclick={async () => {
						const r = addStepRow(method!.rows, 'heading');
						await tick();
						document.getElementById(`r-${r.id}`)?.focus();
					}}>+ {f.addHeading}</button
				>
			</div>
		</section>
	{/if}

	<!-- Notes, variants, alternatives -->
	<section class="card" aria-labelledby="s-notes">
		<h2 id="s-notes" class="visually-hidden">{f.notes}</h2>
		{#each TEXT_KINDS as k (k)}
			{@const s = textSection(k)}
			<div class="field">
				<label for="t-{k}">{f[k]}</label>
				{#if k === 'notes'}<small class="help">{f.notesHelp}</small>{/if}
				<textarea id="t-{k}" rows="3" bind:value={s.text} use:grow data-testid="text-{k}"></textarea>
				{#if blockOn(blocks, s.id, 'text')}<p class="err">{rowErr(s.id, 'text')}</p>{/if}
				<Marks owner={s} key="text" lang={form.lang} text={s.text} onpick={(v) => (s.text = v)} />
			</div>
		{/each}
	</section>

	<!-- Photo -->
	<section class="card" aria-labelledby="s-photo">
		<h2 id="s-photo">{f.photo}</h2>
		<div class="photo">
			{#if photoPreview}
				<img src={photoPreview} alt="" />
			{:else if data.photo?.thumb && !photoRemove}
				<img src={data.photo.thumb} alt="" />
			{/if}
			<div class="photo-acts">
				{#if photoFile}
					<p>{f.photoPending(photoFile.name)}</p>
					<p class="help">{f.photoNotInDraft}</p>
					<button type="button" class="btn quiet" onclick={dropPhoto}>{f.photoCancel}</button>
				{:else if photoRemove}
					<p>{f.photoRemoved}</p>
					<button type="button" class="btn" onclick={() => (photoRemove = false)}>{f.photoKeep}</button>
				{:else}
					<label class="btn file">
						<input type="file" accept="image/*" onchange={pickPhoto} data-testid="photo-input" />
						{data.photo ? t.photo.replace : t.photo.add}
					</label>
					{#if data.photo}
						<button type="button" class="btn danger" onclick={() => (photoRemove = true)}>{t.photo.remove}</button>
					{:else}
						<small class="help">{t.photo.addHelp}</small>
					{/if}
				{/if}
			</div>
		</div>
	</section>

	<!-- Family, tags, seasons, difficulty, rating -->
	<section class="card" aria-labelledby="s-class">
		<h2 id="s-class" class="visually-hidden">{f.family}</h2>
		<FamilyPicker {form} families={data.families} {blocks} {hints} bind:newLabel={newFamilyLabel} />
		<div class="field">
			<h3>{f.tags}</h3>
			<small class="help">{f.tagsHelp}</small>
			<TagPicker bind:tags={form.tags} vocab={data.tagVocab} labels={data.tagLabels} />
		</div>
		<fieldset class="field toggles">
			<legend>{f.seasons}</legend>
			{#each SEASONS as s (s)}
				<label class="toggle">
					<input
						type="checkbox"
						checked={form.season.includes(s)}
						onchange={(e) => {
							if (e.currentTarget.checked) form.season = [...SEASONS].filter((x) => x === s || form.season.includes(x));
							else form.season = form.season.filter((x) => x !== s);
						}}
					/>
					<span>{t.season[s]}</span>
				</label>
			{/each}
		</fieldset>
		{#each TAPS as [k, name, levels] (k)}
			<fieldset class="field taps">
				<legend>{name}</legend>
				<div class="line">
					{#each [1, 2, 3, 4, 5] as n (n)}
						<button
							type="button"
							class="tap"
							class:on={(form[k] ?? 0) >= n}
							aria-pressed={form[k] === n}
							aria-label={levels[n - 1]}
							title={levels[n - 1]}
							onclick={() => (form[k] = form[k] === n ? null : n)}>{k === 'rating' ? '★' : n}</button
						>
					{/each}
					{#if form[k] !== null}<span class="level">{levels[(form[k] ?? 1) - 1]}</span>{/if}
				</div>
			</fieldset>
		{/each}
	</section>

	<!-- Source -->
	<section class="card" aria-labelledby="s-source">
		<h2 id="s-source">{f.source}</h2>
		<div class="grid">
			<div class="field">
				<label for="src-type">{f.sourceType}</label>
				<select id="src-type" bind:value={form.source.type}>
					<option value="">{f.sourceNone}</option>
					{#each SOURCE_TYPES as s (s)}<option value={s}>{t.source[s]}</option>{/each}
				</select>
			</div>
			<div class="field">
				<Suggest id="src-author" label={f.author} bind:value={form.source.author} load={authors} onpick={(o) => (form.source.author = o.value)} placeholder={f.authorPlaceholder} />
				{#if recipeBlock('source.author')}<p class="err">{recipeErr('source.author')}</p>{/if}
				<Marks owner={form} key="source.author" lang={form.lang} text={form.source.author} onpick={(v) => (form.source.author = v)} />
			</div>
			{#if form.source.type === 'book' || form.source.type === 'magazine' || form.source.title || form.source.page}
				<div class="field">
					<label for="src-title">{f.sourceTitle}</label>
					<input id="src-title" type="text" bind:value={form.source.title} aria-invalid={!!recipeBlock('source.title') || undefined} />
					{#if recipeBlock('source.title')}<p class="err">{recipeErr('source.title')}</p>{/if}
				</div>
				<div class="field narrow">
					<label for="src-page">{f.page}</label>
					<input id="src-page" type="text" inputmode="numeric" bind:value={form.source.page} aria-invalid={!!recipeBlock('source.page') || undefined} />
					{#if recipeBlock('source.page')}<p class="err">{recipeErr('source.page')}</p>{/if}
				</div>
			{/if}
			{#if form.source.type === 'website' || form.source.type === 'tv' || form.source.url}
				<div class="field wide">
					<label for="src-url">{f.url}</label>
					<input id="src-url" type="url" inputmode="url" autocapitalize="none" bind:value={form.source.url} placeholder="https://" aria-invalid={!!recipeBlock('source.url') || undefined} />
					{#if recipeBlock('source.url')}<p class="err">{recipeErr('source.url')}</p>{/if}
				</div>
			{/if}
			<div class="field wide">
				<label for="src-note">{f.sourceNote}</label>
				<input id="src-note" type="text" bind:value={form.source.note} aria-invalid={!!recipeBlock('source.note') || undefined} />
				{#if recipeBlock('source.note')}<p class="err">{recipeErr('source.note')}</p>{/if}
			</div>
		</div>
	</section>

	<!-- Times, oven, servings, yield -->
	<section class="card" aria-labelledby="s-times">
		<h2 id="s-times">{f.times}</h2>
		<div class="grid">
			{#each TIMES as [k, name] (k)}
				{@const b = recipeBlock(`times.${k}`)}
				<DurationField d={form.times[k]} id="time-{k}" label={name} error={b ? (b.reason === 'range' ? f.field.range : f.field.format) : undefined} />
			{/each}
		</div>

		<fieldset class="field oven">
			<legend>{f.oven}</legend>
			<div class="line">
				<label class="visually-hidden" for="oven-temp">{f.ovenTemp}</label>
				<input id="oven-temp" class="short" type="text" inputmode="numeric" bind:value={form.oven.temp} aria-invalid={!!recipeBlock('oven.temp') || undefined} data-testid="oven-temp" />
				{#if ovenRange || form.oven.tempMax}
					<span class="to">{f.range}</span>
					<label class="visually-hidden" for="oven-max">{f.ovenTemp} {f.range}</label>
					<input id="oven-max" class="short" type="text" inputmode="numeric" bind:value={form.oven.tempMax} aria-invalid={!!recipeBlock('oven.tempMax') || undefined} />
				{/if}
				<div class="seg" role="radiogroup" aria-label={f.ovenUnit}>
					{#each ['F', 'C'] as const as u (u)}
						<button type="button" role="radio" aria-checked={form.oven.unit === u} class:on={form.oven.unit === u} onclick={() => (form.oven.unit = u)}>°{u}</button>
					{/each}
				</div>
				{#if !ovenRange && !form.oven.tempMax && form.oven.temp}
					<button type="button" class="btn quiet" onclick={() => (ovenRange = true)}>{f.rangeAdd}</button>
				{/if}
			</div>
			{#if recipeBlock('oven.temp') || recipeBlock('oven.tempMax') || recipeBlock('oven.unit')}<p class="err" data-testid="err-oven">{recipeErr('oven.unit', 'oven.temp', 'oven.tempMax')}</p>{/if}
		</fieldset>

		<div class="grid">
			<fieldset class="field">
				<legend>{f.servings}</legend>
				<div class="line">
					<label class="visually-hidden" for="servings">{f.servings}</label>
					<input id="servings" class="short" type="text" inputmode="decimal" bind:value={form.servings} aria-invalid={!!recipeBlock('servings') || undefined} />
					<span class="to">{f.range}</span>
					<label class="visually-hidden" for="servings-max">{f.servings} {f.range}</label>
					<input id="servings-max" class="short" type="text" inputmode="decimal" bind:value={form.servingsMax} aria-invalid={!!recipeBlock('servingsMax') || undefined} />
				</div>
				{#if recipeBlock('servings') || recipeBlock('servingsMax')}<p class="err" data-testid="err-servings">{recipeErr('servings', 'servingsMax')}</p>{/if}
			</fieldset>
			<div class="field">
				<label for="servings-note">{f.servingsNote}</label>
				<input id="servings-note" type="text" bind:value={form.servingsNote} placeholder={f.servingsNotePlaceholder} aria-invalid={!!recipeBlock('servingsNote') || undefined} />
				{#if recipeBlock('servingsNote')}<p class="err">{recipeErr('servingsNote')}</p>{/if}
			</div>
			<div class="field">
				<label for="yield">{f.yield}</label>
				{#if form.yield.kind === 'amount'}
					<div class="line">
						<input class="short" type="text" inputmode="decimal" bind:value={form.yield.qty} aria-label={f.yieldAmount} aria-invalid={!!(recipeBlock('yield.qty') || recipeBlock('yield.qtyMax')) || undefined} />
						<select bind:value={form.yield.unit} aria-label={f.unit} aria-invalid={!!recipeBlock('yield.unit') || undefined}>
							<option value="">{f.noUnit}</option>
							{#each units as u (u)}<option value={u}>{unitName(u)}</option>{/each}
						</select>
						<input id="yield" type="text" bind:value={form.yield.note} />
					</div>
				{:else}
					<input
						id="yield"
						type="text"
						value={form.yield.text}
						oninput={(e) => {
							form.yield.text = e.currentTarget.value;
							form.yield.kind = e.currentTarget.value.trim() ? 'text' : 'none';
						}}
						placeholder={f.yieldPlaceholder}
					/>
				{/if}
				{#if recipeErr('yield.qty', 'yield.unit', 'yield.qtyMax', 'yield.text', 'yield.note', 'yield')}<p class="err" data-testid="err-yield">{recipeErr('yield.qty', 'yield.unit', 'yield.qtyMax', 'yield.text', 'yield.note', 'yield')}</p>{/if}
			</div>
		</div>
	</section>

	<!-- Save -->
	<div class="savebar" data-testid="savebar">
		<div class="why" aria-live="polite">
			{#if reasons.length}
				<span>{f.toComplete}</span>
				<ul>
					{#each reasons as r (r)}<li>{r}</li>{/each}
				</ul>
			{:else if uncertain}
				<span class="soft">{f.uncertainLeft(uncertain)}</span>
			{/if}
		</div>
		<div class="acts">
			<a class="btn quiet" href={slug ? `/r/${slug}` : '/'}>{f.cancel}</a>
			<button type="submit" class="btn primary" disabled={!!reasons.length || saving} aria-busy={saving} data-testid="save">{saving ? f.saving : f.save}</button>
		</div>
	</div>
	</div>
</form>

<style>
	.recipe-form {
		max-width: 50rem;
		margin: 0 auto;
		padding-bottom: 6rem;
	}
	h1 {
		font-size: var(--step-3);
		margin-bottom: 0.75rem;
	}
	h2 {
		font-size: var(--step-2);
		margin-bottom: 0.5rem;
	}
	h3 {
		font-size: var(--step-1);
		margin: 0.75rem 0 0.2rem;
	}
	/* Each part of the recipe on its own index card: the red rule under its head, blue lines under the rows. */
	.card {
		background: var(--card);
		border: 1px solid var(--line);
		border-top: 3px solid var(--rule-red);
		border-radius: var(--radius);
		padding: 0.9rem 1rem 1rem;
		margin-bottom: 1rem;
		box-shadow: 0 1px 0 var(--line);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		margin-bottom: 0.6rem;
		min-width: 0;
		border: 0;
		padding: 0;
	}
	.field.narrow {
		max-width: 14rem;
	}
	.field > label,
	legend {
		font-size: var(--step--1);
		font-weight: 600;
		color: var(--ink-soft);
		padding: 0;
	}
	.req {
		font-weight: 400;
	}
	input[type='text'],
	input[type='url'],
	select,
	textarea {
		min-height: 44px;
		width: 100%;
	}
	input[aria-invalid='true'] {
		border-color: var(--rule-red);
	}
	.title-input {
		font-family: var(--serif);
		font-size: var(--step-2);
		font-weight: 700;
	}
	textarea {
		resize: vertical;
		line-height: 1.45;
	}
	.help,
	small.help {
		font-size: var(--step--1);
		color: var(--ink-soft);
		margin: 0 0 0.3rem;
	}
	.err {
		margin: 0.2rem 0 0;
		font-size: var(--step--1);
		color: var(--rule-red);
	}
	.hint {
		margin: 0 0 0.6rem;
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
	.pair {
		padding: 0.5rem 0.75rem;
		margin-bottom: 0.6rem;
		border: 1px dashed var(--link);
		border-radius: var(--radius);
	}
	.pair p {
		margin: 0 0 0.4rem;
	}
	.banner {
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
		background: #fffbe0;
		border: 1px solid var(--highlight);
		border-radius: var(--radius);
	}
	.body[inert] {
		opacity: 0.55;
	}
	.banner p {
		margin: 0 0 0.5rem;
	}
	.msg {
		padding: 0.6rem 0.9rem;
		margin: 0 0 1rem;
		border-left: 4px solid var(--rule-red);
		background: var(--card);
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	.acts .btn,
	.btn.add,
	.btn.quiet {
		min-height: 44px;
	}
	.btn.add {
		margin-top: 0.5rem;
	}
	.group.named {
		margin-bottom: 1rem;
		padding-top: 0.5rem;
		border-top: 1px dashed var(--line);
	}
	.group.named:first-child {
		border-top: 0;
	}
	.group-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.25rem 0.75rem;
	}
	.group-head .field {
		flex: 1 1 14rem;
		margin-bottom: 0;
	}
	.check,
	.toggle {
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
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.step {
		display: grid;
		grid-template-columns: 2.2rem minmax(0, 1fr) auto;
		gap: 0.4rem;
		align-items: start;
		padding: 0.4rem 0;
		border-bottom: 1px solid var(--rule-blue);
	}
	.num {
		font-family: var(--serif);
		font-size: var(--step-1);
		font-weight: 700;
		color: var(--rule-red);
		text-align: right;
		padding-top: 0.45rem;
	}
	.step.heading .num,
	.step:not(.heading) .num:not(:empty) {
		font-size: var(--step-0);
	}
	.step.heading .num {
		grid-column: 1 / 2;
		font-size: var(--step--1);
		color: var(--ink-soft);
		writing-mode: horizontal-tb;
		text-align: left;
		word-break: break-word;
	}
	.step.heading input {
		font-family: var(--serif);
		font-weight: 700;
	}
	@media (max-width: 34rem) {
		.step {
			grid-template-columns: 1.6rem minmax(0, 1fr);
		}
		.step .tools {
			grid-column: 2;
			justify-content: flex-end;
		}
		.step.heading .num {
			grid-column: 1 / 3;
		}
	}
	.photo {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
	}
	.photo img {
		width: 8rem;
		height: 8rem;
		object-fit: cover;
		border-radius: var(--radius);
		border: 1px solid var(--line);
	}
	.photo-acts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 0.75rem;
		align-items: center;
	}
	.photo-acts p {
		margin: 0;
		flex-basis: 100%;
	}
	.btn.file {
		position: relative;
		min-height: 44px;
	}
	.btn.file input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}
	.btn.file:focus-within {
		outline: 3px solid var(--focus);
		outline-offset: 2px;
	}
	.toggles {
		flex-direction: row;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.75rem;
	}
	.toggles legend {
		width: 100%;
		margin-bottom: 0.3rem;
	}
	.toggle input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}
	.toggle span {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 1rem;
		border: 1.5px solid var(--ink);
		border-radius: 999px;
		background: var(--card);
	}
	.toggle input:checked + span {
		background: var(--ink);
		color: #fff;
	}
	.toggle input:focus-visible + span {
		outline: 3px solid var(--focus);
		outline-offset: 2px;
	}
	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
	}
	.taps {
		margin-top: 0.5rem;
	}
	.tap {
		min-width: 44px;
		min-height: 44px;
		border: 1.5px solid var(--ink);
		border-radius: var(--radius);
		background: var(--card);
		font-weight: 700;
		cursor: pointer;
	}
	.tap.on {
		background: var(--ink);
		color: #fff;
	}
	.level {
		font-size: var(--step--1);
		color: var(--ink-soft);
		margin-left: 0.3rem;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 0.25rem 1rem;
	}
	.field.wide {
		grid-column: 1 / -1;
	}
	input.short {
		width: 5rem;
		text-align: right;
	}
	.line select {
		width: auto;
	}
	.to {
		font-style: italic;
		color: var(--ink-soft);
	}
	.oven {
		margin-top: 0.5rem;
	}
	.seg {
		display: inline-flex;
		border: 1.5px solid var(--ink);
		border-radius: var(--radius);
		overflow: hidden;
	}
	.seg button {
		min-width: 48px;
		min-height: 44px;
		border: 0;
		background: var(--card);
		font-weight: 700;
		cursor: pointer;
	}
	.seg button.on {
		background: var(--ink);
		color: #fff;
	}
	/* Save stays in reach at the bottom of the screen, with what is missing. */
	.savebar {
		position: sticky;
		bottom: 0;
		z-index: 10;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		padding: 0.6rem 1rem;
		margin: 0 -1rem;
		background: var(--card);
		border-top: 3px solid var(--rule-red);
		box-shadow: 0 -4px 16px rgba(28, 42, 66, 0.08);
	}
	.why {
		font-size: var(--step--1);
		color: var(--ink-soft);
		flex: 1 1 14rem;
	}
	.why ul {
		display: inline;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.why li {
		display: inline;
	}
	.why li + li::before {
		content: ' ; ';
	}
	.why span {
		font-weight: 600;
		margin-right: 0.3rem;
	}
	.why .soft {
		font-weight: 400;
		color: var(--highlight-ink);
		background: var(--highlight);
		padding: 0 0.3rem;
	}
	.savebar .btn.primary {
		min-width: 9rem;
		justify-content: center;
	}
</style>
