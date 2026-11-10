<script lang="ts">
	// One checker diagnostic for a person. An error leads with one plain
	// sentence: what is wrong and what to do; under it, small, where, as a cook
	// would say it ("Sirop, 2e ingrédient (eau)"), and the code. A unit the alias table
	// knows is not called unknown: "Unité « tasse » : dans la fiche, on écrit
	// cup". Then its actions on one row — the quick fix first, "Montrer dans
	// le texte" beside it — and the disclosures under them. The stable code
	// (docs/VALIDATION.md) waits behind « Détails pour le dépannage », never in
	// the sentence; with it
	// the full place and the raw path, with how to correct it in
	// French (`FIX_FR`) and the names the checker cites on a French account,
	// the checker's own English message and fix on an English one. In the paste box a problem found in the pasted text has
	// a "Montrer dans le texte" button (a remark on one line is itself that
	// button), and a closed-vocabulary value can carry a quick fix (`quickfix`).
	import type { Snippet } from 'svelte';
	import { t } from '$lib/i18n';
	import { explain, FIX_FR, pasteText, placeHuman, placeOf, snippets, type PlaceContext } from '$lib/i18n/diagnostics';
	import { locale } from '$lib/prefs';
	import { unitWord } from '$lib/render/unitwords';
	import { valueAt } from '$lib/vault/locate';
	import { unitForAlias } from '$lib/vault/vocab';
	import type { Lang } from '$lib/vault/types';

	interface Props {
		d: { code: string; path: string | null; message: string; fix?: string; severity?: string };
		/** The parsed file, to name groups, ingredients and sections, and quote the value. */
		file?: PlaceContext;
		/** One line: the explanation's first sentence and the place (the warnings of the paste box). */
		compact?: boolean;
		/** Select the place in the pasted text; the problem is a button when given. */
		onshow?: () => void;
		/** A quick fix, under the sentence (the paste box: replace a unit or a tag in the text). */
		quickfix?: Snippet;
		/** The sentence, when the caller knows better than the code's line (a new tag, with the vault's vocabulary). */
		say?: string;
		/** The other places of the same problem (the same unknown unit on three lines): said once, with them. */
		more?: string[];
		/** Where, when the path cannot say it (E002: « Ligne 17 du texte »). */
		at?: string;
		/** Under the sentence, before the actions: the line as written (E002). */
		extra?: Snippet;
		/** Under the actions: what to check once it is fixed (E002). */
		after?: Snippet;
		/** A small mark before the sentence: « à revérifier » on a problem found in E002's realigned text. */
		badge?: string;
		/**
		 * 'all': the row and its own « Détails pour le dépannage ». 'row': the row
		 * alone (the paste box gathers the details in one disclosure under the
		 * file's problems). 'detail': only what that disclosure holds for it.
		 */
		part?: 'all' | 'row' | 'detail';
	}

	let { d, file, compact = false, onshow, quickfix, say, more = [], at, extra, after, badge, part = 'all' }: Props = $props();
	const [open, close] = t.app.quotes;
	/** The full place, path-like: for the technical detail (and a remark's one line). */
	const place = $derived(placeOf(d.path, file));
	/** The place a cook would say, to lead an error's sentence. */
	const where = $derived(at ?? placeHuman(d.path, file));
	const value = $derived(valueAt(file?.frontmatter, d.path));
	/** E201 on a word the alias table knows: it is written as its code, and the app shows the word. */
	const alias = $derived.by(() => {
		if (d.code !== 'E201' || !value) return undefined;
		const lang: Lang = file?.frontmatter?.lang === 'en' ? 'en' : 'fr';
		const unit = unitForAlias(value, lang);
		return unit ? pasteText.unitAlias(value, unit, unitWord(unit, 1, lang)) : undefined;
	});
	const full = $derived(say ?? alias ?? (d.code ? explain(d.code) : d.message));
	// One line keeps the first sentence (what is wrong); the rest (what to do) waits in the detail.
	const lead = $derived(compact && !say ? (/^(.+?[.!?…])\s+(?=[A-ZÀ-ÖØ-Þ«“])/u.exec(full)?.[1] ?? full) : full);
	const rest = $derived(full.slice(lead.length).trim());
	// The value as written, unless the sentence (its own, or the alias one) or the place already quotes it.
	const shown = $derived(
		value && !say && !alias && !lead.includes(`${open}${value}${close}`) && !(compact ? place : where)?.includes(`${open}${value}${close}`) && !where?.includes(`(${value})`) ? value : undefined
	);
	const times = $derived(more.length ? pasteText.times(more.length + 1) : '');
	/**
	 * The technical detail on a French account: how to correct it in French,
	 * with the names the checker's message and fix cite (`servings`) — the
	 * English message and fix are the AI's and `vault check`'s (docs/VALIDATION.md).
	 */
	const fixFr = $derived(locale() === 'fr' ? FIX_FR[d.code] : undefined);
	// The names the message and the fix cite, each once (`servings` and
	// `servings:` are one name).
	const words = $derived.by(() => {
		if (!fixFr) return [];
		const seen = new Set<string>();
		return [...snippets(d.message), ...snippets(d.fix)].filter((x) => {
			const k = x.replace(/:$/, '');
			return !seen.has(k) && !!seen.add(k);
		});
	});
</script>

{#if part === 'detail'}
	<li class="diag-detail">{@render techBody()}</li>
{:else}
<li class="diag-item {d.severity ?? 'error'}" class:compact class:recheck={!!badge}>
	{#if compact}
		<!-- One line: the explanation, then the place; the whole line selects it in the text. -->
		{#snippet oneLine()}
			{#if shown && !say}<span class="value">{open}{shown}{close}</span>{/if}
			<span class="text">{lead}</span>
			{#if place && !say}<span class="where">{place}</span>{/if}
		{/snippet}
		{#if onshow}
			<button type="button" class="main" onclick={onshow} title={t.diagnostics.show}>{@render oneLine()}</button>
		{:else}
			<p class="main">{@render oneLine()}</p>
		{/if}
	{:else}
		<!-- The sentence first: what (the value as written, highlighted) and what to do; where and the code under it, small. -->
		<p class="main say">
			{#if badge}<span class="badge">{badge}</span>{' '}{/if}{#if shown}<span class="value">{open}{shown}{close}</span>{' '}{/if}<span class="text">{full}</span>{#if times}{' '}<span class="times"
					>({times})</span
				>{/if}
		</p>
		{#if more.length}<p class="more">{pasteText.alsoAt} {more.join(' ; ')}</p>{/if}
		{#if where || part === 'all'}
			<div class="sub">
				{#if where}<span class="where">{where}</span>{/if}
				{#if part === 'all'}{@render tech()}{/if}
			</div>
		{/if}
	{/if}
	{#if extra}<div class="extra">{@render extra()}</div>{/if}
	{#if compact}
		{#if quickfix}<div class="quickfix">{@render quickfix()}</div>{/if}
	{:else if quickfix || onshow}
		<!-- One row, left-aligned: the fix first, "Montrer dans le texte" beside it; a fix's own disclosure ("Autre unité…") wraps under them. -->
		<div class="actions">
			{#if quickfix}<div class="quickfix">{@render quickfix()}</div>{/if}
			{#if onshow}<button type="button" class="show" onclick={onshow}>{t.diagnostics.show}</button>{/if}
		</div>
	{/if}
	{#if after}<div class="extra">{@render after()}</div>{/if}
	{#if compact && part === 'all'}{@render tech()}{/if}
</li>
{/if}

{#snippet tech()}
	<details class="tech">
		<summary>{t.diagnostics.technical}</summary>
		{@render techBody()}
	</details>
{/snippet}

{#snippet techBody()}
		<p>
			<code class="code">{d.code || '—'}</code>
			{#if place}<span class="place">{place}</span>{/if}
			{#if compact && rest}<span class="rest">{rest}</span>{/if}
			{#if d.path}<code class="path">{d.path}</code>{/if}
			{#if fixFr}
				<span class="fix">{fixFr}</span>
				{#if words.length}<span class="snips">{pasteText.codeWords} {#each words as x, i (i)}{i ? ' · ' : ''}<code>{x}</code>{/each}</span>{/if}
			{:else}
				<span class="msg" lang="en">{d.message}</span>
				{#if d.fix}<span class="fix" lang="en">{d.fix}</span>{/if}
			{/if}
		</p>
{/snippet}

<style>
	.diag-item {
		padding: 0.6rem 0;
		border-bottom: 1px solid var(--line);
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 0.75rem;
		align-items: center;
		list-style: none;
	}
	.diag-item:last-child {
		border-bottom: 0;
	}
	.main {
		flex: 1 1 100%;
		display: block;
		min-width: 0;
		margin: 0;
	}
	.say {
		line-height: 1.45;
	}
	/* Under the sentence, small: where, then the code's disclosure. */
	.sub {
		flex-basis: 100%;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 0.6rem;
		font-size: 0.875rem;
		color: var(--ink-soft);
	}
	.sub .where {
		font-weight: 600;
	}
	/* « à revérifier »: found in the realigned text; small, before the sentence. */
	.badge {
		display: inline-block;
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1.3;
		color: var(--ink-soft);
		border: 1px solid var(--edge);
		border-radius: 999px;
		padding: 0 0.5em;
		vertical-align: 0.1em;
	}
	.sub .tech {
		flex: 0 1 auto;
	}
	.sub .tech[open] {
		flex-basis: 100%;
	}
	button.main {
		font: inherit;
		color: inherit;
		text-align: left;
		background: none;
		border: 0;
		border-radius: var(--radius);
		padding: 0.3rem 0.4rem;
		margin: -0.3rem -0.4rem;
		cursor: pointer;
	}
	@media (hover: hover) {
		button.main:hover {
			background: var(--paper);
		}
	}
	.value {
		font-weight: 700;
		overflow-wrap: anywhere;
	}
	.error .value {
		color: var(--danger);
		background: var(--danger-bg);
		padding: 0 0.25em;
		border-radius: 2px;
	}
	.times,
	.more {
		color: var(--ink-soft);
	}
	.more {
		flex-basis: 100%;
		margin: 0;
		font-size: var(--step--1);
	}
	/* The quick fix first (what settles it), "Montrer dans le texte" beside it, one row. */
	.actions {
		flex-basis: 100%;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		/* The save bar never covers it when it is scrolled to. */
		scroll-margin-bottom: 6rem;
	}
	.actions .quickfix {
		display: contents;
	}
	.actions .show {
		order: 1;
	}
	.compact .quickfix {
		flex: 0 1 auto;
		min-width: 0;
	}
	.show {
		display: inline-flex;
		align-items: center;
		min-height: 2.5rem;
		padding: 0.25rem 0.7rem;
		font: inherit;
		font-size: var(--step--1);
		font-weight: 600;
		color: var(--link);
		background: var(--card);
		border: 1.5px solid #b7c0cc;
		border-radius: var(--radius);
		cursor: pointer;
		white-space: nowrap;
	}
	@media (hover: hover) {
		.show:hover {
			border-color: var(--link);
		}
	}
	@media (pointer: coarse), (max-width: 40rem) {
		.show {
			min-height: 2.75rem;
		}
	}
	@media (max-width: 40rem) {
		.actions {
			gap: 0.5rem 0.4rem;
		}
		.show {
			padding-inline: 0.5rem;
		}
	}
	/* The technical detail: small, last, one per problem. */
	.tech {
		flex-basis: 100%;
		font-size: 0.875rem;
		color: var(--ink-soft);
	}
	.tech summary {
		cursor: pointer;
		width: fit-content;
	}
	/* A phone or a touch screen: the detail's toggle is a 44 px target. */
	@media (pointer: coarse), (max-width: 40rem) {
		.tech summary {
			box-sizing: border-box;
			min-height: 2.75rem;
			padding: 0.8rem 0.25rem 0.8rem 0;
			line-height: 1.2;
		}
	}
	.tech p,
	.diag-detail p {
		margin: 0.25rem 0 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.6rem;
	}
	/* One problem's details in the paste box's one disclosure: small, a rule between them. */
	.diag-detail {
		list-style: none;
		padding: 0.35rem 0;
		border-top: 1px solid var(--line);
		font-size: 0.875rem;
		color: var(--ink-soft);
	}
	.diag-detail:first-child {
		border-top: 0;
	}
	.code {
		font-weight: 600;
		letter-spacing: 0.02em;
		white-space: nowrap;
	}
	.path {
		font-size: 0.9em;
	}
	.msg,
	.fix,
	.snips,
	.rest {
		flex-basis: 100%;
	}
	.snips code {
		overflow-wrap: anywhere;
	}
	.extra {
		flex-basis: 100%;
		min-width: 0;
	}
	.rest {
		color: var(--ink);
	}

	/* One line: the explanation, then the place after a dash; the detail a small disclosure at the end. */
	.compact {
		padding: 0.3rem 0;
		gap: 0.15rem 0.75rem;
	}
	.compact .main {
		flex: 0 1 auto;
		min-width: min(12rem, 100%);
	}
	.compact .main > * + * {
		margin-left: 0.4em;
	}
	.compact .where {
		font-size: var(--step--1);
		color: var(--ink-soft);
		font-weight: 600;
	}
	@media (hover: hover) {
		.compact button.main:hover .where {
			text-decoration: underline dotted;
		}
	}
	.compact .where::before {
		content: '— ';
		font-weight: 400;
	}
	/* The one-tap fix right after the sentence; the detail pushed to the end. */
	.compact .tech {
		flex: 0 0 auto;
		margin-left: auto;
	}
	.compact .tech[open] {
		flex: 0 1 45%;
	}
	@media (max-width: 40rem) {
		.compact .tech,
		.compact .tech[open] {
			flex-basis: 100%;
		}
	}
</style>
