<script lang="ts">
	import { t, tagLabel } from '$lib/i18n';
	import { locale } from '$lib/prefs';
	import { formatSeconds } from '$lib/render/duration';
	import { photoSrc } from '$lib/render/media';
	import { provenanceParts } from '$lib/render/provenance';
	import { rowProvenance } from '$lib/render/browselist';
	import type { Card } from '$lib/server/index/query';
	import HitText from './HitText.svelte';
	import { stripMarkers } from '$lib/vault/markers';
	import SourceGlyph from './SourceGlyph.svelte';

	let {
		card,
		terms = [],
		upkeep = false,
		reviewing = false,
		tagLabels = {},
		titleId,
		family = true,
		rating = false,
		filters = {}
	}: {
		card: Card;
		/** The search's folded words: their hits are marked in the title and the match line. */
		terms?: string[];
		/** An account with the Markdown tools: a broken file is marked (an alarm, always). */
		upkeep?: boolean;
		/** The list is narrowed by its review state (État): « à relire » shows on the rows (the recipe page always says it). */
		reviewing?: boolean;
		/** Display labels of the tags a search matched (the match line names them). */
		tagLabels?: Record<string, string>;
		/**
		 * One of several rows with the same title (the list's same-title group):
		 * the id of the title the group shows once. The row then leads with who
		 * it is from, and its link is named by that title and the provenance.
		 */
		titleId?: string;
		/** The « n variantes » link (off when the group's title already has it). */
		family?: boolean;
		/** Sorted by note: the row shows its rating (★ 4). */
		rating?: boolean;
		/** The list's filters on: a tag or season every row has goes unsaid on the row. */
		filters?: { tags?: string[]; season?: string | null };
	} = $props();

	const photo = $derived(card.photo ? photoSrc(card.slug, card.photo, 'thumb') : null);
	/** The thumbnail that did not load, if any (keyed by its address, so another card's photo is tried afresh). */
	let brokenSrc = $state<string | null>(null);
	/**
	 * Who or where it is from: what tells two cards with the same title apart.
	 * Its name in a stronger weight. A row of its own leaves out the author its
	 * title already ends with (« Tarte de Matante Ginette »); a same-title
	 * group's line keeps it, it is what the line is.
	 */
	const prov = $derived(titleId ? provenanceParts(card) : rowProvenance(card));
	const from = $derived(prov.lead + prov.name + prov.rest);
	const id = $derived(`carte-${card.slug}`);
	const sub = $derived(!!titleId);
	/** A same-title group's line that says nothing of where it is from still needs a name: « Provenance inconnue ». */
	const unknown = $derived(sub && !from);
	const labelledBy = $derived([titleId ?? `${id}-t`, ...(from || unknown ? [`${id}-f`] : [])].join(' '));
	const time = $derived(card.total_s ? formatSeconds(card.total_s, locale()) : '');
	/** A search hit on a tag: the tags it found, in the row's line (marked), not on a line of their own — none that is already a filter. */
	const tagHits = $derived(card.match?.field === 'tags' ? card.match.texts.filter((x) => !filters.tags?.includes(x)) : []);
	/** Its course (« Dessert »), unless a filter or the tag hits already say it. */
	const course = $derived(
		card.course && !filters.tags?.includes(card.course) && !(card.match?.field === 'tags' && card.match.texts.includes(card.course)) ? card.course : null
	);
	/** Its seasons when it has one or two (all four says nothing), unless the list is one season's. */
	const seasons = $derived(
		!filters.season && (card.seasons?.length ?? 0) > 0 && card.seasons.length <= 2
			? card.seasons.map((x, i) => (i ? (t.season[x] ?? x).toLowerCase() : (t.season[x] ?? x))).join(', ')
			: ''
	);
	const match = $derived.by(() => {
		const m = card.match;
		if (!m) return null;
		switch (m.field) {
			case 'ingredients':
				return { label: t.browse.match.ingredients(m.texts.length), texts: m.texts, quoted: false };
			case 'tags':
				// In the row's line (tagHits).
				return null;
			case 'author':
				// The provenance line already names her: its hit is marked there.
				return from.includes(m.texts[0]) ? null : { label: t.browse.match.author, texts: m.texts, quoted: false };
			case 'body':
				return { label: m.section ?? t.browse.match.body, texts: m.texts, quoted: true };
		}
	});
	/** « ⧉ 3 »: how many variants, after the title (a same-title group's line: after who it is from) — words, not a link: the row is one target, its recipe, which links its family. */
	const variants = $derived(family && card.family && (card.family_size ?? 0) > 1 ? card.family : null);
	const review = $derived(upkeep ? (card.broken ? 'broken' : reviewing && card.status === 'needs-review' ? 'needs-review' : null) : null);
</script>

<!-- The link's name is the title and the provenance: two « Tourtière » read apart. -->
<li class="card" class:sub>
	<span class="kind"><SourceGlyph type={card.source_type} /></span>
	<div class="text">
		{#if !sub}
			<p class="head" class:with-var={variants}>
				<a class="main" href="/r/{card.slug}" aria-labelledby={labelledBy}>
					<span class="title" id="{id}-t"><HitText text={card.title} {terms} markers /></span>
				</a>
				{#if variants}<span class="var" title={card.family_name ? `${t.families.variants(card.family_size ?? 0)} : ${card.family_name}` : undefined}
						><SourceGlyph type={null} variants labelled={false} /><span aria-hidden="true">{card.family_size ?? 0}</span><span class="visually-hidden"
							>{t.families.variants(card.family_size ?? 0)}</span
						></span
					>{/if}
				{#if review}<span class="review {review}">{review === 'broken' ? t.card.broken : t.status[review]}</span>{/if}
			</p>
		{/if}
		<p class="line">
			{#if sub}<a class="main" href="/r/{card.slug}" aria-labelledby={labelledBy}><span class="visually-hidden">{stripMarkers(card.title)}</span></a>{/if}
			{#if from}<span class="from" id="{id}-f"
					>{#if prov.lead}<HitText text={prov.lead} {terms} />{/if}{#if prov.name}<b class="name"><HitText text={prov.name} {terms} /></b>{/if}{#if prov.rest}<HitText
							text={prov.rest}
							{terms}
						/>{/if}</span
				>{:else if unknown}<span class="from unknown" id="{id}-f">{t.browse.unknownFrom}</span>{/if}
			{#if card.servings || (rating && card.rating) || tagHits.length || course || seasons}<span class="meta"
					>{#if rating && card.rating}<span class="bit stars" title={t.browse.rating(card.rating)}
							><span aria-hidden="true">★ {card.rating}</span><span class="visually-hidden">{t.browse.rating(card.rating)}</span></span
						>{/if}{#each tagHits as x (x)}<span class="bit kind-of hit"
							><span class="visually-hidden">{t.browse.match.tags(1)} </span><HitText text={tagLabel(x, tagLabels[x])} terms={card.match?.terms ?? terms} /></span
						>{/each}{#if course}<span class="bit kind-of">{tagLabel(course, tagLabels[course])}</span>{/if}{#if seasons}<span class="bit season"
							>{seasons}</span
						>{/if}{#if card.servings}<span class="bit servings">{t.card.servings(card.servings, card.servings_max)}</span>{/if}</span
				>{/if}
			<!-- A same-title group's line: how many variants, as words — the row is one target, its recipe (the family's page is a link on the recipe). -->
			{#if sub && variants}<span class="var"
					><SourceGlyph type={null} variants labelled={false} /><span aria-hidden="true">{card.family_size ?? 0}</span><span class="visually-hidden"
						>{t.families.variants(card.family_size ?? 0)}</span
					></span
				>{/if}
			{#if sub && review}<span class="review {review}">{review === 'broken' ? t.card.broken : t.status[review]}</span>{/if}
		</p>
		{#if match}
			<p class="why">
				<span class="field">{match.label}</span>
				{#if match.quoted}{t.app.quotes[0]}{/if}{#each match.texts as x, i (i)}{#if i}{', '}{/if}<HitText text={x} terms={card.match?.terms ?? terms} />{/each}{#if match.quoted}{t.app.quotes[1]}{/if}
			</p>
		{/if}
	</div>
	{#if photo && photo !== brokenSrc}
		<!-- A photo gone from the vault: no thumbnail rather than a broken image (the drawing at the row's start says the kind). -->
		<span class="thumb"><img src={photo} alt="" loading="lazy" decoding="async" onerror={() => (brokenSrc = photo)} /></span>
	{/if}
	<span class="time">{time}</span>
</li>

<style>
	/*
	 * One ruled row of the drawer, at every width: at its start a small drawing
	 * of the kind of source (a card, a book, a clipping, a site…), then the
	 * title and its « ⧉ 3 variantes » link, then one quieter line « de Tante
	 * Aline · 6 portions » — who it is from has the line's width — then, for a
	 * search hit whose title does not say why, one line of where the words
	 * are. The total time stands in a column of its own at the right, the same
	 * track on every row (each item has its cell: a hidden scan never lets the
	 * time slide into its place), so the eye runs down the times. A wide row
	 * only (one column) shows a scan before it. The list draws the drawer
	 * around the rows (+page.svelte).
	 */
	.card {
		position: relative;
		container: row / inline-size;
		display: grid;
		grid-template-columns: calc(var(--glyph-col, 1.35rem) + 0.6rem) minmax(0, 1fr) auto var(--time-col, 4rem);
		align-items: start;
		min-height: 3.4rem;
		padding: 0.45rem 0.9rem 0.45rem 0.75rem;
		border-bottom: 1px solid var(--edge);
		break-inside: avoid;
		transition: background-color 0.12s;
	}
	.card:hover {
		background: var(--row-hover, #f8f4e9);
	}
	@media (prefers-reduced-motion: reduce) {
		.card {
			transition: none;
		}
	}
	/*
	 * The kind of source, on the title's first line, in ink. Above the row's
	 * link, so the pointer gets its name (« Livre », « Magazine »).
	 */
	.kind {
		grid-area: 1 / 1;
		position: relative;
		z-index: 1;
		display: flex;
		justify-self: start;
		padding-top: 0.1rem;
		font-size: 1.175rem;
	}
	.kind :global(.glyph) {
		color: var(--ink);
	}
	/* A row of a same-title group is one line: the drawing on it. */
	.sub .kind {
		align-self: center;
		padding-top: 0;
	}
	.text {
		grid-area: 1 / 2;
		min-width: 0;
		padding-right: 0.6rem;
		align-self: center;
	}
	/*
	 * The title, its variants' link after the last word (« Tourtière ⧉ 4 »),
	 * and for the owner the review state, like a word pencilled on the card.
	 * Two lines at most.
	 */
	.head {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		min-width: 0;
		margin: 0;
		font-family: var(--serif);
		font-size: 1.125rem;
		font-weight: 700;
		line-height: 1.3;
		text-wrap: pretty;
	}
	.main {
		text-decoration: none;
		color: var(--ink);
	}
	/* A long title keeps its link in sight: one more line before it is cut. */
	.head.with-var {
		-webkit-line-clamp: 3;
		line-clamp: 3;
	}
	.main::after {
		content: '';
		position: absolute;
		inset: 0;
	}
	.main:focus-visible {
		outline: none;
	}
	.card:has(.main:focus-visible) {
		outline: 3px solid var(--focus);
		outline-offset: -3px;
	}
	.card:hover .title,
	.card.sub:hover .name {
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 0.15em;
	}
	.line {
		container-type: inline-size;
		display: flex;
		align-items: baseline;
		margin: 0.1rem 0 0;
		min-width: 0;
		font-size: 0.875rem;
		line-height: 1.35;
		white-space: nowrap;
	}
	/* Who it is from, under the title and quieter than it, the name in ink: the line's one face, the sans (UI round 2 — a line in two faces read as two). */
	.from {
		flex: 0 1 auto;
		min-width: 2.5rem;
		overflow: hidden;
		text-overflow: ellipsis;
		font-family: var(--sans);
		font-size: var(--step--1, 0.9375rem);
		color: var(--ink-soft);
	}
	.from .name {
		font-weight: 400;
		color: var(--ink);
	}
	/* In a same-title group the provenance is the row: larger, the name in the stronger weight. */
	.sub .from {
		font-size: 1rem;
	}
	.sub .from .name {
		font-weight: 700;
	}
	/* A line that says nothing of where it is from: said so, quietly. */
	.from.unknown {
		font-style: italic;
		color: var(--ink-soft);
	}
	/* The total time, in its own column at the right of the row: always the last track. */
	.time {
		grid-area: 1 / 4;
		align-self: center;
		justify-self: end;
		font-size: var(--step--1, 0.9375rem);
		color: var(--ink-soft);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		text-align: right;
	}
	/* What kind of dish, its season, its servings: after who it is from, cut before it is (it keeps 40 % of the line). */
	.meta {
		flex: none;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--ink-soft);
		font-variant-numeric: tabular-nums;
	}
	.from ~ .meta {
		max-width: 60%;
	}
	/* A tag the search found: in ink, its words marked. */
	.meta .hit {
		color: var(--ink);
	}
	/* « de Tante Aline · 45 min · 3 variantes ». The dot is its own box, so a link does not underline it. */
	.from ~ .meta .bit::before,
	.meta .bit:not(:first-child)::before {
		content: '·';
		display: inline-block;
		margin: 0 0.4em;
		color: var(--ink-soft);
		text-decoration: none;
		font-style: normal;
		font-variant: normal;
	}
	/* A narrow row keeps who it is from and the kind of dish: it drops the servings (the recipe page says them)… */
	@container (max-width: 24rem) {
		.servings {
			display: none;
		}
	}
	/* …and on a phone, a season after the kind; a same-title group's line is who it is from alone (the group's title holds the search's words). */
	@container (max-width: 18rem) {
		.kind-of ~ .season,
		.sub .meta {
			display: none;
		}
	}
	/* « ⧉ 3 » after the title, or after who it is from on a same-title group's line — plain words, not a link. */
	.head .var {
		margin-left: 0.5rem;
		vertical-align: -0.05em;
	}
	.var {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 0.3em;
		margin-left: 0.6rem;
		font-family: var(--sans);
		font-size: 0.8125rem;
		color: var(--ink-soft);
		font-variant-numeric: tabular-nums;
	}
	.var :global(.glyph) {
		width: 1.3em;
		height: 1.3em;
	}
	/* Sorted by note: the rating, before the servings. */
	.stars {
		color: var(--ink);
		white-space: nowrap;
	}
	/* The review state, for the owner only (under the État filter): a word in sentence case, not a badge or a bare dot. */
	.review {
		display: inline-block;
		margin-left: 0.5rem;
		font-family: var(--sans);
		font-weight: 600;
		font-size: 0.875rem;
		color: var(--review-ink, #7a5c00);
	}
	.review.broken {
		color: var(--danger);
	}
	/* Where the search found it, when the title does not say: one line, a small label ahead of the words. */
	.why {
		margin: 0.15rem 0 0;
		font-size: 0.8125rem;
		color: var(--ink);
		line-height: 1.4;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	/* « Notes », « Ingrédients »: a plain label in small capitals, not a button. */
	.why .field {
		margin-right: 0.45rem;
		color: var(--ink-soft);
		font-size: 0.875rem;
		font-variant: all-small-caps;
		letter-spacing: 0.06em;
	}
	/*
	 * The scan, as a strip: the top-left corner of the image, enlarged, where a
	 * card's or a page's title is written — the hand and the paper show, not
	 * a dark shrunken rectangle. Centred on the row, never setting its height.
	 */
	.thumb {
		grid-area: 1 / 3;
		align-self: center;
		position: relative;
		overflow: hidden;
		width: 6rem;
		height: 2.5rem;
		margin-right: 0.6rem;
		border-radius: 2px;
		border: 1px solid var(--edge);
		background: var(--paper);
		box-shadow: 0 1px 1px rgba(60, 50, 30, 0.12);
	}
	.thumb img {
		position: absolute;
		left: -6%;
		top: -9%;
		width: 190%;
		height: auto;
		max-width: none;
	}
	/*
	 * Only a wide row (one column) has room for it. In the two columns of the
	 * drawer, or on a phone, the strip would squeeze the title onto a second
	 * line or cut who the recipe is from, and the rows would lose their one
	 * rhythm: the scans are in « Fiches en photo » and on the recipe page. A
	 * same-title group's line is too short for it at any width.
	 */
	@container row (max-width: 36rem) {
		.thumb {
			display: none;
		}
	}
	.sub .thumb {
		display: none;
	}
	@media (max-width: 39.99rem) {
		.card {
			--time-col: 3.4rem;
			min-height: 3.9rem;
			padding-block: 0.55rem;
		}
		/*
		 * Phone: who it is from is what tells a card apart — never cut to
		 * « Tiré de Cuisine f… ». The line wraps, two lines at most, between
		 * its parts (a part itself, « 8 portions », stays whole); the time
		 * keeps its column.
		 */
		.line {
			display: -webkit-box;
			-webkit-box-orient: vertical;
			-webkit-line-clamp: 2;
			line-clamp: 2;
			overflow: hidden;
			white-space: normal;
		}
		.from,
		.meta {
			overflow: visible;
		}
		.from ~ .meta {
			max-width: none;
		}
		.bit,
		.var,
		.review {
			white-space: nowrap;
		}
		/* The dot between who it is from and the rest ends the first line, never starts the second. */
		.card:not(.sub) .from:has(~ .meta > .bit:not(.servings))::after {
			content: '·';
			margin: 0 0 0 0.4em;
			color: var(--ink-soft);
		}
		.from ~ .meta .bit:first-child::before {
			content: none;
		}
		.from ~ .meta {
			margin-left: 0.4em;
		}
	}
</style>
