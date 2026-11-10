<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { t, familyLabel, form as tf } from '$lib/i18n';
	import RecipeView from '$lib/components/RecipeView.svelte';
	import CostLine from '$lib/components/CostLine.svelte';
	import Menu from '$lib/components/Menu.svelte';
	import PhotoUpload from '$lib/components/PhotoUpload.svelte';
	import Marked from '$lib/components/Marked.svelte';
	import DiagnosticItem from '$lib/components/DiagnosticItem.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { queueHref } from '$lib/render/links';
	import { formatNumber } from '$lib/render/fraction';
	import { locale } from '$lib/prefs';
	import { parseRecipe } from '$lib/vault/parse';
	import { plainText } from '$lib/render/markers';
	import { goto } from '$app/navigation';
	import { amountQuery, factorFromParams } from '$lib/render/scale';
	import { cookbar, watchCook } from '$lib/cookbar.svelte';
	import { parseBody } from '$lib/vault/body';
	import { kitchenSession, kitchenVersion, resumeAmount as kitchenResumeAmount, type KitchenResume } from '$lib/kitchensession';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// SvelteKit keeps this component when going from one recipe to another, so
	// the factor is read from the address (`?portions=` or `?fois=`, plan 05
	// Q1 A) on every new recipe or navigation, and changed by hand in between.
	// Keyed on the slug and the address's query alone, so a form action
	// reloading the same recipe keeps it.
	let factor = $state(untrack(() => factorFromParams(page.url.searchParams, data.recipe, data.scaling)));
	/** The slug and query this page last wrote, so its own address change does not read the factor back. */
	let written = { slug: untrack(() => data.recipe.slug), search: untrack(() => page.url.search) };
	$effect.pre(() => {
		const slug = data.recipe.slug;
		const search = page.url.search;
		untrack(() => {
			if (slug === written.slug && search === written.search) return;
			written = { slug, search };
			factor = factorFromParams(page.url.searchParams, data.recipe, data.scaling);
		});
	});
	// The address follows the factor, without a history entry: a reload, a
	// bookmark, a shared link or Back from another page shows the same amounts.
	// A real (replacing) navigation rather than a shallow replaceState, which
	// would leave page.url, and so the history entry SvelteKit goes Back to,
	// without the amount. No load reads the address: nothing is fetched. Only
	// the two parameters are touched; the rest of the query stays.
	$effect(() => {
		const q = amountQuery(data.recipe, factor);
		untrack(() => {
			const url = new URL(location.href);
			url.searchParams.delete('portions');
			url.searchParams.delete('fois');
			for (const [k, v] of new URLSearchParams(q)) url.searchParams.set(k, v);
			if (url.href === location.href) return;
			written = { slug: data.recipe.slug, search: url.search };
			goto(url, { replaceState: true, noScroll: true, keepFocus: true, state: page.state }).catch(() => {
				// Before the router is ready (first render): the next change writes it.
			});
		});
	});
	/** « Autres variantes »: three, then « Voir les N autres ». */
	const VARIANTS_SHOWN = 3;
	let copied = $state(false);
	/** The file on disk that fails, to name the places of its errors. */
	const brokenFile = $derived(data.broken ? parseRecipe(data.file.text) : undefined);
	/** The file as parsed, to name the ingredients that are not linked. */
	const unresolvedFile = $derived(data.unresolved.length || data.vocab.length ? parseRecipe(data.file.text) : undefined);

	const uncertain = $derived(data.recipe.markers.some((m) => m.kind !== 'added'));
	/**
	 * Whoever keeps the archive (the Markdown tools): the review state and its
	 * one-click « Marquer vérifiée », the unlinked ingredients and their queue.
	 * The family reads the recipe without the archive's upkeep (docs/DATA-FLOW.md).
	 */
	const keeper = $derived(!!page.data.user?.markdown);
	/** Per line, where it links; « non relié » (a key into the resolve queue) only for the keeper. */
	const itemLinks = $derived(
		keeper ? data.links : Object.fromEntries(Object.entries(data.links).flatMap(([k, l]) => (l.item ? [[k, { ...l, key: undefined }] as const] : [])))
	);
	/**
	 * A cook in progress on this device (kitchen mode's saved session): read in
	 * the browser only, after the first render, so the server's page and the
	 * first paint say « Cuisiner » and nothing flashes for anyone else.
	 */
	let resume = $state<KitchenResume | null>(null);
	$effect(() => {
		const r = data.recipe;
		const steps = parseBody(data.body).body.steps;
		const read = () => (resume = kitchenSession(r.slug, kitchenVersion(r.ingredients, steps.map((x) => x.text)), steps.length));
		read();
		// Back from kitchen mode in another tab, or the page restored from the back-forward cache.
		const onShow = () => document.visibilityState === 'visible' && read();
		document.addEventListener('visibilitychange', onShow);
		window.addEventListener('pageshow', read);
		return () => {
			document.removeEventListener('visibilitychange', onShow);
			window.removeEventListener('pageshow', read);
		};
	});
	// Always say how much: an old kitchen session must not win over what this
	// page shows. « Reprendre » goes on at the session's own amount, unless she
	// set the amount here herself (usability round 4, plan 05).
	/**
	 * She set the amount on this page this visit: an explicit `?portions` /
	 * `?fois` in the address, or a change by the controls. Reset on another recipe.
	 */
	let amountTouched = $state(false);
	let amountSeen = { slug: untrack(() => data.recipe.slug), factor: untrack(() => factor) };
	$effect(() => {
		const slug = data.recipe.slug;
		const f = factor;
		untrack(() => {
			if (slug !== amountSeen.slug) amountTouched = false;
			else if (Math.abs(f - amountSeen.factor) > 1e-9) amountTouched = true;
			amountSeen = { slug, factor: f };
		});
	});
	const amountSet = $derived(amountTouched || page.url.searchParams.has('portions') || page.url.searchParams.has('fois'));
	/** What « Reprendre » opens at: the page's amount when she set it and it is not the session's, else the session's. */
	const resumeAt = $derived(resume ? kitchenResumeAmount(resume.factor, factor, amountSet) : null);
	/**
	 * « Reprendre · étape 4 · 10 portions »: the amount kitchen mode opens at,
	 * said when it is not the session's or not the page's, so the label always
	 * names what the cook goes on at.
	 */
	const resumeAmount = $derived.by(() => {
		const f = resumeAt?.named;
		if (f === undefined) return undefined;
		const n = data.recipe.servings ? data.recipe.servings * f : 0;
		return n && Math.abs(n - Math.round(n)) < 1e-9 ? `${formatNumber(n, locale())} ${t.recipe.scale.toLowerCase()}` : t.scaling.factorShown(formatNumber(f, locale()));
	});
	/**
	 * A draft with no original to read it against: no source (or an invented
	 * one) and no photo. Its badge says « Saisie sans fiche d’origine » rather than
	 * « Brouillon »; the status in the file is the same `draft` (usability round 3).
	 */
	const noOriginal = $derived.by(() => {
		const src = data.recipe.source;
		const none = !src || src.type === 'invented' || !(src.type || src.author || src.title || src.url || src.note || src.page !== undefined);
		return data.recipe.status === 'draft' && none && !data.photo;
	});
	/** The keeper's line under the red rule: shown when there is something to settle. */
	const upkeepShown = $derived(keeper && ((!!data.recipe.status && data.recipe.status !== 'verified') || data.unresolved.length > 0));
	/** The list of names to link at the foot of the page, opened from that line. */
	let toLinkOpen = $state(false);
	/**
	 * W501 / W502 at the page's foot, as lines to act on: « Étiquette nouvelle :
	 * érable — Décider dans Étiquettes › », « Nom de plat proche d'un autre :
	 * Tourtière — Décider dans Variantes › » (its grouper, this recipe in it).
	 */
	const vocabRows = $derived(
		data.vocab.map((d) => {
			const tag = /^tags\[(\d+)\]$/.exec(d.path ?? '');
			if (tag) return { text: t.recipe.vocabTag(plainText(data.recipe.tags[Number(tag[1])] ?? '')), href: '/etiquettes', go: t.recipe.vocabTagGo };
			const name = data.recipe.family ? familyLabel(data.recipe.family, data.familyName) : '';
			return { text: t.recipe.vocabFamily(name), href: `/familles?grouper=${data.recipe.slug}`, go: t.recipe.vocabFamilyGo };
		})
	);
	/** A W305/W303 diagnostic's line (`ingredients[0].items[3].name`) → its row in the resolve queue. */
	function queueOf(path: string | null): string | undefined {
		const m = /^ingredients\[(\d+)\]\.items\[(\d+)\]\.name$/.exec(path ?? '');
		if (!m) return undefined;
		const gi = Number(m[1]);
		const pos = data.recipe.ingredients.slice(0, gi).reduce((n, g) => n + g.items.length, 0) + Number(m[2]);
		const key = data.links[pos]?.key;
		return key ? queueHref(key) : undefined;
	}
	const kitchenHref = $derived(resume && !resumeAt?.carry ? `/r/${data.recipe.slug}/cuisine` : `/r/${data.recipe.slug}/cuisine${amountQuery(data.recipe, factor, true)}`);
	// The phone's bottom bar offers Cuisiner once the head's button is out of sight (layout, cookbar).
	$effect(() => {
		cookbar.href = kitchenHref;
		cookbar.label = resume ? t.recipe.cookResume(null) : null;
		return () => {
			cookbar.href = null;
			cookbar.label = null;
		};
	});

	/** « Voir le fichier » (the Markdown tools, plan 04 Q2 B): from the ⋯ menu, in a dialog, not at the foot of every page. */
	let fileDialog: HTMLDialogElement | undefined = $state();
	/** A variant's label as written (`tante-aline`), for display: « Tante aline ». */
	const variantLabel = (v: string) => {
		const w = v.replace(/-/g, ' ').trim();
		return w.charAt(0).toLocaleUpperCase(data.recipe.lang) + w.slice(1);
	};

	async function copyFile() {
		await navigator.clipboard.writeText(data.file.text);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<svelte:head>
	<title>{plainText(data.recipe.title)} — {t.app.name}</title>
</svelte:head>

{#if data.broken}
	<div class="banner" role="alert">
		<p>{t.recipe.broken}</p>
		<ul>
			{#each data.broken as d, i (i)}
				<DiagnosticItem {d} file={brokenFile} />
			{/each}
		</ul>
		<p class="hint">{t.diagnostics.vaultHint}</p>
	</div>
{/if}

{#if form?.message}
	<p class="flash no-print" class:error={!form.ok} role="status">{form.message}</p>
{/if}

<RecipeView
	recipe={data.recipe}
	body={data.body}
	titles={data.titles}
	photo={data.photo}
	familyName={data.familyName}
	familySize={data.recipe.family ? data.variants.length + 1 : 0}
	tagViews={data.tags}
	{itemLinks}
	scaling={data.scaling}
	subScale={data.subScale}
	showStatus={false}
	upkeep={upkeepShown ? upkeep : undefined}
	bind:factor
>
	{#snippet cost(factor: number)}
		{#if data.cost}<CostLine cost={data.cost} {factor} money={data.money} {keeper} />{/if}
	{/snippet}
	{#snippet actions()}
		<!-- Cuisiner, Modifier, ⋯ on one row; on a phone Cuisiner across the width and Modifier in the ⋯ (the same link twice, one shown per width). -->
		<a class="btn primary" href={kitchenHref} use:watchCook title={resume ? t.recipe.cookResumeTitle : undefined} data-testid="cook">{resume ? t.recipe.cookResume(resume.step, resumeAmount) : t.recipe.cookMode}</a>
		{#if !data.broken}<a class="btn wide-only" href="/r/{data.recipe.slug}/modifier" data-testid="edit">{tf.edit}</a>{/if}
		<Menu label={t.app.actions} testid="recipe-actions">
			{#if !data.broken}<a class="phone-only" href="/r/{data.recipe.slug}/modifier" data-testid="edit">{tf.edit}</a>{/if}
			{#if !data.photo && !data.broken}<PhotoUpload slug={data.recipe.slug} hash={data.file.hash} label={t.recipe.addPhoto} menu />{/if}
			<button type="button" onclick={() => window.print()}>{t.recipe.print}</button>
			<a href="/r/{data.recipe.slug}/historique">{t.history.link}</a>
			{#if keeper}<button type="button" onclick={() => fileDialog?.showModal()}>{t.recipe.file}</button>{/if}
			{#if keeper && !data.broken}<a href="/familles?grouper={data.recipe.slug}" data-testid="group-with">{t.families.groupWith}</a>{/if}
			<!-- « Marquer vérifiée » is beside the badge; the menu keeps it only to say why it is refused. -->
			{#if keeper && data.recipe.status !== 'verified' && uncertain}
				<form method="POST" action="?/verify" use:enhance>
					<input type="hidden" name="hash" value={data.file.hash} />
					<button type="submit" disabled={uncertain} title={uncertain ? t.recipe.verifyBlocked : t.recipe.verifyHelp}>{t.recipe.verify}</button>
				</form>
				{#if uncertain}<p class="note">{t.recipe.verifyBlocked}</p>{/if}
			{/if}
			<hr />
			<form
				method="POST"
				action="?/remove"
				use:enhance={({ cancel }) => {
					if (!confirm(t.recipe.removeConfirm)) cancel();
				}}
			>
				<input type="hidden" name="hash" value={data.file.hash} />
				<button class="danger" type="submit">{t.recipe.remove}</button>
			</form>
		</Menu>
	{/snippet}
</RecipeView>

{#snippet upkeep()}
	<!-- « Brouillon · pas encore relue contre la fiche · Marquer vérifiée · 2 ingrédients à relier » (the button's words never in the sentence):
	     the keeper's upkeep in one quiet line under the red rule; the family never sees it (docs/DATA-FLOW.md). -->
	{#if data.recipe.status && data.recipe.status !== 'verified'}
		{#if noOriginal}<span class="badge draft">{t.recipe.noOriginal}</span>{:else}<StatusBadge status={data.recipe.status} />{/if}
		<span class="status-why">{noOriginal ? t.recipe.noOriginalWhy : (t.recipe.statusWhy[data.recipe.status] ?? '')}</span>
		<!-- A phone: what to do on a line of its own, under what it means. -->
		{#if (!uncertain && !data.broken) || data.unresolved.length}<span class="brk" aria-hidden="true"></span>{/if}
		{#if !uncertain && !data.broken}
			<form class="status-act" method="POST" action="?/verify" use:enhance>
				<input type="hidden" name="hash" value={data.file.hash} />
				<button type="submit" title={t.recipe.verifyHelp}>{t.recipe.verify}</button>
			</form>
		{/if}
	{/if}
	{#if data.unresolved.length}
		<!-- The dot outside the link, so its underline does not run under it. -->
		{#if data.recipe.status && data.recipe.status !== 'verified'}<span class="dot" aria-hidden="true">·</span>{/if}
		<a class="to-link" href="#a-relier" onclick={() => (toLinkOpen = true)}>{t.recipe.toLink(data.unresolved.length)}</a>
	{/if}
{/snippet}

{#snippet variant(v: (typeof data.variants)[number])}
	<!-- Who it is from tells same titles apart; the variant's own label only when nothing else does. -->
	<li><a href="/r/{v.slug}"><Marked text={v.title} /></a>{#if v.from}<span class="from">{' — '}<Marked text={v.from} /></span>{:else if v.variant}<span class="from">{' — '}{variantLabel(v.variant)}</span>{/if}</li>
{/snippet}

{#if data.variants.length || data.usedBy.length}
	<nav class="related no-print">
		{#if data.variants.length}
			<section>
				<h2>{t.recipe.variants}{#if data.recipe.family}{' — '}<a href="/famille/{data.recipe.family}">{familyLabel(data.recipe.family, data.familyName)}</a>{/if}</h2>
				<ul>
					{#each data.variants.slice(0, VARIANTS_SHOWN) as v (v.slug)}
						{@render variant(v)}
					{/each}
				</ul>
				{#if data.variants.length > VARIANTS_SHOWN}
					<details class="more">
						<summary>{t.recipe.moreVariants(data.variants.length - VARIANTS_SHOWN)}</summary>
						<ul>
							{#each data.variants.slice(VARIANTS_SHOWN) as v (v.slug)}
								{@render variant(v)}
							{/each}
						</ul>
					</details>
				{/if}
			</section>
		{/if}
		{#if data.usedBy.length}
			<section>
				<h2>{t.recipe.usedBy}</h2>
				<ul>
					{#each data.usedBy as u (u.slug)}
						<li><a href="/r/{u.slug}"><Marked text={u.title} /></a></li>
					{/each}
				</ul>
			</section>
		{/if}
	</nav>
{/if}

{#if keeper && data.unresolved.length}
	<details class="unresolved no-print" id="a-relier" bind:open={toLinkOpen}>
		<summary>{t.recipe.unresolved(data.unresolved.length)}</summary>
		<p class="hint">{t.recipe.unresolvedHelp}</p>
		<ul>
			{#each data.unresolved as d, i (i)}
				{@const go = queueOf(d.path)}
				<DiagnosticItem {d} file={unresolvedFile}>
					{#snippet after()}{#if go}<a class="link-it" href={go}>{t.recipe.linkIt}</a>{/if}{/snippet}
				</DiagnosticItem>
			{/each}
		</ul>
	</details>
{/if}

{#if keeper && data.vocab.length}
	<!-- One line per new tag or near family name, its decision a link away (usability round 6);
	     what it means, the file and the code only behind « Détails ». -->
	<section class="unresolved vocab no-print" aria-label={t.recipe.vocab(data.vocab.length)} data-testid="vocab">
		<ul class="todo">
			{#each vocabRows as row, i (i)}
				<li>{row.text}<span class="dash" aria-hidden="true">{' — '}</span><a href={row.href}>{row.go}</a></li>
			{/each}
		</ul>
		<details class="detail">
			<summary>{t.recipe.vocabDetails}</summary>
			<p class="hint">{t.recipe.vocabHelp}</p>
			<ul>
				{#each data.vocab as d, i (i)}
					<DiagnosticItem {d} file={unresolvedFile} part="detail" />
				{/each}
			</ul>
		</details>
	</section>
{/if}

{#if keeper}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -- a click on the backdrop closes; Escape and the button do the same from the keyboard -->
	<dialog class="file no-print" bind:this={fileDialog} aria-labelledby="file-title" onclick={(e) => e.target === fileDialog && fileDialog?.close()}>
		<div class="file-head">
			<h2 id="file-title">{t.recipe.file}</h2>
			<button class="btn" type="button" onclick={copyFile}>{copied ? t.recipe.copied : t.recipe.copy}</button>
			<form method="dialog"><button class="btn quiet" type="submit">{t.app.close}</button></form>
		</div>
		<p class="hint">{t.recipe.fileHelp}</p>
		<pre><code>{data.file.text}</code></pre>
	</dialog>
{/if}

<style>
	.banner {
		background: var(--danger-bg);
		border-left: 4px solid var(--rule-red);
		padding: 0.75rem 1rem;
		margin-bottom: 1rem;
	}
	.banner p {
		margin: 0 0 0.25rem;
		font-weight: 600;
	}
	.banner ul {
		margin: 0;
		padding: 0;
	}
	.banner p.hint {
		font-weight: 400;
		font-size: var(--step--1);
		color: var(--ink-soft);
		margin: 0.4rem 0 0;
	}
	.flash {
		padding: 0.6rem 1rem;
		background: var(--ok-bg);
		border-left: 4px solid var(--ok);
		margin: 0 0 1rem;
	}
	.flash.error {
		background: var(--danger-bg);
		border-left-color: var(--rule-red);
	}
	.hint {
		color: var(--ink-soft);
		font-size: var(--step--1);
		margin: 0 0 0.75rem;
	}
	.related {
		display: grid;
		gap: 1.5rem;
		margin-top: 2rem;
	}
	@media (min-width: 48rem) {
		.related {
			grid-template-columns: 1fr 1fr;
		}
	}
	.related h2 {
		font-size: var(--step-1);
		margin-bottom: 0.5rem;
		padding-bottom: 0.3rem;
		border-bottom: 1px solid var(--line);
	}
	.related ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.related li {
		padding: 0.3rem 0;
		font-size: var(--step--1);
		line-height: 1.4;
	}
	.related li a {
		font-family: var(--serif);
		font-size: var(--step-0);
		font-weight: 600;
	}
	.related .from {
		color: var(--ink-soft);
	}
	.related .more summary {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		cursor: pointer;
		color: var(--link);
		font-weight: 600;
		font-size: var(--step--1);
	}
	.related .more[open] summary {
		display: none;
	}
	/* Beside the badge, in the line's voice; the actions a word, a thumb's height. */
	.status-why::before {
		content: '·';
		margin-inline: 0.4rem;
		color: var(--pencil);
	}
	.to-link {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		margin-block: -0.75rem;
		font-weight: 600;
	}
	.dot {
		margin-inline: 0.4rem;
		color: var(--pencil);
	}
	/* A phone: the actions on a second line, without a dot left at its head. */
	.brk {
		display: none;
	}
	@media (max-width: 40rem) {
		/* Beside the badge, wrapping in its own box rather than dropping under it with a dot at its head. */
		.status-why {
			flex: 1 1 10rem;
		}
		.brk {
			display: block;
			flex-basis: 100%;
			height: 0;
		}
		.brk + .dot,
		.brk + .status-act::before {
			display: none;
		}
		.brk + .status-act button {
			margin-left: -0.35rem;
		}
	}
	.link-it {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		font-weight: 600;
		font-size: var(--step--1);
	}
	.status-act {
		display: inline;
	}
	.status-act button {
		padding: 0.7rem 0.35rem;
		margin: -0.7rem -0.35rem -0.7rem 0.15rem;
		border: 0;
		background: none;
		font: inherit;
		font-weight: 600;
		color: var(--link);
		text-decoration: underline;
		text-decoration-color: var(--link-line);
		text-underline-offset: 0.18em;
		cursor: pointer;
	}
	.status-act::before {
		content: '·';
		margin-inline: 0.4rem 0.1rem;
		color: var(--pencil);
	}
	.status-act button:hover {
		color: var(--link-hover);
	}
	.unresolved {
		margin-top: 2rem;
		border-top: 1px solid var(--line);
		padding-top: 1rem;
	}
	.file {
		width: min(52rem, calc(100vw - 2rem));
		max-height: calc(100vh - 2rem);
		padding: 1rem 1.25rem 1.25rem;
		border: 1px solid var(--edge);
		border-radius: var(--radius);
		background: var(--card);
		color: var(--ink);
		box-shadow: 0 12px 48px rgb(28 42 66 / 0.3);
	}
	.file::backdrop {
		background: rgb(28 42 66 / 0.45);
	}
	.file-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}
	.file-head h2 {
		flex: 1;
		font-size: var(--step-1);
	}
	.unresolved ul {
		list-style: none;
		padding: 0;
	}
	.unresolved summary {
		cursor: pointer;
		color: var(--link);
		font-weight: 600;
	}
	.vocab .todo {
		margin: 0;
	}
	.vocab .todo li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		column-gap: 0.1rem;
		min-height: 2.75rem;
	}
	.vocab .todo a {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		font-weight: 600;
	}
	.vocab .dash {
		white-space: pre;
		color: var(--pencil);
	}
	.vocab .detail summary {
		width: fit-content;
		padding-block: 0.7rem;
		font-size: var(--step--1);
		font-weight: 400;
	}
	.file pre {
		margin: 0;
		background: var(--paper);
		border: 1px solid var(--line);
		padding: 1rem;
		overflow: auto;
		font-size: 0.85rem;
		max-height: 32rem;
		white-space: pre-wrap;
	}
</style>
