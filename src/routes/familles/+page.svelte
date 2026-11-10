<script lang="ts">
	import PageHead from '$lib/components/PageHead.svelte';
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { tick } from 'svelte';
	import { t } from '$lib/i18n';
	import { fromLabel, variantPrefill, variantShown } from '$lib/form';
	import { formatSeconds } from '$lib/render/duration';
	import { locale } from '$lib/prefs';
	import { tagLabel } from '$lib/i18n';
	import { fold } from '$lib/vault/normalize';
	import { slugify } from '$lib/vault/slug';
	import Suggest, { type Option } from '$lib/components/form/Suggest.svelte';
	import { post, type Settled } from '$lib/settle.svelte';
	import { page } from '$app/state';
	import { toast } from '$lib/toast.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const s = t.families;
	/** A group of one recipe is the owner's upkeep (« à compléter »): a family account sees only groups of two or more. */
	const owner = $derived(!!data.user?.markdown);
	const listed = $derived(owner ? data.families : data.families.filter((f) => f.count > 1));

	// « Grouper avec… » (?grouper=<slug>, from a recipe's ⋯ menu): a group to
	// join, or another recipe to make one with; then the group's page, the
	// toast with « Annuler » on it.
	let query = $state('');
	let target = $state<{ kind: 'family'; slug: string; name: string } | { kind: 'recipe'; slug: string; title: string; familyName: string | null } | null>(null);
	let variant = $state('');
	let otherVariant = $state('');
	/** Where the other recipe is from: tells two of one title apart in its field's label. */
	let otherFrom = $state('');
	let groupName = $state('');
	/** How like the recipe being grouped (server: duplicates.ts groupingScores), by option value: what the search ranks by. */
	const score = (value: string) => data.scores[value] ?? 0;
	const byScore = <T extends { value: string }>(xs: T[]) => xs.map((x, i) => [x, i] as const).sort((a, b) => score(b[0].value) - score(a[0].value) || a[1] - b[1]).map(([x]) => x);
	function findTargets(q: string): Option[] {
		const g = data.grouping;
		if (!g) return [];
		const key = fold(q).trim();
		const slugKey = slugify(q);
		// A group by its name, or by its address (a group named after an English title is still « pain aux bananes »); the likest first.
		const fams = byScore(
			data.families
				.filter((f) => f.slug !== g.family && (!key || fold(f.name).includes(key) || (!!slugKey && f.slug.includes(slugKey))))
				.map((f) => ({ value: `f:${f.slug}`, label: f.name, meta: s.groupIsFamily(f.count) }))
		).slice(0, 5);
		const found = key ? byScore(data.recipes.filter((r) => fold(r.title).includes(key)).map((r) => ({ ...r, value: `r:${r.slug}` }))).slice(0, 8) : [];
		// Two of one title: who each is from (or its place in the list), never its slug.
		const recipes = found.map((r) => {
			const twins = found.filter((x) => x.title === r.title);
			const who = twins.length > 1 ? r.source || fromLabel(r.origin) || r.slug : '';
			return { value: `r:${r.slug}`, label: r.title, meta: who ? `${s.groupIsRecipe} · ${who}` : s.groupIsRecipe };
		});
		// Groups and recipes in one order, the likest first (a group first on a tie).
		return byScore([...fams, ...recipes]);
	}
	/** « Suggestion : Pâté chinois · 3 variantes · Grouper »: the likest group or recipe, before she types. */
	async function pickSuggestion() {
		const x = data.suggestion;
		if (!x) return;
		pickTarget({ value: x.value, label: x.label });
		await tick();
		const field = [...document.querySelectorAll<HTMLInputElement>('.grouper form input[type="text"]')];
		(field.find((f) => !f.value) ?? field[0])?.focus();
	}

	// « Renommer » on a group's line (the owner): her words for its name, in vocab/families.yaml.
	let renaming = $state<string | null>(null);
	let renameValue = $state('');
	async function startRename(f: { slug: string; name: string; label?: string | null }) {
		renaming = f.slug;
		renameValue = f.label ?? f.name;
		await tick();
		document.getElementById(`rename-${f.slug}`)?.focus();
	}
	const renamed: SubmitFunction = () => async ({ result }) => {
		const d = (result.type === 'success' || result.type === 'failure' ? result.data : undefined) as { ok?: boolean; message?: string } | undefined;
		if (result.type === 'success' && d?.ok) {
			const slug = renaming;
			renaming = null;
			await invalidateAll();
			toast.show({ text: d.message ?? '' }, 4000);
			await tick();
			if (slug) document.getElementById(`rename-btn-${slug}`)?.focus();
		} else toast.show({ text: d?.message ?? t.app.undoFailed, error: true });
	};
	function pickTarget(o: Option) {
		const g = data.grouping!;
		query = o.label;
		if (o.value.startsWith('f:')) {
			target = { kind: 'family', slug: o.value.slice(2), name: o.label };
			// Who it is from when that tells it apart, else empty (examples in the placeholder).
			variant = g.variant ? variantShown(g.variant, g.origin) : variantPrefill(g.origin);
		} else {
			const other = data.recipes.find((r) => r.slug === o.value.slice(2));
			// The group one of them is in (this recipe's first, as the server does), else a new one after the shorter title.
			const joins = g.familyName ?? other?.familyName ?? null;
			target = { kind: 'recipe', slug: o.value.slice(2), title: o.label, familyName: joins };
			groupName = joins ?? [g.title, o.label].sort((a, b) => a.length - b.length)[0];
			// Each keeps the variant it has in the group it stays in; else who it is from when the two differ; else empty.
			const into = g.family ?? other?.family ?? null;
			variant = (g.family && g.variant && variantShown(g.variant, g.origin)) || variantPrefill(g.origin, [other?.origin]);
			otherVariant = (other?.family && other.family === into && other.variant && variantShown(other.variant, other.origin)) || variantPrefill(other?.origin, [g.origin]);
			otherFrom = other ? other.source || fromLabel(other.origin) || other.slug : '';
		}
	}
	/** « 4 ingrédients en commun sur 9 », and whether that is few (server: SHARED_LOW): said before « Grouper ». */
	const shared = $derived.by(() => {
		const o = data.overlap;
		if (!o || !o.of || !target) return null;
		const n = o.shared[`${target.kind === 'family' ? 'f' : 'r'}:${target.slug}`] ?? 0;
		return { text: s.shared(n, o.of), few: n / o.of < o.low };
	});
	/** « 45 min–1 h 10 », or one time when they all take it. */
	const timeSpan = (a: number | null, b: number | null) =>
		!a || !b ? '' : a === b ? formatSeconds(a, locale()) : `${formatSeconds(a, locale())}–${formatSeconds(b, locale())}`;
	const grouped: SubmitFunction = () => async ({ result, update }) => {
		if (result.type === 'success' && (result.data as Partial<Settled> & { family?: string })?.ok) {
			const d = result.data as unknown as Settled & { family: string };
			const at = `/famille/${d.family}`;
			await goto(at);
			const undo = d.undo;
			toast.show({ text: d.message, ...(undo ? { action: { label: t.app.undo, run: () => ungroup(undo, at) } } : {}) });
		} else if (result.type === 'failure') toast.show({ text: String((result.data as { message?: string })?.message ?? ''), error: true });
		else await update({ reset: false });
	};
	/**
	 * The toast's « Annuler » (usability round 5: the group page kept showing
	 * the recipe until a reload): the group page reloads without it and says
	 * « Groupe défait »; a group the grouping made is gone, so its page goes to
	 * the recipe.
	 */
	async function ungroup(fields: Record<string, string | string[]>, at: string) {
		const r = await post('/familles?/undo', fields);
		const x = (r.type === 'success' || r.type === 'failure' ? r.data : undefined) as { ok?: boolean; message?: string; left?: boolean; slug?: string } | undefined;
		if (r.type !== 'success' || !x?.ok) {
			toast.show({ text: x?.message ?? t.app.undoFailed, error: true });
			return;
		}
		const grouped = String(fields.grouped ?? fields.slug);
		if (page.url.pathname === at && !x.left) await goto(`/r/${grouped}`, { replaceState: true });
		else await invalidateAll();
		toast.show({ text: x.message ?? t.app.undone }, 4000);
	}
</script>

<svelte:head><title>{s.title} — {t.app.name}</title></svelte:head>

<PageHead title={s.title} count={s.count(listed.length)} intro={s.intro} />

{#snippet overlapLine()}
	{#if shared}
		<p class="shared" data-testid="group-overlap">{shared.text}</p>
		{#if shared.few}<p class="few" role="note" data-testid="group-few">{s.fewShared}</p>{/if}
	{/if}
{/snippet}

{#if data.grouping}
	{@const g = data.grouping}
	<section class="grouper" aria-labelledby="grouper-title" data-testid="grouper">
		<h2 id="grouper-title">{s.groupTitle(g.title)}</h2>
		<p class="help">{s.groupHelp}</p>
		{#if form?.message}<p class="flash" class:error={!form.ok} role="status">{form.message}</p>{/if}
		{#if data.suggestion && !target}
			{@const x = data.suggestion}
			<p class="suggestion" data-testid="group-suggestion">
				<span>{s.suggestion} <strong>{x.label}</strong>{' · '}{x.count ? s.variants(x.count) : s.groupIsRecipe}</span>
				<button class="btn" type="button" onclick={pickSuggestion} aria-label="{s.suggestionPick} : {x.label}">{s.suggestionPick}</button>
			</p>
		{/if}
		<Suggest id="group-search" label={s.groupSearch} bind:value={query} load={findTargets} onpick={pickTarget} testid="group-search" />
		{#if target?.kind === 'family'}
			<form method="POST" action="?/join" use:enhance={grouped}>
				<input type="hidden" name="slug" value={g.slug} />
				<input type="hidden" name="hash" value={g.hash} />
				<input type="hidden" name="family" value={target.slug} />
				<p class="join">{t.duplicates.groupJoin(target.name)}</p>
				{@render overlapLine()}
				<label for="group-variant">{t.duplicates.variant(g.title)}</label>
				<input id="group-variant" name="variant" type="text" required placeholder={t.duplicates.variantPlaceholder} bind:value={variant} />
				<div class="row">
					<button class="btn primary" type="submit">{s.groupSave}</button>
					<a class="btn" href="/r/{g.slug}">{s.groupCancel}</a>
				</div>
			</form>
		{:else if target?.kind === 'recipe'}
			<form method="POST" action="?/pair" use:enhance={grouped}>
				<input type="hidden" name="slug" value={g.slug} />
				<input type="hidden" name="hash" value={g.hash} />
				<input type="hidden" name="other" value={target.slug} />
				{#if target.familyName}
					<p class="join">{t.duplicates.groupJoin(target.familyName)}</p>
				{:else}
					<label for="group-name">{t.duplicates.groupName}</label>
					<input id="group-name" name="label" type="text" required maxlength={data.labelMax} bind:value={groupName} />
				{/if}
				{@render overlapLine()}
				<label for="group-variant">{t.duplicates.variant(g.title)}</label>
				<input id="group-variant" name="variant" type="text" required placeholder={t.duplicates.variantPlaceholder} bind:value={variant} />
				<label for="group-other">{t.duplicates.variant(target.title === g.title ? `${target.title} — ${otherFrom}` : target.title)}</label>
				<input id="group-other" name="otherVariant" type="text" required placeholder={t.duplicates.variantPlaceholder} bind:value={otherVariant} />
				<div class="row">
					<button class="btn primary" type="submit">{s.groupSave}</button>
					<a class="btn" href="/r/{g.slug}">{s.groupCancel}</a>
				</div>
			</form>
		{/if}
	</section>
{/if}

{#if listed.length}
	<ul class="list">
		{#each listed as f (f.slug)}
			<li class:has-rename={owner}>
				<!-- A group of one recipe is waiting for its others: said so, it stays in its place (one may be on the way). -->
				<!-- « 3 variantes · 45 min–1 h 10 · Dessert », then what tells them apart (« de Tante Aline · avec aneth »). -->
				<a href="/famille/{f.slug}" title={f.count === 1 ? s.toCompleteHelp : undefined}
					><span class="name">{f.name}</span>
					<span class="n"
						>{[s.variants(f.count), timeSpan(f.minTime, f.maxTime), f.course ? tagLabel(f.course, data.tagLabels?.[f.course]) : ''].filter(Boolean).join(' · ')}{#if f.count === 1}<span
								class="todo">{` · ${s.toComplete} : ${s.toCompleteWhat}`}</span
							>{/if}</span
					>
					{#if f.labels.length}<span class="labels">{f.labels.join(' · ')}</span>{/if}</a
				>
				{#if owner}
					{#if renaming === f.slug}
						<form class="rename" method="POST" action="?/label" use:enhance={renamed}>
							<input type="hidden" name="family" value={f.slug} />
							<input type="hidden" name="hash" value={data.labelsHash} />
							<label class="visually-hidden" for="rename-{f.slug}">{s.renameLabel(f.name)}</label>
							<input
								id="rename-{f.slug}"
								name="label"
								type="text"
								maxlength={data.labelMax}
								bind:value={renameValue}
								onkeydown={(e) => {
									if (e.key === 'Escape') {
										renaming = null;
										tick().then(() => document.getElementById(`rename-btn-${f.slug}`)?.focus());
									}
								}}
							/>
							<button class="btn primary" type="submit">{s.labelSave}</button>
							<button class="btn" type="button" onclick={() => (renaming = null)}>{s.groupCancel}</button>
						</form>
					{:else}
						<button class="rename-btn" id="rename-btn-{f.slug}" type="button" title={s.renameTitle(f.name)} aria-label={s.renameTitle(f.name)} onclick={() => startRename(f)}
							>{s.renameShort}</button
						>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>
{:else}
	<p class="intro">{s.empty}</p>
{/if}

<style>
	.intro {
		color: var(--ink-soft);
		font-family: var(--serif);
		font-size: var(--step-1);
		margin: 0.25rem 0 1.25rem;
	}
	.grouper {
		max-width: 40rem;
		margin: 0 0 1.5rem;
		padding: 0.9rem 1rem 1rem;
		background: var(--card);
		border: 1px solid var(--edge);
		border-radius: var(--radius);
		display: grid;
		gap: 0.4rem;
	}
	.grouper h2 {
		font-size: var(--step-1);
		margin: 0;
	}
	.grouper form {
		display: grid;
		gap: 0.3rem;
		margin-top: 0.4rem;
	}
	.grouper label {
		font-weight: 600;
		font-size: var(--step--1);
	}
	.grouper input[type='text'] {
		min-height: 44px;
	}
	.help {
		margin: 0;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.join {
		margin: 0.2rem 0;
	}
	.shared {
		margin: 0;
		font-family: var(--sans);
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	/* Soft: a question, not an error. */
	.few {
		margin: 0;
		padding: 0.3rem 0.6rem;
		border-left: 3px solid var(--info-edge);
		background: var(--info-bg);
		font-size: var(--step--1);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.4rem;
	}
	.row .btn {
		min-height: 44px;
	}
	.flash {
		margin: 0;
		padding: 0.5rem 0.8rem;
		background: var(--ok-bg);
		border-left: 4px solid var(--ok);
	}
	.flash.error {
		background: var(--danger-bg);
		border-left-color: var(--danger);
	}
	.list {
		list-style: none;
		padding: 0;
		margin: 0;
		background: var(--card);
		border: 1px solid var(--edge);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		/* Alphabetical down each column: a wide screen shows the whole list. */
		columns: 3 18rem;
		column-gap: 0;
	}
	.list li {
		break-inside: avoid;
		border-bottom: 1px solid var(--edge);
	}
	/* The owner's « Renommer »: a quiet word at the line's right, a thumb high; the form takes the line's foot. */
	.list li.has-rename {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: start;
	}
	.rename-btn {
		min-height: 44px;
		padding: 0 0.75rem;
		border: 0;
		background: none;
		color: var(--ink-soft);
		font: inherit;
		font-size: var(--step--1);
		cursor: pointer;
		text-decoration: underline;
		text-decoration-color: var(--line);
		text-underline-offset: 0.2em;
	}
	.rename-btn:hover {
		color: var(--link);
	}
	.rename-btn:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: -3px;
	}
	.rename {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		padding: 0 1rem 0.75rem;
	}
	.rename input[type='text'] {
		flex: 1 1 12rem;
		min-height: 44px;
	}
	.rename .btn {
		min-height: 44px;
	}
	/* « Suggestion : Pâté chinois · 3 variantes [Grouper] »: one line before the search. */
	.suggestion {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.75rem;
		margin: 0.2rem 0;
	}
	.suggestion strong {
		font-family: var(--serif);
	}
	.suggestion .btn {
		min-height: 44px;
	}
	/* The whole row is the link: the dish's name in ink, its count beside it. */
	.list a {
		display: grid;
		gap: 0.1rem;
		min-height: 2.75rem;
		padding: 0.6rem 1rem;
		color: var(--ink);
		text-decoration: none;
	}
	.list a:hover .name {
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 0.15em;
	}
	.list a:focus-visible {
		outline-offset: -3px;
	}
	.name {
		font-family: var(--serif);
		font-size: 1.125rem;
		font-weight: 700;
		line-height: 1.3;
	}
	.n {
		color: var(--ink-soft);
		font-size: var(--step--1);
		font-variant-numeric: tabular-nums;
	}
	.todo {
		font-style: italic;
	}
	/* What tells the variants apart: quiet serif, a line of its own under the name. */
	.labels {
		color: var(--ink-soft);
		font-family: var(--serif);
		font-size: var(--step--1);
		line-height: 1.35;
	}
</style>
