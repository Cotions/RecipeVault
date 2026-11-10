<script lang="ts">
	// One card of /doublons: two recipes, or several linked by pairs
	// (« 3 fiches semblables »), and the three decisions for them. On a card of
	// three or more, the decisions act on the ticked recipes (the closest two
	// at first, marked « les plus proches »: a decision never takes in a fiche
	// she did not choose):
	// group them as variants, keep one and trash the others, or say they are
	// different (from each other, or the ticked ones from the rest). The page
	// (+page.svelte) runs each decision (`decide`): the card folds into a
	// one-line receipt, and a card still holding some of its recipes comes
	// back as a new one, nothing open, the closest two ticked.
	import { enhance } from '$app/forms';
	import { familyLabel, t } from '$lib/i18n';
	import { variantPrefill, variantShown } from '$lib/form';
	import Marked from '$lib/components/Marked.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { GroupView, PairSide } from '$lib/server/duplicates';

	let {
		g,
		distinctHash,
		labelMax,
		decide,
		gone = false,
		fresh = false,
		later = false
	}: {
		g: GroupView;
		distinctHash: string;
		labelMax: number;
		/** Each decision's `use:enhance` (the page folds the card, shows its receipt, moves focus on). */
		decide: (key: string) => SubmitFunction;
		/** Decided, the server's answer on its way: folded away. */
		gone?: boolean;
		/** Holds a recipe saved since this device's mark, as the page first showed it this visit. */
		fresh?: boolean;
		/** Past the first five: hidden on a phone until « Voir les suivantes ». */
		later?: boolean;
	} = $props();
	const s = t.duplicates;
	const pct = (x: number) => Math.round(100 * x);
	const two = $derived(g.members.length === 2);
	const id = $derived(g.key.replace(/ /g, '--'));

	// svelte-ignore state_referenced_locally -- a card is keyed on its recipes: another set is another card
	let ticked = $state<Record<string, boolean>>(Object.fromEntries(g.members.map((m, i) => [m.slug, i < 2])));
	/** The card's closest pair: the first two of `members`. */
	const closest = $derived(new Set(g.members.slice(0, 2).map((m) => m.slug)));
	// The closest two or three at first; the others behind « + N autres fiches ». A decision is about the recipes in view only.
	let expanded = $state(false);
	const hidden = $derived(g.members.length - g.core.length);
	const inView = $derived(expanded ? g.members : g.members.filter((m) => g.core.includes(m.slug)));
	const chosen = $derived(inView.filter((m) => ticked[m.slug]));
	const all = $derived(chosen.length === inView.length);
	const top = $derived(g.pairs[0]);
	/** A card of two standing for every pair between two dishes kept apart (« Recettes différentes » settles them all). */
	const bridged = $derived(two ? g.pairs.length - 1 : 0);

	// What the recipes in view all have, and what each alone has among them.
	const common = $derived.by(() => {
		const [first, ...rest] = inView.map((m) => new Set(g.elements[m.slug] ?? []));
		return first ? [...first].filter((e) => rest.every((x) => x.has(e))) : [];
	});
	const only = $derived(
		Object.fromEntries(inView.map((m) => [m.slug, (g.elements[m.slug] ?? []).filter((e) => inView.every((o) => o.slug === m.slug || !(g.elements[o.slug] ?? []).includes(e)))]))
	);

	/**
	 * What tells same titles apart in a label: where each is from (« Binnes —
	 * de Tante Aline », « Binnes — Magazine, 1998 »), else the file's name —
	 * never a number, which reads as a count.
	 */
	function nameOf(m: PairSide): string {
		const same = g.members.filter((x) => x.title === m.title);
		if (same.length < 2) return m.title;
		const told = m.from && same.filter((x) => x.from === m.from).length === 1;
		return `${m.title} — ${told ? m.from : m.from ? `${m.from} (${m.slug})` : m.slug}`;
	}

	// « Variantes »: the group one of them is in, else a new one named after the shortest title.
	const families = $derived([...new Map(chosen.filter((m) => m.family).map((m) => [m.family!, familyLabel(m.family!, m.familyLabel)])).entries()]);
	let family = $state('');
	$effect.pre(() => {
		if (families.length && !families.some(([f]) => f === family)) family = families[0][0];
		if (!families.length) family = '';
	});
	const shortest = $derived([...chosen].sort((a, b) => a.title.length - b.title.length || a.title.localeCompare(b.title, 'fr'))[0]?.title ?? '');
	let typedName = $state<string | null>(null);
	const groupName = $derived(family ? (families.find(([f]) => f === family)?.[1] ?? '') : (typedName ?? shortest));
	let typedVariant = $state<Record<string, string>>({});
	/**
	 * Its own variant when it is in that group already (a slug of who it is
	 * from read as her name), else who it is from when that tells it apart,
	 * else empty with examples in the placeholder (docs/DATA-FLOW.md).
	 */
	function variantOf(m: PairSide): string {
		if (typedVariant[m.slug] !== undefined) return typedVariant[m.slug];
		if (m.family && m.family === family && m.variantText) return variantShown(m.variantText, m.origin);
		return variantPrefill(m.origin, chosen.filter((x) => x.slug !== m.slug).map((x) => x.origin));
	}

	// « Même fiche »: keep one of the ticked, the other ticked ones go.
	let keep = $state('');
	$effect.pre(() => {
		if (chosen.some((m) => m.slug === keep && !blocked(m))) return;
		keep = (chosen.find((m) => m.usedBy.length) ?? chosen[0])?.slug ?? '';
	});
	/** Another ticked one is used as a sub-recipe: this one would go, it cannot be the one kept. */
	const blocked = (m: PairSide) => chosen.some((x) => x.slug !== m.slug && x.usedBy.length);
	const drop = $derived(chosen.filter((m) => m.slug !== keep));
	const used = $derived(drop.filter((m) => m.usedBy.length));

	// « Différentes »: the pairs between the ticked ones in view (all ticked, or the closest two
	// ticked at first); one ticked alone: between it and the others in view (« Pas le même plat
	// que les autres »). A card of two: every pair it stands for.
	const shown = $derived(new Set(inView.map((m) => m.slug)));
	const alone = $derived(!two && chosen.length === 1);
	const pairs = $derived(
		(two
			? g.pairs
			: g.pairs.filter((p) => shown.has(p.a) && shown.has(p.b) && (alone ? !!ticked[p.a] !== !!ticked[p.b] : !!ticked[p.a] && !!ticked[p.b]))
		).map((p) => `${p.a} ${p.b}`)
	);
	const titleOf = (slug: string) => nameOf(g.members.find((m) => m.slug === slug)!);
	const enough = $derived(chosen.length >= 2 || (!all && chosen.length >= 1));
</script>

<!-- Focusable: J / K and the end of a decision land on it (+page.svelte). -->
<li
	class="card"
	class:gone
	class:later
	id="card-{id}"
	tabindex="-1"
	aria-label={two ? g.members.map((m) => m.title).join(' · ') : `${s.similar(g.members.length)} : ${g.members.slice(0, 2).map((m) => m.title).join(' · ')}`}
	data-group={g.key}
	data-pair={two ? g.key : undefined}
	data-fresh={fresh || undefined}
	aria-hidden={gone || undefined}
>
	<header>
		{#if fresh}<span class="fresh" data-testid="fresh">{s.fresh}</span>{/if}
		{#if !two}<h2 class="count">{s.similar(g.members.length)}</h2>{/if}
		<!-- What the badges say is true of the closest pair (the card's score), never of the whole card. -->
		<p class="top" data-testid="top-pair">
			{#if !two}<span class="closest">{s.closest}</span>{/if}
			<span class="score">{s.score(pct(top.score))}</span>
			{#if top.titles === 'same'}<span class="mark">{s.sameTitle}</span>{:else if top.titles === 'near'}<span class="mark">{s.nearTitle}</span>{/if}
			{#if top.method}<span class="mark" data-testid="same-method">{s.sameMethod}</span>{/if}
		</p>
	</header>
	{#if bridged}<p class="pick-help bridge" data-testid="bridged">{s.bridged(bridged)}</p>{/if}

	{#if !two}<p class="pick-help" id="pick-{id}">{s.pick} <span>{s.pickHelp}</span></p>{/if}
	<ul class="sides" class:many={!two} id="sides-{id}">
		{#each inView as r (r.slug)}
			<li class="side" class:out={!ticked[r.slug]} class:closest={!two && closest.has(r.slug)}>
				{#if !two}
					<input class="tick" type="checkbox" bind:checked={ticked[r.slug]} id="tick-{id}-{r.slug}" aria-describedby="pick-{id}" aria-label={nameOf(r)} />
				{/if}
				<div>
					{#if !two && closest.has(r.slug)}<p class="near" data-testid="closest-mark">{s.closestMark}</p>{/if}
					<h3><a href="/r/{r.slug}"><Marked text={r.title} /></a></h3>
					<p class="meta" data-testid="from">{r.from || s.noSource}</p>
					{#if r.family}<p class="meta">{s.familyOf(familyLabel(r.family, r.familyLabel), r.variant && variantShown(r.variant, r.origin))}</p>{/if}
					{#if r.status}<p class="meta">{t.status[r.status] ?? r.status}</p>{/if}
					{#if r.usedBy.length}
						<p class="meta" data-testid="used-by">
							{s.usedBy}
							{#each r.usedBy as u, i (u.slug)}{i ? ', ' : ' '}<a href="/r/{u.slug}">{u.title}</a>{/each}
						</p>
					{/if}
					{#if only[r.slug]?.length}<p class="only"><span>{t.families.only} :</span> {only[r.slug].join(', ')}</p>{/if}
				</div>
			</li>
		{/each}
	</ul>
	{#if hidden > 0}
		<button class="more" type="button" aria-expanded={expanded} aria-controls="sides-{id}" data-testid="more-members" onclick={() => (expanded = !expanded)}>
			{expanded ? s.fewer(g.core.length) : s.moreMembers(hidden)}
		</button>
	{/if}
	<dl class="elements">
		<dt>{s.shared}</dt>
		<dd>{common.join(', ') || '—'}</dd>
	</dl>
	<div class="cmp">
		{#if two}
			<a class="compare" href="/doublons/comparer?a={g.pairs[0].a}&b={g.pairs[0].b}">{s.compare}</a>
		{:else}
			<details>
				<summary>{s.comparePairs}</summary>
				<ul>
					{#each g.pairs.filter((p) => shown.has(p.a) && shown.has(p.b)) as p (p.a + ' ' + p.b)}
						<li><a href="/doublons/comparer?a={p.a}&b={p.b}">{s.compareThese(titleOf(p.a), titleOf(p.b), pct(p.score))}</a></li>
					{/each}
				</ul>
			</details>
		{/if}
		<details class="detail">
			<summary>{s.detail}</summary>
			<p>{s.slugs} : {g.members.map((m) => m.slug).join(', ')}</p>
		</details>
	</div>

	<div class="actions">
		<details name="card-{id}">
			<summary>{two ? s.versions : s.versionsMany}</summary>
			{#if chosen.length < 2}
				<p class="help">{s.pickTwo}</p>
			{:else if two && g.members[0].family && g.members[0].family === g.members[1].family}
				<p class="help">{s.sameFamily}</p>
			{:else}
				<form method="POST" action="?/versions" use:enhance={decide(g.key)}>
					<input type="hidden" name="card" value={g.key} />
					<input type="hidden" name="familyName" value={groupName} />
					{#each chosen as m (m.slug)}
						<input type="hidden" name="slug" value={m.slug} />
						<input type="hidden" name="hash:{m.slug}" value={m.hash} />
					{/each}
					<p class="help">{s.versionsHelp}</p>
					{#if families.length > 1}
						<label for="fam-{id}">{s.groupPick}</label>
						<select id="fam-{id}" name="family" bind:value={family}>
							{#each families as [slug, label] (slug)}<option value={slug}>{label}</option>{/each}
						</select>
					{:else if families.length === 1}
						<input type="hidden" name="family" value={family} />
						<p class="help join">{s.groupJoin(groupName)}</p>
					{:else}
						<label for="name-{id}">{s.groupName}</label>
						<input
							id="name-{id}"
							name="label"
							type="text"
							required
							maxlength={labelMax}
							value={groupName}
							oninput={(e) => (typedName = e.currentTarget.value)}
							aria-describedby="name-help-{id}"
						/>
						<p class="help" id="name-help-{id}">{s.groupNameHelp}</p>
					{/if}
					{#each chosen as m (m.slug)}
						<label for="v-{id}-{m.slug}">{s.variant(nameOf(m))}</label>
						<input
							id="v-{id}-{m.slug}"
							name="variant:{m.slug}"
							type="text"
							required
							placeholder={s.variantPlaceholder}
							value={variantOf(m)}
							oninput={(e) => (typedVariant[m.slug] = e.currentTarget.value)}
						/>
					{/each}
					<button class="btn primary" type="submit">{two ? s.versionsSave : s.versionsSaveMany(chosen.length)}</button>
				</form>
			{/if}
		</details>

		<details name="card-{id}">
			<summary>{s.same}</summary>
			{#if chosen.length < 2}
				<p class="help">{s.pickTwo}</p>
			{:else}
				<form method="POST" action="?/same" use:enhance={decide(g.key)}>
					<input type="hidden" name="card" value={g.key} />
					{#each drop as m (m.slug)}
						<input type="hidden" name="drop" value={m.slug} />
						<input type="hidden" name="hash:{m.slug}" value={m.hash} />
						<input type="hidden" name="title:{m.slug}" value={m.title} />
					{/each}
					<p class="help">{two ? s.sameHelp : s.sameHelpMany}</p>
					{#if chosen.filter((m) => m.usedBy.length).length > 1}
						<p class="help" data-testid="both-used">{s.bothUsed}</p>
					{:else}
						<fieldset>
							<!-- The one kept; the other ticked ones go to the trash. A recipe used as a sub-recipe elsewhere is never one that goes. -->
							{#each chosen as m (m.slug)}
								<label class="radio"><input type="radio" name="keep" value={m.slug} bind:group={keep} disabled={blocked(m)} /> {s.keep(nameOf(m))}</label>
							{/each}
						</fieldset>
						{#if chosen.some((m) => m.usedBy.length)}<p class="help">{s.keepUsed(nameOf(chosen.find((m) => m.usedBy.length)!))}</p>{/if}
						<button class="btn danger" type="submit" disabled={!!used.length} data-testid="same-save">{drop.length === 1 ? s.sameSave : s.sameSaveMany(drop.length)}</button>
					{/if}
				</form>
			{/if}
		</details>

		<details name="card-{id}">
			<summary>{s.distinct}</summary>
			{#if !enough}
				<p class="help">{s.pickTwo}</p>
			{:else}
				<form method="POST" action="?/distinct" use:enhance={decide(g.key)}>
					<input type="hidden" name="card" value={g.key} />
					<input type="hidden" name="distinct" value={distinctHash} />
					{#each pairs as p (p)}<input type="hidden" name="pair" value={p} />{/each}
					<p class="help">{bridged ? s.distinctHelpBridge(bridged + 1) : two ? s.distinctHelp : all ? s.distinctHelpAll : alone ? s.distinctHelpSome : s.distinctHelpTicked}</p>
					<button class="btn" type="submit" disabled={!pairs.length}>{two ? s.distinctSave : alone ? s.distinctSaveSome : s.distinctSaveMany}</button>
				</form>
			{/if}
		</details>
	</div>
</li>

<style>
	.card {
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 0.9rem 1rem 1rem;
		transition:
			opacity 0.2s ease,
			transform 0.2s ease;
	}
	/* Decided: folded away at once, the server's answer still on its way. */
	.card.gone {
		display: none;
	}
	header {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: baseline;
	}
	.count {
		font-size: var(--step-1);
		margin: 0;
	}
	.top {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: baseline;
		margin: 0;
	}
	.closest {
		color: var(--ink-soft);
		font-size: var(--step--1);
	}
	.score {
		font-weight: 700;
	}
	.bridge {
		font-weight: 400;
		color: var(--ink-soft);
	}
	/* « + 4 autres fiches »: a quiet link-looking button, a full thumb high. */
	.more {
		justify-self: start;
		min-height: 44px;
		padding: 0 0.25rem;
		border: 0;
		background: none;
		color: var(--link);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	.more:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.mark {
		background: var(--highlight);
		color: var(--highlight-ink);
		padding: 0.05rem 0.55rem;
		border-radius: 999px;
		font-size: var(--step--1);
	}
	/* « Nouveau »: a small navy tag, never the red rule (that is the recipe card's). */
	.fresh {
		padding: 0 0.45rem;
		border-radius: 999px;
		background: var(--ink);
		color: var(--card);
		font-size: var(--step--1);
		font-weight: 700;
		font-variant-caps: all-small-caps;
		letter-spacing: 0.05em;
	}
	/* Where J / K and a decision's end land: the focus ring, a little room above it. */
	.card {
		scroll-margin-top: 1rem;
	}
	.card:focus {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.pick-help {
		margin: 0.6rem 0 0;
		font-size: var(--step--1);
		font-weight: 600;
	}
	.pick-help span {
		font-weight: 400;
		color: var(--ink-soft);
	}
	.sides {
		list-style: none;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 0.75rem;
		margin: 0.6rem 0;
	}
	.side {
		display: flex;
		gap: 0.5rem;
		align-items: flex-start;
	}
	/* Not in the decision: quieter, still readable (its title and lines keep ≥ 4.5:1). */
	.side.out {
		opacity: 0.78;
	}
	/* The card's closest two: a link-blue rule along their side (red is the recipe card's), and a word above the title. */
	.side.closest {
		box-shadow: inset 3px 0 0 var(--link);
		padding-left: 0.6rem;
	}
	.near {
		margin: 0.35rem 0 -0.35rem;
		color: var(--link);
		font-size: var(--step--1);
		font-weight: 600;
		letter-spacing: 0.02em;
	}
	/* The tick: a thumb-sized target around a plain checkbox. */
	.tick {
		flex: none;
		width: 1.35rem;
		height: 1.35rem;
		margin: 0.7rem 0.3rem 0 0;
		accent-color: var(--ink);
	}
	h3 {
		font-size: var(--step-1);
		margin: 0;
	}
	h3 a {
		display: inline-block;
		min-height: 44px;
		padding: 0.4rem 0;
	}
	.meta,
	.only {
		color: var(--ink-soft);
		font-size: var(--step--1);
		margin: 0.15rem 0 0;
	}
	.only span {
		font-weight: 600;
		color: var(--ink);
	}
	.elements {
		margin: 0.5rem 0;
		font-size: var(--step--1);
	}
	.elements dt {
		font-weight: 600;
	}
	.elements dd {
		margin: 0;
	}
	.cmp {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 1.25rem;
	}
	.cmp ul {
		margin: 0 0 0.5rem;
		padding-left: 1.2rem;
	}
	.cmp li a {
		display: inline-flex;
		min-height: 2.25rem;
		align-items: center;
	}
	.compare {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		font-weight: 600;
	}
	.detail summary {
		color: var(--ink-soft);
		font-weight: 400;
		font-size: var(--step--1);
	}
	.detail p {
		margin: 0 0 0.5rem;
		font-size: var(--step--1);
		color: var(--ink-soft);
		word-break: break-word;
	}
	.actions {
		display: grid;
		align-content: start;
		gap: 0.25rem;
		border-top: 1px solid var(--line);
		padding-top: 0.5rem;
	}
	/* On a wide screen the three decisions sit in a column of their own,
	   beside the recipes they are about. */
	@media (min-width: 56rem) {
		.card {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 19rem;
			grid-template-rows: auto auto auto auto auto 1fr;
			grid-template-areas: 'head acts' 'pick acts' 'sides acts' 'more acts' 'elements acts' 'cmp acts';
			column-gap: 1.5rem;
		}
		.card.gone {
			display: none;
		}
		header {
			grid-area: head;
		}
		.pick-help {
			grid-area: pick;
		}
		.sides {
			grid-area: sides;
		}
		.more {
			grid-area: more;
		}
		.elements {
			grid-area: elements;
		}
		.cmp {
			grid-area: cmp;
			align-self: start;
		}
		.actions {
			grid-area: acts;
			border-top: 0;
			border-left: 1px solid var(--line);
			padding: 0 0 0 1.25rem;
		}
	}
	summary {
		cursor: pointer;
		color: var(--link);
		font-weight: 600;
		min-height: 44px;
		display: flex;
		align-items: center;
	}
	details[open] > summary {
		color: var(--ink);
	}
	/* The three decisions: buttons that open their form, one under the other, a chevron saying so. */
	.actions {
		gap: 0.5rem;
	}
	.actions > details > summary {
		list-style: none;
		justify-content: space-between;
		gap: 0.5rem;
		box-sizing: border-box;
		padding: 0.5rem 0.85rem;
		background: var(--card);
		border: 1.5px solid var(--field-edge);
		border-radius: var(--radius);
		color: var(--ink);
		line-height: 1.25;
	}
	.actions > details > summary::-webkit-details-marker {
		display: none;
	}
	.actions > details > summary::after {
		content: '▾';
		flex: none;
		color: var(--ink-soft);
		font-weight: 400;
	}
	.actions > details[open] > summary {
		background: var(--hover);
		border-color: var(--ink);
		margin-bottom: 0.5rem;
	}
	.actions > details[open] > summary::after {
		content: '▴';
	}
	@media (hover: hover) {
		.actions > details > summary:hover {
			border-color: var(--ink);
			background: var(--hover);
		}
	}
	details form {
		display: grid;
		gap: 0.4rem;
		padding: 0 0 0.75rem;
	}
	.help {
		margin: 0 0 0.25rem;
		font-size: var(--step--1);
		color: var(--ink-soft);
		max-width: var(--measure);
	}
	.help.join {
		color: var(--ink);
	}
	label {
		font-weight: 600;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		display: grid;
	}
	.radio {
		font-weight: normal;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-height: 44px;
		cursor: pointer;
	}
	/* A thumb-sized radio (22 px) inside the 44 px label. */
	.radio input {
		flex: none;
		width: 1.375rem;
		height: 1.375rem;
		margin: 0;
		accent-color: var(--ink);
	}
	input[type='text'],
	select {
		min-height: 44px;
		font: inherit;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--card);
		color: var(--ink);
	}
	.btn {
		min-height: 44px;
	}
</style>
