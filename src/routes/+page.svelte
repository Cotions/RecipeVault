<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { t, tagLabel, familyLabel, form as tf } from '$lib/i18n';
	import DiagnosticItem from '$lib/components/DiagnosticItem.svelte';
	import HitText from '$lib/components/HitText.svelte';
	import RecipeCard from '$lib/components/RecipeCard.svelte';
	import SourceGlyph from '$lib/components/SourceGlyph.svelte';
	import VariantsLink from '$lib/components/VariantsLink.svelte';
	import PageHead from '$lib/components/PageHead.svelte';
	import { photoSrc } from '$lib/render/media';
	import { formatSeconds } from '$lib/render/duration';
	import { locale } from '$lib/prefs';
	import { bundle, columnSplit, gather, pageLinks, rowProvenance } from '$lib/render/browselist';
	import { stripMarkers } from '$lib/vault/markers';
	import type { FacetName, FacetValue, IdeaCard } from '$lib/server/index/query';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// URL parameter per facet: state lives in the URL so a filtered view can be
	// bookmarked and the back button works.
	const PARAM: Record<FacetName, string> = {
		family: 'famille',
		tags: 'tag',
		season: 'saison',
		time: 'temps',
		servings: 'portions',
		source: 'source',
		author: 'auteur',
		status: 'etat',
		unresolved: 'relies'
	};
	// What a cook narrows by first — the tags, the time she has — open; then the
	// rest folded to their heading. The owner's upkeep facets last: the review
	// state, then « Ingrédients à relier » under the same heading.
	const ORDER: FacetName[] = ['tags', 'time', 'family', 'season', 'servings', 'source', 'author', 'status', 'unresolved'];
	/** Each facet lists its top values, then « + N autres ». */
	const SHOWN = 4;
	/** Facets that start folded to their heading (unless one of their values is active). */
	const FOLDED = new Set<FacetName>(['family', 'season', 'servings', 'source', 'author']);

	// svelte-ignore state_referenced_locally -- kept in sync by the effect below
	let q = $state(data.params.q ?? '');
	let sheetOpen = $state(false);
	let expanded = $state<Record<string, boolean>>({});
	/** Phone: the search box has the focus — a few filters to tap show under it. */
	let searching = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	// A search still waiting when she leaves the page (typed, then clicked a recipe) must not pull her back here.
	$effect(() => () => clearTimeout(timer));

	$effect(() => {
		// Back/forward: the box follows the URL, unless the person is typing.
		const fromUrl = data.params.q ?? '';
		if (document.activeElement?.id !== 'search') q = fromUrl;
	});

	function href(mutate: (s: URLSearchParams) => void): string {
		const s = new URLSearchParams(page.url.searchParams);
		mutate(s);
		s.delete('page');
		const qs = s.toString();
		return qs ? `/?${qs}` : '/';
	}

	function toggle(facet: FacetName, value: string): string {
		const key = PARAM[facet];
		return href((s) => {
			const current = s.getAll(key);
			if (facet === 'tags') {
				s.delete(key);
				const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
				next.forEach((v) => s.append(key, v));
			} else if (current.includes(value)) s.delete(key);
			else s.set(key, value);
		});
	}

	function active(facet: FacetName, value: string): boolean {
		return page.url.searchParams.getAll(PARAM[facet]).includes(value);
	}

	/**
	 * A value tapped in the filters stays under the finger: the query lists a
	 * value that would now leave nothing after the others (query.ts
	 * facetCounts), which moves those below it. So a tap keeps every group's
	 * order as it was shown, until a navigation that is not a filter's.
	 */
	let held = $state<Partial<Record<FacetName, string[]>> | null>(null);
	let holding = false;
	function ordered(facet: FacetName, values: FacetValue[]): FacetValue[] {
		const o = held?.[facet];
		if (!o) return values;
		const rank = new Map(o.map((v, i) => [v, i]));
		const at = (v: FacetValue) => rank.get(v.value) ?? o.length;
		return values.map((v, i) => ({ v, i })).sort((a, b) => at(a.v) - at(b.v) || a.i - b.i).map((x) => x.v);
	}
	function hold() {
		held = Object.fromEntries(ORDER.map((f) => [f, ordered(f, r.facets[f]).map((v) => v.value)]));
		holding = true;
	}
	afterNavigate(() => {
		if (holding) holding = false;
		else held = null;
	});

	/** The values listed before "N de plus": the first SHOWN, plus every active one further down (never hidden). */
	function shown<V extends { value: string }>(facet: FacetName, values: V[]): V[] {
		if (expanded[facet]) return values;
		return values.filter((v, i) => i < SHOWN || active(facet, v.value));
	}

	function anyActive(facet: FacetName): boolean {
		return page.url.searchParams.getAll(PARAM[facet]).some(Boolean);
	}

	const activeCount = $derived(ORDER.reduce((n, f) => n + page.url.searchParams.getAll(PARAM[f]).length, 0));
	/** An account with the Markdown tools sees a broken file marked on its row. */
	const upkeep = $derived(!!data.user?.markdown);
	/**
	 * « à relire » on the rows only while the list is narrowed by its review
	 * state (État): on a third of the box it would compete with the titles. The
	 * recipe page always says it.
	 */
	const reviewing = $derived(upkeep && !!data.params.status);

	/** The active filters, as removable chips above the results. Facets with a plain value name the facet too. */
	const chips = $derived(
		ORDER.flatMap((facet) =>
			page.url.searchParams
				.getAll(PARAM[facet])
				.filter(Boolean)
				.map((value) => ({
					facet,
					value,
					prefix: facet === 'tags' || facet === 'family' || facet === 'unresolved' ? null : t.browse.facets[facet],
					label: label(facet, value)
				}))
		)
	);
	const clearHref = $derived(data.params.q ? `/?q=${encodeURIComponent(data.params.q)}` : '/');

	/**
	 * Phone: a few filters to tap under the search box while it has the focus,
	 * read off the list itself — its two most used tags, then the shortest time
	 * that narrows it, then its most used season if there is still room: three
	 * at most. Only values that narrow the list (fewer than all, more than
	 * none): each count says what the list holds with it (query.ts facetCounts).
	 */
	const QUICK = 3;
	const quick = $derived.by(() => {
		const narrows = (v: { value: string; count: number }) => v.count > 0 && v.count < r.total;
		const chip = (facet: FacetName, value: string) => ({ facet, value, label: label(facet, value) });
		const out = r.facets.tags
			.filter((v) => !v.pending && narrows(v) && !active('tags', v.value))
			.sort((a, b) => b.count - a.count)
			.slice(0, 2)
			.map((v) => chip('tags', v.value));
		const time = data.params.time ? undefined : r.facets.time.find((v) => v.value !== 'plus' && narrows(v));
		if (time) out.push(chip('time', time.value));
		if (!data.params.season)
			for (const v of r.facets.season
				.filter(narrows)
				.sort((a, b) => b.count - a.count)
				.slice(0, QUICK - out.length))
				out.push(chip('season', v.value));
		return out.slice(0, QUICK);
	});

	function label(facet: FacetName, value: string): string {
		switch (facet) {
			case 'family':
				return data.familyNames[value] ?? familyLabel(value);
			case 'tags':
				return tagLabel(value, data.tagLabels?.[value]);
			case 'season':
				return t.season[value] ?? value;
			case 'time':
				return t.time[value] ?? value;
			case 'servings':
				return t.servings[value] ?? value;
			case 'status':
				return t.status[value] ?? value;
			case 'source':
				return t.source[value] ?? value;
			case 'unresolved':
				return t.browse.unresolved[value] ?? value;
			default:
				return value;
		}
	}

	function search() {
		clearTimeout(timer);
		timer = setTimeout(() => {
			const target = href((s) => {
				if (q.trim()) s.set('q', q.trim());
				else s.delete('q');
				// New words: a close spelling may be searched for them again.
				s.delete('exact');
				if (!q.trim() && s.get('sort') === 'relevance') s.delete('sort');
			});
			goto(target, { keepFocus: true, replaceState: true, noScroll: true });
		}, 180);
	}

	function sortHref(value: string): string {
		return href((s) => {
			if (value) s.set('sort', value);
			else s.delete('sort');
		});
	}

	function sortTo(value: string) {
		goto(sortHref(value), { noScroll: true });
	}

	function pageHref(p: number): string {
		const s = new URLSearchParams(page.url.searchParams);
		if (p > 1) s.set('page', String(p));
		else s.delete('page');
		const qs = s.toString();
		return qs ? `/?${qs}` : '/';
	}

	const r = $derived(data.result);
	/** The filters every row has: the rows leave them unsaid (RecipeCard). */
	const filters = $derived({ tags: data.params.tags ?? [], season: data.params.season ?? null });
	const currentSort = $derived(data.params.sort ?? (data.params.q ? 'relevance' : 'title'));
	/**
	 * The sorts on offer: relevance only with a search; the note only when a
	 * recipe of the box has one (the rows then show it, ★ 4), unless the
	 * address already asks for it.
	 */
	const sorts = $derived(
		Object.entries(t.browse.sorts).filter(
			([value]) => (value !== 'relevance' || data.params.q) && (value !== 'rating' || r.rated > 0 || currentSort === 'rating')
		)
	);

	/** The letter-index letter of a card (A–Z, else #), and its divider's anchor. */
	const letterOf = (initial: string) => (/^[A-Z]$/.test(initial) ? initial : '#');
	const anchor = (l: string) => `lettre-${l === '#' ? 'autres' : l.toLowerCase()}`;
	const indexed = $derived(!!r.letters && r.pages > 1);
	/** Sorted by relevance: the rows of the same title together (within a section), where the best placed of them ranked. */
	const items = $derived(
		r.sections === null ? r.items : r.sections.flatMap((x) => gather(r.items.filter((c) => c.section === x.section)))
	);
	/** Sorted by title: a divider before the first card of each letter on this page. */
	const rows = $derived(
		items.map((card, i) => {
			const prev = items[i - 1];
			const divider = indexed && (!prev || letterOf(prev.initial) !== letterOf(card.initial)) ? letterOf(card.initial) : null;
			return { card, divider };
		})
	);
	/** A letter whose first recipe is on an earlier page: this page's tab says « C (suite) ». */
	const begun = (l: string) => (r.letters?.find((x) => x.letter === l)?.page ?? r.page) < r.page;

	/**
	 * Sorted by relevance: the cards whose title holds a word of the search
	 * (most words first), then the others in quieter drawers by where the
	 * words are, each under its heading « Dans les ingrédients de 4 recettes »
	 * (query.ts sections; the count is the whole list's). In each, rows that
	 * follow each other with the same title (six « Carrés aux dattes ») are one
	 * entry: the title once, then a line per recipe that leads with who it is
	 * from, like a book's index under one word (render/browselist.ts).
	 */
	const groups = $derived.by(() => {
		if (r.sections === null) return [{ section: null, count: 0, entries: bundle(rows) }];
		return r.sections
			.map((x) => ({
				section: x.section === 'title' ? null : x.section,
				count: x.count,
				entries: bundle(rows.filter((row) => row.card.section === x.section))
			}))
			.filter((g) => g.entries.length);
	});
	/**
	 * Sorted by title, two columns: where the second one starts, about half way
	 * down. Inside a letter, it opens with that letter's tab again, « B (suite) »,
	 * so it does not read as a new section.
	 */
	const split = $derived(indexed && groups.length === 1 ? columnSplit(groups[0].entries) : null);
	const first = $derived(r.offset + 1);
	/** The letters this page holds, first to last (the letter strip marks them). */
	const here = $derived(indexed ? [...new Set(r.items.map((c) => letterOf(c.initial)))] : []);
	/** This page's guide words (« Titres de Ca à Ge »). */
	const guide = $derived(indexed ? r.guides?.[r.page - 1] : undefined);
	/** The words searched, for the quieter heading of the notes' drawer (« Mentionnent aussi « tourtière » »). */
	const searched = $derived(r.suggestion?.applied ? (r.q ?? '') : (data.params.q ?? ''));

	/**
	 * The pager: each page by its guide words, like a dictionary's (« A–Ca »,
	 * « Ce–G ») when sorted by title — where it starts and ends, never two pages
	 * under the same words — else by its number. A long list keeps the first
	 * two, the last two and those around this one.
	 */
	const pages = $derived(
		pageLinks(r, indexed ? r.guides : null).map((p) =>
			p
				? {
						page: p.page,
						label: !p.first ? String(p.page) : p.first === p.last ? p.first : `${p.first}–${p.last}`,
						full: p.first ? `${t.browse.page(p.page, r.pages)} : ${t.browse.pageLetters(p.first, p.last)}` : t.browse.page(p.page, r.pages)
					}
				: null
		)
	);

	/** Phone: the pager's row scrolls sideways; this page's button is brought into it. */
	let pagesEl = $state<HTMLOListElement>();
	$effect(() => {
		void r.page;
		const ol = pagesEl;
		const cur = ol?.querySelector<HTMLElement>('[aria-current="page"]');
		if (!ol || !cur || ol.scrollWidth <= ol.clientWidth) return;
		ol.scrollLeft = cur.offsetLeft - ol.offsetLeft - (ol.clientWidth - cur.offsetWidth) / 2;
	});

	/** A letter on this page scrolls to it; another loads its page, at the letter. */
	function jump(l: string, behavior: ScrollBehavior = 'auto') {
		const target = r.letters?.find((x) => x.letter === l);
		if (!target?.count) return;
		if (target.page === r.page) {
			document.getElementById(anchor(l))?.scrollIntoView({ block: 'start', behavior });
			history.replaceState(history.state, '', `${pageHref(r.page)}#${anchor(l)}`);
		} else goto(`${pageHref(target.page)}#${anchor(l)}`);
	}

	/*
	 * Phone: the letters down the right edge, like a phone's contacts. A tap
	 * goes to the letter; a finger slid along it shows the letter under it
	 * (and scrolls to it when it is on this page), and lets go there.
	 */
	let scrub = $state<string | null>(null);
	/** Where the finger is: the large letter shows beside it, left of the rail. */
	let scrubY = $state(0);
	let railActive = false;
	let railHandled = false;
	function letterUnder(e: PointerEvent, rail: HTMLElement): string | null {
		const all = [...rail.querySelectorAll<HTMLElement>('[data-letter]')];
		for (const el of all) {
			const box = el.getBoundingClientRect();
			if (e.clientY >= box.top && e.clientY < box.bottom) return el.dataset.letter ?? null;
		}
		// Past either end of the rail: its first or last letter.
		if (!all.length) return null;
		return e.clientY < all[0].getBoundingClientRect().top ? (all[0].dataset.letter ?? null) : (all[all.length - 1].dataset.letter ?? null);
	}
	/**
	 * Phone: the rail starts under the search box, wherever the header leaves
	 * it (a running timer's pill makes the header taller): measured at load,
	 * and again when the header or the window changes size — never while
	 * scrolling, so the letters never move under a finger.
	 */
	let railTop = $state<number | null>(null);
	$effect(() => {
		if (!indexed) return;
		const input = document.getElementById('search');
		const header = document.querySelector('header.site');
		if (!input) return;
		const measure = () => (railTop = Math.round(input.getBoundingClientRect().bottom + window.scrollY + 8));
		measure();
		const ro = new ResizeObserver(measure);
		if (header) ro.observe(header, { box: 'border-box' });
		window.addEventListener('resize', measure);
		return () => (ro.disconnect(), window.removeEventListener('resize', measure));
	});
	/**
	 * Phone: the rail shows once the index itself is in view (its top above
	 * the middle of the screen), never over the quick filters and the idea
	 * cards: the letters are for the list, and the top of the page stays
	 * clear to read. It appears between scrolls, so it never moves under a finger.
	 */
	let cardsEl = $state<HTMLElement | null>(null);
	let railShown = $state(false);
	$effect(() => {
		if (!indexed || !cardsEl) return;
		const io = new IntersectionObserver(([e]) => (railShown = e.isIntersecting), { rootMargin: '0px 0px -50% 0px' });
		io.observe(cardsEl);
		return () => io.disconnect();
	});
	/** The letters that have recipes: the strip over the list and the phone's rail (each tall enough for a finger) list only those. */
	const railLetters = $derived(r.letters?.filter((l) => l.count) ?? []);
	function railDown(e: PointerEvent & { currentTarget: HTMLElement }) {
		if (e.pointerType === 'mouse') return;
		railActive = true;
		railHandled = false;
		e.currentTarget.setPointerCapture?.(e.pointerId);
		scrub = letterUnder(e, e.currentTarget);
		scrubY = e.clientY;
	}
	function railMove(e: PointerEvent & { currentTarget: HTMLElement }) {
		if (!railActive) return;
		scrubY = e.clientY;
		const l = letterUnder(e, e.currentTarget);
		if (l && l !== scrub) {
			scrub = l;
			if (r.letters?.find((x) => x.letter === l)?.page === r.page) jump(l);
		}
	}
	function railUp() {
		if (!railActive) return;
		railActive = false;
		railHandled = true;
		const l = scrub;
		scrub = null;
		if (l) jump(l);
		// The click that follows (if any) is this touch's: the jump is done.
		setTimeout(() => (railHandled = false), 500);
	}
	function railClick(e: MouseEvent) {
		if (railHandled) {
			e.preventDefault();
			railHandled = false;
		}
	}

	/**
	 * Over the index (the whole box, first page): three cards of ideas — one
	 * recipe at random (↻ the next of a dozen drawn by the server), a few of
	 * the season's, the last added. Photos where they exist.
	 */
	const idea = (x: IdeaCard) => {
		// Who it is from, unless the title already ends with her name (« Tarte de Matante Ginette »).
		const p = rowProvenance(x);
		return { ...x, src: x.photo ? photoSrc(x.slug, x.photo, 'thumb') : null, from: p.lead + p.name + p.rest };
	};
	/** Thumbnails that did not load (a photo gone from the vault): the card's drawing in their place, never a broken image (usability round 4). */
	let failed = $state<Set<string>>(new Set());
	const fail = (src: string | null) => {
		if (src && !failed.has(src)) failed = new Set(failed).add(src);
	};
	const ideas = $derived(
		data.ideas
			? {
					random: data.ideas.random.map(idea),
					season: data.ideas.season ? { ...data.ideas.season, cards: data.ideas.season.cards.map(idea) } : null,
					recent: data.ideas.recent.map(idea),
					rails: (data.ideas.rails ?? []).map((x) => ({ ...x, cards: x.cards.map(idea) }))
				}
			: null
	);
	let pick = $state(0);
	const picked = $derived(ideas?.random.length ? ideas.random[pick % ideas.random.length] : null);
	/** The idea cards shown (the random one, the season's, the rails, the last added): the phone's carousel says which is in view. */
	const ideaCount = $derived(ideas ? (picked ? 1 : 0) + (ideas.season ? 1 : 0) + ideas.rails.length + (ideas.recent.length ? 1 : 0) : 0);
	/**
	 * A wide screen shows one row of three — the random card, the season's,
	 * the first rail (the long-simmered main dishes when the box has them) —
	 * and « Plus d'idées » shows the others in place. A phone's sideways row
	 * holds them all.
	 */
	const IDEA_ROW = 3;
	let moreIdeas = $state(false);
	/** Where each card stands in the row (the cards past IDEA_ROW wait behind « Plus d'idées »). */
	const ideaAtSeason = $derived(picked ? 1 : 0);
	const ideaAtRail = $derived(ideaAtSeason + (ideas?.season ? 1 : 0));
	let ideaAt = $state(0);
	/** Phone: the card most in view of the sideways row (each card snaps to its start). */
	function ideaScroll(e: Event & { currentTarget: HTMLElement }) {
		const ul = e.currentTarget;
		const first = ul.firstElementChild as HTMLElement | null;
		if (!first) return;
		const step = first.offsetWidth + parseFloat(getComputedStyle(ul).columnGap || '0');
		ideaAt = Math.max(0, Math.min(ideaCount - 1, Math.round(ul.scrollLeft / (step || 1))));
	}

	/**
	 * The whole box's first page, under 60 rem (where the filters fold behind
	 * « Filtres »): a row of filters to tap without opening them — the main
	 * dish, the dessert, what is quick, the season's — each only when it
	 * narrows the box. A wide screen has them in the filters beside the list.
	 */
	const start = $derived.by(() => {
		if (!ideas) return [];
		const out: { href: string; label: string }[] = [];
		const has = (facet: FacetName, value: string) => r.facets[facet].some((v) => v.value === value && v.count > 0 && v.count < r.total);
		for (const tag of ['plat-principal', 'dessert']) if (has('tags', tag)) out.push({ href: toggle('tags', tag), label: label('tags', tag) });
		if (has('time', '30')) out.push({ href: toggle('time', '30'), label: t.browse.start.quick });
		if (ideas.season) out.push({ href: toggle('season', ideas.season.season), label: t.browse.ideas.season(t.season[ideas.season.season] ?? ideas.season.season) });
		return out;
	});

	/** Phone: the filter sheet. Escape closes it; the focus goes to its close button, and back to « Filtres ». */
	let filtersBtn = $state<HTMLButtonElement>();
	let sheetClose = $state<HTMLButtonElement>();
	function openSheet() {
		sheetOpen = true;
		requestAnimationFrame(() => sheetClose?.focus());
	}
	function closeSheet() {
		sheetOpen = false;
		filtersBtn?.focus();
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (sheetOpen && e.key === 'Escape') {
			e.preventDefault();
			closeSheet();
		}
	}}
/>

<svelte:head>
	<title>{t.browse.title}</title>
</svelte:head>

<!-- Phone: the site header already says « Recettes »; the heading stays for a screen reader. -->
<div class="head">
	<PageHead title={t.browse.title} />
</div>

<form
	class="search"
	role="search"
	onsubmit={(e) => (e.preventDefault(), search())}
	onfocusin={() => (searching = true)}
	onfocusout={(e) => {
		if (!e.currentTarget.contains(e.relatedTarget as Node | null)) searching = false;
	}}
>
	<label class="visually-hidden" for="search">{t.browse.searchLabel}</label>
	<input id="search" type="search" name="q" placeholder={t.browse.search} aria-describedby="search-hint" autocomplete="off" bind:value={q} oninput={search} />
	<span id="search-hint" class="visually-hidden">{t.browse.searchHint}</span>
	<!-- Phone: while the box has the focus (and is empty), a few filters to tap; the box keeps the focus. -->
	{#if searching && !q.trim() && quick.length && !start.length}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -- keeps the focus in the box (and the keyboard up) while a link is tapped -->
		<ul class="quick" aria-label={t.browse.quick} onmousedown={(e) => e.preventDefault()}>
			{#each quick as c (c.facet + '\u0000' + c.value)}
				<li><a href={toggle(c.facet, c.value)} data-sveltekit-noscroll data-sveltekit-keepfocus>{c.label}</a></li>
			{/each}
		</ul>
	{/if}
</form>

{#if data.problems.length}
	<details class="problems">
		<summary>{t.browse.problems(data.problems.length)}</summary>
		<ul>
			{#each data.problems as p (p.file_path)}
				<li>
					<code class="file">{p.file_path}</code>
					<ul class="diags">
						{#each p.diagnostics as d, i (i)}<DiagnosticItem {d} />{/each}
					</ul>
				</li>
			{/each}
		</ul>
		<p class="hint">{t.diagnostics.vaultHint}</p>
	</details>
{/if}

<div class="layout">
	<aside
		class="facets"
		class:open={sheetOpen}
		aria-label={t.browse.filters}
		role={sheetOpen ? 'dialog' : undefined}
		aria-modal={sheetOpen ? 'true' : undefined}
	>
		<div class="sheet-head">
			<h2>{t.browse.filters}</h2>
			{#if activeCount}<a class="clear" href={clearHref}>{t.browse.clear}</a>{/if}
			<!-- Phone: the sheet's way out, besides « Voir les recettes » and Escape. -->
			<button class="btn quiet sheet-x" type="button" bind:this={sheetClose} onclick={closeSheet} aria-label={t.browse.closeSheet}
				><span aria-hidden="true">✕</span></button
			>
		</div>
		<!-- Phone: the sort lives here, the first group of the sheet (a wide screen has its select over the list). -->
		<section class="sorting">
			<h3><label for="sort-sheet">{t.browse.sort}</label></h3>
			<select id="sort-sheet" value={currentSort} onchange={(e) => sortTo(e.currentTarget.value)}>
				{#each sorts as [value, text] (value)}
					<option {value}>{text}</option>
				{/each}
			</select>
		</section>
		{#each ORDER as facet (facet)}
			{@const values = ordered(facet, r.facets[facet])}
			{@const listed = shown(facet, values)}
			{#if values.length}
				{@const joined = facet === 'unresolved' && r.facets.status.length > 0}
				<section class:joined>
					{#if !joined}
						<details open={!FOLDED.has(facet) || anyActive(facet)}>
							<summary><h3>{t.browse.facets[facet]}</h3></summary>
							{@render facetValues(facet, values, listed)}
						</details>
					{:else}
						{@render facetValues(facet, values, listed)}
					{/if}
				</section>
			{/if}
		{/each}
		<div class="close">
			<button class="btn primary" type="button" onclick={closeSheet}>{t.browse.closeFilters} ({r.total})</button>
		</div>
	</aside>

	{#snippet facetValues(facet: FacetName, values: FacetValue[], listed: FacetValue[])}
		<ul>
			{#each listed as v (v.value)}
				<li>
					{#if v.count === 0 && !active(facet, v.value)}
						<!-- Would leave no recipe with the filters on: greyed, in its place (the values never move). -->
						<span class="none" title={t.browse.facetNone}>
							<span class="v" class:pending={v.pending}>{label(facet, v.value)}</span>
							<span class="n">0</span>
						</span>
					{:else}
						<a
							href={toggle(facet, v.value)}
							data-sveltekit-noscroll
							data-sveltekit-keepfocus
							class:active={active(facet, v.value)}
							aria-current={active(facet, v.value) ? 'true' : undefined}
							onclick={hold}
							title={v.pending ? t.browse.pending : undefined}
						>
							<span class="v" class:pending={v.pending}>{label(facet, v.value)}</span>
							<span class="n">{v.count}</span>
						</a>
					{/if}
				</li>
			{/each}
		</ul>
		{#if expanded[facet] ? values.length > SHOWN : listed.length < values.length}
			<button class="btn quiet more" type="button" aria-expanded={!!expanded[facet]} onclick={() => (expanded[facet] = !expanded[facet])}>
				{expanded[facet] ? t.browse.less : t.browse.more(values.length - listed.length)}
			</button>
		{/if}
	{/snippet}

	<section class="results" class:railed={indexed}>
		<!-- The whole box, first page: three cards of ideas over the index. Gone on a search, a filter or another sort. -->
		{#if start.length}
			<!-- The whole box: a few filters to tap at once, without opening « Filtres ». -->
			<nav class="start" aria-label={t.browse.start.label}>
				<ul>
					{#each start as c (c.href)}
						<li><a href={c.href} data-sveltekit-noscroll>{c.label}</a></li>
					{/each}
				</ul>
			</nav>
		{/if}
		{#if ideas}
			<section class="ideas" class:all={moreIdeas} aria-labelledby="idees">
				<!-- A head that reads as an invitation, with what to make from what is at home (another page, not a filter). -->
				<div class="ideas-top">
					<h2 id="idees">{t.browse.ideas.title}</h2>
					<a class="pantry" href="/garde-manger">{t.browse.start.pantry}<span aria-hidden="true">&nbsp;›</span></a>
				</div>
				<ul id="idees-cartes" onscroll={ideaScroll}>
					{#if picked}
						<li class="idea random">
							<div class="idea-head">
								<h3>{t.browse.ideas.random}</h3>
								<button class="btn quiet reroll" type="button" onclick={() => pick++} aria-label={t.browse.ideas.another} title={t.browse.ideas.another}
									><span aria-hidden="true">↻</span><span class="word" aria-hidden="true">{t.browse.ideas.anotherShort}</span></button
								>
							</div>
							{#key picked.slug}
								<a class="pick" href="/r/{picked.slug}" aria-live="polite">
									<span class="t"><span class="kind"><SourceGlyph type={picked.source_type} labelled={false} /></span>{stripMarkers(picked.title)}</span>
									{#if picked.from || picked.total_s || picked.tag}<span class="f">{@render ideaLine(picked)}</span>{/if}
									{#if picked.src && !failed.has(picked.src)}<span class="scan"><img src={picked.src} alt="" decoding="async" onerror={() => fail(picked.src)} /></span>{/if}
								</a>
							{/key}
						</li>
					{/if}
					{#if ideas.season}
						{@const sl = t.season[ideas.season.season] ?? ideas.season.season}
						<li class="idea" class:extra={ideaAtSeason >= IDEA_ROW}>
							<!-- The heading is the way to the season's list: one target, the whole head. -->
							<a class="idea-head linked" href="/?saison={ideas.season.season}" aria-label={t.browse.ideas.seasonAllLabel(ideas.season.count, sl)}>
								<h3>{t.browse.ideas.season(sl)}</h3>
								<span class="all">{t.browse.ideas.seasonAll(ideas.season.count)}<span aria-hidden="true">&nbsp;›</span></span>
							</a>
							{@render ideaRows(ideas.season.cards)}
						</li>
					{/if}
					{#each ideas.rails as x, i (x.key)}
						{@const head = t.browse.ideas.rails[x.key] ?? x.key}
						<li class="idea" class:extra={ideaAtRail + i >= IDEA_ROW}>
							<a class="idea-head linked" href={x.href} aria-label="{head} — {t.browse.ideas.railAllLabel(x.key, x.count)}">
								<h3>{head}</h3>
								<span class="all">{t.browse.ideas.railAll(x.key, x.count)}<span aria-hidden="true">&nbsp;›</span></span>
							</a>
							{@render ideaRows(x.cards)}
						</li>
					{/each}
					{#if ideas.recent.length}
						<li class="idea" class:extra={ideaAtRail + ideas.rails.length >= IDEA_ROW}>
							<a class="idea-head linked" href="/?sort=added" aria-label={t.browse.ideas.recentAllLabel}>
								<h3>{t.browse.ideas.recent}</h3>
								<span class="all">{t.browse.ideas.recentAll}<span aria-hidden="true">&nbsp;›</span></span>
							</a>
							{@render ideaRows(ideas.recent)}
						</li>
					{/if}
				</ul>
				{#if ideaCount > IDEA_ROW}
					<!-- Wide screen: the other cards, in place, under the first row. -->
					<button class="btn quiet more-ideas" type="button" aria-expanded={moreIdeas} aria-controls="idees-cartes" onclick={() => (moreIdeas = !moreIdeas)}
						>{moreIdeas ? t.browse.ideas.less : t.browse.ideas.more}</button
					>
				{/if}
				{#if ideaCount > 1}
					<!-- Phone: which card of the row is in view (the row scrolls sideways). -->
					<p class="dots" aria-hidden="true">
						{#each { length: ideaCount } as _, i (i)}<span class:on={i === ideaAt}></span>{/each}
					</p>
				{/if}
			</section>
		{/if}
		{#snippet ideaLine(x: ReturnType<typeof idea>)}
			{@const bits = [x.from, x.total_s ? formatSeconds(x.total_s, locale()) : '', x.tag ? tagLabel(x.tag, data.tagLabels?.[x.tag]) : ''].filter(Boolean)}
			{bits.join(' · ')}
		{/snippet}
		{#snippet ideaRows(cards: ReturnType<typeof idea>[])}
			<ul class="rows">
				{#each cards as x (x.slug)}
					<li>
						<a href="/r/{x.slug}">
							<span class="tx">
								<span class="t">{stripMarkers(x.title)}</span>
								{#if x.from || x.total_s || x.tag}<span class="f">{@render ideaLine(x)}</span>{/if}
							</span>
							{#if x.src && failed.has(x.src)}<span class="thumb glyph" aria-hidden="true"><SourceGlyph type={x.source_type} labelled={false} /></span>{:else if x.src}<span class="thumb"
									><img src={x.src} alt="" loading="lazy" decoding="async" onerror={() => fail(x.src)} /></span
								>{/if}
						</a>
					</li>
				{/each}
			</ul>
		{/snippet}
		{#if chips.length}
			<!-- Wide screen: the active filters over the count, each removable. -->
			<div class="chips" role="group" aria-label={t.browse.active}>
				<a class="chip chip-clear" href={clearHref} data-sveltekit-noscroll>{t.browse.clear}</a>
				{#each chips as c (c.facet + '\u0000' + c.value)}
					<a class="chip" href={toggle(c.facet, c.value)} data-sveltekit-noscroll aria-label={t.browse.remove(c.prefix ? `${c.prefix} : ${c.label}` : c.label)}>
						{#if c.prefix}<span class="prefix">{c.prefix}&nbsp;:</span>{/if}
						<span>{c.label}</span>
						<span class="x" aria-hidden="true">×</span>
					</a>
				{/each}
			</div>
		{/if}
		{#if r.suggestion}
			<!-- A close spelling: offered over a few results; or searched when the typed words found nothing, said as such
			     (never « Aucune recette » over the rows it found), with the way back to the words as typed (`?exact=1`). -->
			<p class="respell">
				{#if r.suggestion.applied}{t.browse.respelled(r.suggestion.q, data.params.q ?? '')}<span class="sep" aria-hidden="true">·</span><a
						class="exact"
						href={href((s) => s.set('exact', '1'))}
						data-sveltekit-noscroll>{t.browse.searchExact}</a
					>{:else}{t.browse.didYouMean.before}<a
						href={href((s) => (s.set('q', r.suggestion!.q), s.delete('exact')))}
						data-sveltekit-noscroll>{t.app.quotes[0]}{r.suggestion.q}{t.app.quotes[1]}</a
					>{t.browse.didYouMean.after}{/if}
			</p>
		{/if}
		{#if r.also && !chips.length}
			<!-- A word for several ingredients (« poivron »): each by the name the box writes, a link that narrows. -->
			<p class="also">
				<span>{t.browse.also}</span>
				{#each r.also as a, i (a.q)}{#if i}<span class="sep" aria-hidden="true">·</span>{/if}<a
						href={href((s) => s.set('q', a.q))}
						class:apart={a.apart}
						data-sveltekit-noscroll
						title={a.apart ? `${t.browse.alsoApart} ${a.q}` : undefined}
						aria-label="{a.apart ? t.browse.alsoApart : t.browse.alsoLabel} « {a.q} », {t.browse.count(a.count)}">{a.q} <span class="n">({a.count})</span></a
					>{/each}
			</p>
		{/if}
		<div class="toolbar">
			<!-- Phone: one row — Filtres (how many are on), then how many recipes and the active filters, each with its ×. -->
			<button class="btn filters-btn" type="button" bind:this={filtersBtn} onclick={openSheet} aria-haspopup="dialog">
				{t.browse.showFilters}{#if activeCount}<span class="count-badge"
						><span aria-hidden="true">{activeCount}</span><span class="visually-hidden">{t.browse.activeCount(activeCount)}</span></span
					>{/if}
			</button>
			<div class="tail">
				<p class="summary" aria-live="polite">
					<span class="count">{t.browse.count(r.total)}</span>{#if r.suggestion?.applied}{' '}<span class="for">{t.browse.forQuery(r.q ?? '')}</span
						>{:else if data.params.q}{' '}<span class="for">{t.browse.forQuery(data.params.q)}</span>{/if}{#if !chips.length && !data.params.q}<span class="sorted">{t.browse.sortedBy(t.browse.sorts[currentSort] ?? '')}</span>{/if}
				</p>
				{#if chips.length}
					<ul class="row-chips" aria-label={t.browse.active}>
						<!-- First: never scrolled out of sight at the row's end. -->
						<li><a class="all" href={clearHref} data-sveltekit-noscroll>{t.browse.clear}</a></li>
						{#each chips as c (c.facet + '\u0000' + c.value)}
							<li>
								<a class="on" href={toggle(c.facet, c.value)} data-sveltekit-noscroll aria-label={t.browse.remove(c.prefix ? `${c.prefix} : ${c.label}` : c.label)}
									>{c.label}<span class="x" aria-hidden="true">×</span></a
								>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
			<label class="sort">
				<span>{t.browse.sort}</span>
				<select value={currentSort} onchange={(e) => sortTo(e.currentTarget.value)}>
					{#each sorts as [value, text] (value)}
						<option {value}>{text}</option>
					{/each}
				</select>
			</label>
		</div>
		{#if indexed && r.letters}
			<nav class="letters" aria-label={t.browse.letters}>
				<ul>
					<!-- Only the letters that have recipes: a greyed letter is a word to decode, not a way in. -->
					{#each railLetters as l (l.letter)}
						<li>
							<a
								href="{pageHref(l.page)}#{anchor(l.letter)}"
								class:here={here.includes(l.letter)}
								title="{t.browse.letter(l.letter, l.count)}, {t.browse.onPage(l.page)}"
								aria-label="{t.browse.letter(l.letter, l.count)}, {t.browse.onPage(l.page)}">{l.letter}</a
							>
						</li>
					{/each}
				</ul>
			</nav>
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -- the links inside are the keyboard's way; this is a finger sliding along them -->
			<nav
				class="rail"
				class:shown={railShown}
				aria-label={t.browse.letters}
				onpointerdown={railDown}
				onpointermove={railMove}
				onpointerup={railUp}
				onpointercancel={() => ((railActive = false), (scrub = null))}
				onclickcapture={railClick}
				style:--n={railLetters.length}
				style:top={railTop === null ? undefined : `${railTop}px`}
			>
				{#each railLetters as l (l.letter)}
					<a
						href="{pageHref(l.page)}#{anchor(l.letter)}"
						data-letter={l.letter}
						class:here={here.includes(l.letter)}
						class:on={scrub === l.letter}
						aria-label="{t.browse.letter(l.letter, l.count)}, {t.browse.onPage(l.page)}">{l.letter}</a
					>
				{/each}
			</nav>
			{#if scrub}<p class="scrub" aria-hidden="true" style:top="{scrubY}px">{scrub}</p>{/if}
		{/if}
		{#if r.items.length}
			<div class="cards" bind:this={cardsEl}>
				{#each groups as g (g.section ?? 'title')}
					{#if g.section}
						<h2 class="elsewhere" id="dans-{g.section}">{t.browse.section[g.section](g.count, searched)}</h2>
					{/if}
					<ul class="drawer" class:quiet={g.section} class:split={split !== null} aria-labelledby={g.section ? `dans-${g.section}` : undefined}>
						{#each g.entries as e, i (e.cards[0].slug)}
							{#if i === split}
								<!-- Two columns: the second starts here; inside a letter, with its tab again. -->
								<li class="colbreak" aria-hidden="true"></li>
								{#if !e.divider}
									<li class="divider cont" aria-hidden="true"><span class="tab">{t.browse.cont(letterOf(e.cards[0].initial))}</span></li>
								{/if}
							{/if}
							{#if e.divider}
								<li class="divider" role="none">
									<h2 id={anchor(e.divider)} class="tab">{#if i === 0 && begun(e.divider)}{t.browse.cont(e.divider)}{:else}{e.divider}{/if}</h2>
								</li>
							{/if}
							{#if e.cards.length === 1}
								<RecipeCard card={e.cards[0]} terms={r.terms} {upkeep} {reviewing} tagLabels={data.tagLabels ?? {}} rating={currentSort === 'rating'} {filters} />
							{:else}
								{@const c0 = e.cards[0]}
								<!-- Same title: one block — the title once, then a line per recipe, indented under it. -->
								<li class="same">
									<p class="same-head">
										<span class="kind"><SourceGlyph type={null} stack labelled={false} /></span>
										<span class="title" id="titre-{c0.slug}"><HitText text={c0.title} terms={r.terms} markers /></span>
										{#if e.family}
											<VariantsLink family={e.family} n={c0.family_size ?? e.cards.length} title={t.browse.compare} />
										{:else}
											<span class="n">{t.browse.sameTitle(e.cards.length)}</span>
										{/if}
									</p>
									<ul>
										{#each e.cards as card (card.slug)}
											<RecipeCard
												{card}
												terms={r.terms}
												{upkeep}
												{reviewing}
												tagLabels={data.tagLabels ?? {}}
												titleId="titre-{c0.slug}"
												family={!e.family}
												rating={currentSort === 'rating'}
												{filters}
											/>
										{/each}
									</ul>
								</li>
							{/if}
						{/each}
					</ul>
				{/each}
			</div>
			{#if r.pages > 1}
				<nav class="pager" aria-label={t.browse.pages}>
					<ol class="pages" bind:this={pagesEl}>
						{#each pages as p, i (p ? p.page : `gap-${i}`)}
							{#if p}
								<li>
									<a href={pageHref(p.page)} aria-current={p.page === r.page ? 'page' : undefined} aria-label={p.full} title={p.full}>{p.label}</a>
								</li>
							{:else}
								<li class="gap" aria-hidden="true">…</li>
							{/if}
						{/each}
					</ol>
					<div class="steps">
						{#if r.page > 1}<a class="btn" href={pageHref(r.page - 1)} rel="prev">{t.browse.prev}</a>{:else}<span></span>{/if}
						<p>
							<span class="where">{t.browse.page(r.page, r.pages)}</span>
							<span class="range">{guide ? t.browse.pageLetters(guide.first, guide.last) : t.browse.range(first, first + r.items.length - 1, r.total)}</span>
						</p>
						{#if r.page < r.pages}<a class="btn" href={pageHref(r.page + 1)} rel="next">{t.browse.next}</a>{:else}<span></span>{/if}
					</div>
				</nav>
			{/if}
		{:else if data.vaultEmpty}
			<p class="empty">{t.browse.emptyVault} <a href="/nouvelle">{tf.nav}</a></p>
		{:else}
			<!-- Nothing found: the filters that are on, with « Tout effacer »; else a word on the search alone. -->
			<div class="empty">
				{#if chips.length}
					<p>{t.browse.emptyFiltered}</p>
					<ul class="empty-chips" aria-label={t.browse.active}>
						{#each chips as c (c.facet + '\u0000' + c.value)}
							<li>
								<a class="chip" href={toggle(c.facet, c.value)} data-sveltekit-noscroll aria-label={t.browse.remove(c.prefix ? `${c.prefix} : ${c.label}` : c.label)}>
									{#if c.prefix}<span class="prefix">{c.prefix}&nbsp;:</span>{/if}
									<span>{c.label}</span>
									<span class="x" aria-hidden="true">×</span>
								</a>
							</li>
						{/each}
						<li><a class="chip chip-clear" href={clearHref} data-sveltekit-noscroll>{t.browse.clear}</a></li>
					</ul>
					{#if data.unfiltered}<p><a href={clearHref} data-sveltekit-noscroll>{t.browse.emptyUnfiltered(data.unfiltered)}</a></p>{/if}
				{:else if r.partial}
					<!-- The words together found nothing: each alone, a link when it finds some. -->
					<p>{t.browse.partial.none}</p>
					<ul class="partial" aria-label={t.browse.partial.label}>
						{#each r.partial as w (w.q)}
							<li>
								{#if w.count}
									<a href={href((s) => s.set('q', w.q))} data-sveltekit-noscroll
										>{t.browse.partial.alone(w.q)} : {t.browse.partial.count(w.count)}<span aria-hidden="true">&nbsp;›</span></a
									>
								{:else}
									<span class="none">{t.browse.partial.alone(w.q)} : {t.browse.partial.count(0)}</span>
								{/if}
							</li>
						{/each}
					</ul>
				{:else}
					<p>{t.browse.emptyQuery(data.params.q ?? '')}</p>
				{/if}
			</div>
		{/if}
	</section>
</div>

<style>
	/* Phone: the site header already names the page; the heading stays for a screen reader. */
	@media (max-width: 59.99rem) {
		.head :global(.page-head) {
			position: absolute;
			width: 1px;
			height: 1px;
			margin: 0;
			overflow: hidden;
			clip-path: inset(50%);
			white-space: nowrap;
		}
	}
	.search input {
		width: 100%;
		font-size: var(--step-1);
		min-height: 3rem;
		padding: 0.6rem 0.9rem;
		border-width: 2px;
		border-color: var(--ink);
		font-family: var(--serif);
	}
	/* The form's pencil, not the browser's grey. */
	.search input::placeholder {
		color: var(--pencil);
		opacity: 1;
	}
	/* A 320 px phone: room for the whole placeholder, never cut mid-word. */
	@media (max-width: 22rem) {
		.search input {
			padding-inline: 0.65rem;
		}
	}
	.problems {
		margin-top: 0.75rem;
		background: var(--danger-bg);
		border-left: 4px solid var(--danger);
		padding: 0.5rem 0.9rem;
	}
	.problems summary {
		cursor: pointer;
		font-weight: 600;
	}
	.problems > ul {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0;
	}
	.problems .file {
		font-weight: 600;
	}
	.problems .diags {
		padding: 0;
		margin: 0.2rem 0 0.6rem;
	}
	.problems .hint {
		font-size: var(--step--1);
		color: var(--ink-soft);
		margin: 0.25rem 0 0;
	}
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1.5rem;
		margin-top: 1.25rem;
	}
	@media (min-width: 60rem) {
		.layout {
			grid-template-columns: 14rem minmax(0, 1fr);
			gap: 2.25rem;
		}
		/* The filters stay beside the list as it scrolls, with a scroll of their own when taller than the window. */
		.facets {
			position: sticky;
			top: 1rem;
			align-self: start;
			max-height: calc(100vh - 2rem);
			max-height: calc(100dvh - 2rem);
			overflow-y: auto;
			overscroll-behavior: contain;
			scrollbar-width: thin;
			padding-right: 0.5rem;
			margin-right: -0.5rem;
		}
		.facets .sheet-head {
			position: sticky;
			top: 0;
			z-index: 1;
			background: var(--paper);
		}
	}
	.results {
		min-width: 0;
	}

	/* The line over the results: how many (for which search), and the sort. */
	.toolbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		margin-bottom: 0.75rem;
	}
	.tail {
		flex: 1 1 auto;
		min-width: 0;
	}
	.summary {
		margin: 0;
		min-width: 0;
		font-family: var(--serif);
		font-size: var(--step-0, 1rem);
		color: var(--ink);
	}
	.summary .count {
		font-weight: 700;
	}
	.sort {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.sort select {
		min-height: 2.5rem;
	}
	.close,
	.sheet-x,
	.filters-btn,
	.quick,
	.row-chips,
	.sorted,
	.facets .sorting,
	.rail {
		display: none;
	}

	/* Filters. */
	.facets h2 {
		font-size: var(--step-1);
	}
	.sheet-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}
	/* « Tout effacer » in the sheet's head: a finger's height. */
	.clear {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0 0.4rem;
		font-size: var(--step--1);
	}
	.facets section {
		margin-top: 0.6rem;
		border-top: 1px solid var(--edge);
		padding-top: 0.35rem;
	}
	.facets section.joined {
		margin-top: 0;
		border-top: none;
		padding-top: 0;
	}
	.facets summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 2rem;
		cursor: pointer;
		list-style: none;
		border-radius: var(--radius);
	}
	.facets summary::-webkit-details-marker {
		display: none;
	}
	/* A chevron that turns when the group opens. */
	.facets summary::after {
		content: '';
		width: 0.45rem;
		height: 0.45rem;
		margin-right: 0.25rem;
		border-right: 2px solid var(--ink-soft);
		border-bottom: 2px solid var(--ink-soft);
		transform: rotate(45deg) translateY(-0.15rem);
		transition: transform 0.12s;
	}
	.facets details:not([open]) summary::after {
		transform: rotate(-45deg);
	}
	@media (prefers-reduced-motion: reduce) {
		.facets summary::after {
			transition: none;
		}
	}
	.facets summary:hover h3 {
		color: var(--ink);
	}
	.facets h3 {
		margin: 0;
		font-family: var(--sans);
		font-size: var(--step--1);
		font-weight: 700;
		color: var(--ink-soft);
	}
	.facets ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.facets li a,
	.facets li .none {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.2rem 0.4rem;
		margin-inline: -0.4rem;
		border-radius: var(--radius);
		color: var(--ink);
		text-decoration: none;
	}
	/* A value that would leave nothing with the filters on: greyed, not a link — kept in its place so the list never moves under the pointer, and still readable (≈ 4:1, UI round 2). */
	.facets li .none {
		color: #78746b;
		cursor: default;
	}
	.facets li .none .n {
		color: inherit;
	}
	.facets li a:hover {
		background: var(--facet-hover, #e8edf3);
	}
	.facets li a.active {
		background: var(--ink);
		color: var(--card);
	}
	.facets .n {
		color: var(--ink-soft);
		font-variant-numeric: tabular-nums;
		font-size: var(--step--1);
	}
	.facets a.active .n {
		color: var(--facet-active-n, #cdd5e1);
	}
	.pending {
		font-style: italic;
	}
	.more {
		font-size: var(--step--1);
		min-height: 2rem;
		margin-left: -0.4rem;
	}

	/* Phone: the filters are a sheet over the list. */
	@media (max-width: 59.99rem) {
		.facets {
			display: none;
		}
		.facets.open {
			display: flex;
			flex-direction: column;
			position: fixed;
			inset: 0;
			z-index: 40;
			overflow-y: auto;
			overscroll-behavior: contain;
			overflow-anchor: none;
			background: var(--paper);
			padding: 0 1rem;
		}
		/* The sheet's head stays at the top with its ✕; its foot at the bottom, after the last group — never over it. */
		.facets.open .sheet-head {
			position: sticky;
			top: 0;
			z-index: 1;
			align-items: center;
			gap: 0.75rem;
			margin: 0 -1rem;
			padding: 0.4rem 0.5rem 0.4rem 1rem;
			background: var(--paper);
			border-bottom: 1px solid var(--edge);
		}
		.facets.open .sheet-head h2 {
			margin: 0;
			margin-right: auto;
		}
		.facets.open .sheet-x {
			display: grid;
			place-items: center;
			width: 2.75rem;
			height: 2.75rem;
			padding: 0;
			font-size: 1.25rem;
		}
		.facets.open .close {
			display: block;
			position: sticky;
			bottom: 0;
			margin: auto -1rem 0;
			padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom));
			background: var(--paper);
			border-top: 1px solid var(--edge);
		}
		.facets.open .close .btn {
			width: 100%;
			justify-content: center;
		}
		.facets summary,
		.facets li a,
		.facets li .none {
			min-height: 2.75rem;
			align-items: center;
		}
		.more {
			min-height: 2.75rem;
		}
		.layout {
			margin-top: 0.5rem;
		}
		.search input {
			min-height: 2.875rem;
			padding-block: 0.4rem;
		}
		/* The sort, first in the sheet. */
		.facets .sorting {
			display: block;
			margin-top: 0.4rem;
			border-top: none;
		}
		.sorting h3 {
			margin-bottom: 0.35rem;
		}
		.sorting select {
			width: 100%;
			min-height: 2.75rem;
		}
		/*
		 * Under the search box, one row: Filtres (how many are on), then how
		 * many recipes and what they are sorted by — or the active filters, each
		 * with its ×, and « Tout effacer ». The first recipe starts about 150 px
		 * under the header.
		 */
		.toolbar {
			flex-wrap: nowrap;
			gap: 0.6rem;
			margin-bottom: 0.5rem;
		}
		.filters-btn {
			display: inline-flex;
			align-items: center;
			flex: none;
			min-height: 2.75rem;
		}
		.sort,
		.results .chips {
			display: none;
		}
		.sorted {
			display: inline;
			color: var(--ink-soft);
		}
		.summary {
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			font-size: var(--step--1);
			color: var(--ink-soft);
		}
		.summary .count {
			color: var(--ink);
		}
		/*
		 * With filters on: Filtres and the count on the first line, then the
		 * active filters on lines of their own, wrapping — every one in sight
		 * (they are few), « Tout effacer » first.
		 */
		.toolbar:has(.row-chips) {
			flex-wrap: wrap;
			row-gap: 0.4rem;
		}
		.tail:has(.row-chips) {
			display: contents;
		}
		.tail:has(.row-chips) .summary {
			flex: 1 1 0;
		}
		.row-chips {
			flex: 1 0 100%;
			flex-wrap: wrap;
		}
		.row-chips,
		.quick {
			display: flex;
			gap: 0.4rem;
			list-style: none;
			margin: 0;
			padding: 0;
		}
		.row-chips li,
		.quick li {
			flex: none;
		}
		.row-chips a,
		.quick a {
			display: inline-flex;
			align-items: center;
			gap: 0.35rem;
			min-height: 2.75rem;
			padding: 0 0.85rem;
			border: 1px solid var(--edge);
			border-radius: 1.4rem;
			background: var(--card);
			color: var(--ink);
			text-decoration: none;
			font-size: var(--step--1);
			white-space: nowrap;
		}
		.row-chips a.on {
			border-color: var(--ink);
			font-weight: 600;
			padding-right: 0.55rem;
		}
		.row-chips a.all {
			border-style: dashed;
			color: var(--ink-soft);
		}
		.row-chips .x {
			display: inline-grid;
			place-items: center;
			width: 1.3rem;
			height: 1.3rem;
			border-radius: 50%;
			background: var(--ink);
			color: var(--card);
			font-size: 0.95rem;
			line-height: 1;
		}
		.row-chips a:active,
		.quick a:active {
			background: var(--paper);
		}
		/* While the search box has the focus: a few filters to tap, under it, in a row that scrolls sideways. */
		.quick {
			margin: 0.5rem -1rem 0;
			padding: 0 2.5rem 0 1rem;
			overflow-x: auto;
			scrollbar-width: none;
			-webkit-mask-image: linear-gradient(to right, #000 calc(100% - 2.5rem), transparent);
			mask-image: linear-gradient(to right, #000 calc(100% - 2.5rem), transparent);
		}
		.quick::-webkit-scrollbar {
			display: none;
		}
	}

	/*
	 * The drawer: one cream card of ruled rows (RecipeCard), read down the first
	 * column, then the second, like the index of a book: a letter's tab sits in
	 * the flow, so a short letter leaves no hole. One column on a phone.
	 */
	.drawer {
		list-style: none;
		margin: 0;
		padding: 0;
		background: var(--card);
		border: 1px solid var(--edge);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}
	@media (min-width: 48rem) {
		.drawer {
			columns: 2;
			column-gap: 0;
			column-rule: 1px solid var(--edge);
		}
		/* One row alone takes the width. */
		.drawer:not(:has(> :global(li:nth-child(2)))) {
			columns: 1;
		}
		/* Sorted by title: the page sets where the second column starts (columnSplit). */
		.colbreak {
			display: block;
			height: 0;
			break-before: column;
		}
	}
	@media (max-width: 47.99rem) {
		.colbreak,
		.divider.cont {
			display: none;
		}
	}
	/* Where the title does not hold the words: the same rows, in a quieter drawer. */
	.drawer.quiet {
		background: var(--drawer-quiet, #f7f4ec);
		box-shadow: none;
	}
	.drawer.quiet :global(.card:hover) {
		background: var(--card);
	}
	/*
	 * « Dans les ingrédients de 4 recettes », « Mentionnent aussi « tourtière » »:
	 * a quieter drawer's heading — the sans of the labels, in the soft ink,
	 * plainly not more of the results above.
	 */
	h2.elsewhere {
		margin: 1.75rem 0 0.5rem;
		font-family: var(--sans);
		font-size: 1rem;
		font-weight: 600;
		color: var(--ink-soft);
	}
	@media (max-width: 39.99rem) {
		.drawer {
			margin-inline: -0.25rem;
		}
	}
	/*
	 * The pager: each page by the letters it holds (sorted by title), the
	 * current one in ink; under it Précédentes / Page 2 sur 7 / Suivantes.
	 */
	.pager {
		margin-top: 1.5rem;
		color: var(--ink-soft);
	}
	.pages {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.3rem;
		list-style: none;
		margin: 0 0 0.75rem;
		padding: 0;
	}
	.pages a {
		display: grid;
		place-items: center;
		min-width: 2.75rem;
		min-height: 2.5rem;
		padding: 0 0.6rem;
		border: 1px solid var(--edge);
		border-radius: var(--radius);
		background: var(--card);
		color: var(--ink);
		font-family: var(--serif);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		text-decoration: none;
		white-space: nowrap;
	}
	.pages a:hover {
		border-color: var(--ink-soft);
	}
	.pages a[aria-current='page'] {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--card);
	}
	.pages .gap {
		align-self: center;
		padding: 0 0.2rem;
	}
	/* Phone: the pages in one row that scrolls sideways, fading at its edge — never a page alone on a second line. */
	@media (max-width: 39.99rem) {
		.pages {
			flex-wrap: nowrap;
			justify-content: flex-start;
			overflow-x: auto;
			scrollbar-width: none;
			padding: 0 1.5rem 0 0;
			-webkit-mask-image: linear-gradient(to right, #000 calc(100% - 1.5rem), transparent);
			mask-image: linear-gradient(to right, #000 calc(100% - 1.5rem), transparent);
		}
		.pages::-webkit-scrollbar {
			display: none;
		}
		.pages li {
			flex: none;
		}
	}
	@media (pointer: coarse) {
		.pages a {
			min-height: 2.75rem;
		}
	}
	.steps {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
	}
	.steps p {
		margin: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		line-height: 1.3;
	}
	.steps .where {
		color: var(--ink);
		font-weight: 600;
	}
	.steps .range {
		font-size: var(--step--1);
		font-variant-numeric: tabular-nums;
	}
	.steps .where {
		white-space: nowrap;
	}
	/* Phone: the row of pages above already says where this one starts and ends. */
	@media (max-width: 29.99rem) {
		.steps .range {
			display: none;
		}
	}
	/* The filter button's count of active filters. */
	.count-badge {
		display: inline-grid;
		place-items: center;
		min-width: 1.4rem;
		height: 1.4rem;
		padding: 0 0.35rem;
		margin-left: 0.45rem;
		border-radius: 0.7rem;
		background: var(--ink);
		color: var(--card);
		font-size: 0.8125rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	/* Active filters, each a chip that removes itself. */
	.chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.5rem;
		margin-bottom: 0.9rem;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 2.25rem;
		padding: 0.2rem 0.55rem 0.2rem 0.75rem;
		border: 1px solid var(--ink);
		border-radius: 1.2rem;
		background: var(--card);
		color: var(--ink);
		text-decoration: none;
		font-size: var(--step--1);
	}
	.chip .prefix {
		color: var(--ink-soft);
	}
	.chip .x {
		display: inline-grid;
		place-items: center;
		width: 1.3rem;
		height: 1.3rem;
		border-radius: 50%;
		color: var(--ink-soft);
		font-size: 1.05rem;
		line-height: 1;
	}
	.chip:hover .x {
		background: var(--ink);
		color: var(--card);
	}
	/* « Tout effacer », a chip of its own: dashed, it removes rather than names. */
	.chip-clear {
		padding-right: 0.75rem;
		border-style: dashed;
		border-color: var(--ink-soft);
		color: var(--ink-soft);
	}
	.chip-clear:hover {
		color: var(--ink);
		border-color: var(--ink);
	}
	@media (pointer: coarse) {
		.chip {
			min-height: 2.75rem;
		}
	}
	/* The recipe box's letter tabs (sorted by title); the letters of this page are underlined. */
	.letters ul {
		list-style: none;
		margin: 0 0 0.75rem;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem;
	}
	.letters a {
		display: grid;
		place-items: center;
		min-width: 1.75rem;
		height: 1.9rem;
		border-radius: var(--radius);
		font-family: var(--serif);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		text-decoration: none;
	}
	.letters a {
		color: var(--ink);
	}
	/* This page's letters: underlined in ink, like the tabs pulled forward. */
	.letters a.here {
		background: var(--card);
		box-shadow: inset 0 -2px 0 var(--ink);
	}
	.letters a:hover {
		background: var(--card);
		box-shadow: inset 0 0 0 1px var(--edge);
		color: var(--link);
	}
	/*
	 * Phone: the letters down the right edge, in a gutter of their own beside
	 * the drawer — only those that have recipes, each as tall as the screen
	 * allows (a finger's height with twenty letters). Tap one, or slide a
	 * finger along them: the letter under it shows large beside the finger,
	 * and the list follows. The letters of this page are in ink.
	 */
	@media (max-width: 59.99rem) {
		.letters {
			display: none;
		}
		/* From under the search box to over the tab bar: beside the list, never over the box or a row. */
		.rail {
			position: fixed;
			z-index: 30;
			right: 0;
			top: 8.5rem;
			bottom: 1rem;
			display: flex;
			flex-direction: column;
			justify-content: center;
			align-items: stretch;
			width: 1.9rem;
			touch-action: none;
			user-select: none;
			-webkit-user-select: none;
		}
		.rail:not(.shown) {
			visibility: hidden;
			opacity: 0;
		}
		.rail {
			transition:
				opacity 0.15s ease,
				visibility 0.15s;
		}
		.rail a {
			display: grid;
			place-items: center;
			flex: 1 1 0;
			max-height: 2.75rem;
			font-family: var(--serif);
			font-size: 0.8125rem;
			font-weight: 700;
			line-height: 1;
			text-decoration: none;
			color: var(--ink-soft);
		}
		.rail a.here {
			color: var(--ink);
		}
		.rail a.on {
			color: var(--card);
			background: var(--ink);
			border-radius: var(--radius) 0 0 var(--radius);
		}
		/* Room for the letters beside the list only: the filters and the ideas above it take the full width (the rail is hidden there). */
		.results.railed .cards,
		.results.railed .pager {
			margin-right: 1.15rem;
		}
		/* The letter under the finger, large, just left of it: the finger never covers it. */
		.scrub {
			position: fixed;
			z-index: 31;
			right: 3.25rem;
			translate: 0 -50%;
			display: grid;
			place-items: center;
			width: 3.75rem;
			height: 3.75rem;
			margin: 0;
			border-radius: 50%;
			background: var(--ink);
			color: var(--card);
			font-family: var(--serif);
			font-size: 2rem;
			font-weight: 700;
			box-shadow: 0 4px 16px rgb(28 42 66 / 0.25);
			pointer-events: none;
		}
	}
	@media (max-width: 40rem) {
		.rail {
			bottom: calc(4.5rem + env(safe-area-inset-bottom));
		}
	}
	/*
	 * A divider between letters, like the tabbed cards of a recipe box: a
	 * cream tab standing up from a buff rule, its capital in the serif of the
	 * titles. At the top of the second column (or of a page) inside a letter,
	 * the same tab says « B (suite) ».
	 */
	.divider {
		display: flex;
		align-items: flex-end;
		padding: 0.55rem 0.9rem 0 0.75rem;
		break-inside: avoid;
		break-after: avoid;
		scroll-margin-top: 1rem;
	}
	.divider .tab {
		margin: 0;
		min-width: 2.25rem;
		padding: 0.05rem 0.6rem 0;
		font-family: var(--serif);
		font-size: 1.125rem;
		font-weight: 700;
		line-height: 1.5;
		text-align: center;
		color: var(--ink);
		background: var(--tab-bg, var(--paper));
		border: 1px solid var(--edge);
		border-bottom: none;
		border-radius: 5px 5px 0 0;
		scroll-margin-top: 1rem;
	}
	.divider.cont .tab {
		font-size: 1rem;
		font-weight: 400;
		font-style: italic;
		color: var(--ink-soft);
	}
	.divider::after {
		content: '';
		flex: 1;
		border-bottom: 1px solid var(--edge);
	}
	/*
	 * Same title, one after the other: one block — the title once, with a
	 * stack of cards where the rows have their source's drawing, then a line
	 * per recipe, indented under it behind a rule, that leads with who it is
	 * from (RecipeCard's `titleId`), like a book's index under one word. A
	 * column never splits it.
	 */
	.same {
		container: row / inline-size;
		break-inside: avoid;
		border-bottom: 1px solid var(--edge);
		padding-bottom: 0.35rem;
	}
	.same-head {
		display: grid;
		grid-template-columns: 1.35rem minmax(0, auto) 1fr;
		column-gap: 0.6rem;
		align-items: baseline;
		margin: 0;
		padding: 0.5rem 0.9rem 0.2rem 0.75rem;
		font-family: var(--serif);
		font-size: 1.125rem;
		font-weight: 700;
		line-height: 1.3;
		color: var(--ink);
	}
	.same-head .kind {
		display: flex;
		align-self: start;
		padding-top: 0.1rem;
		font-size: 1.175rem;
	}
	.same-head .kind :global(.glyph) {
		color: var(--ink);
	}
	.same-head .title {
		min-width: 0;
	}
	/*
	 * « 3 fiches », right after the title: plain words, not a link — the rows
	 * under it are the cards. Apart from « ⧉ 4 variantes » (VariantsLink), the
	 * link to a family's page, in its place when the cards all belong to one.
	 */
	.same-head .n,
	.same-head :global(.variants) {
		justify-self: start;
		margin-left: 0.6rem;
	}
	.same-head .n {
		white-space: nowrap;
		font-family: var(--sans);
		font-size: 0.8125rem;
		font-weight: 400;
		color: var(--ink-soft);
	}
	/* The lines, indented to the title behind a rule of their own. */
	.same ul {
		list-style: none;
		margin: 0 0 0 1.55rem;
		padding: 0;
		border-left: 2px solid var(--edge);
	}
	/* Each line a finger's height (44 px), the whole line its recipe's link. */
	.same :global(.card.sub) {
		min-height: 2.75rem;
		align-items: center;
		padding-block: 0.25rem;
		padding-left: 0.55rem;
		border-bottom: none;
	}

	/*
	 * Over the index on the whole box's first page, three ideas for « qu'est-ce
	 * qu'on mange ? », each a small cream index card with ruled lines: one card
	 * at random (its scan when it has one, ↻ for another), a few of the
	 * season's, the last added. A row of three on a wide screen; on a phone
	 * a row that scrolls sideways, a card and a bit of the next in view.
	 */
	.ideas {
		margin-bottom: 1.1rem;
	}
	/* « Des idées », then « Avec ce que j'ai › »: the section reads as an invitation. */
	.ideas-top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		margin-bottom: 0.4rem;
	}
	.ideas-top h2 {
		margin: 0;
		font-family: var(--serif);
		font-size: var(--step-1);
		font-weight: 700;
		color: var(--ink);
	}
	.ideas-top .pantry {
		display: inline-flex;
		align-items: center;
		min-height: 2.25rem;
		font-size: var(--step--1);
		white-space: nowrap;
	}
	/* Wide screen: one row of three; « Plus d'idées » shows the others in place. The phone's sideways row holds them all. */
	@media (min-width: 48rem) {
		.ideas:not(.all) .idea.extra {
			display: none;
		}
	}
	.more-ideas {
		margin-top: 0.4rem;
		min-height: 2.25rem;
		font-size: var(--step--1);
	}
	@media (max-width: 47.99rem) {
		.more-ideas {
			display: none;
		}
	}
	.ideas > ul {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.75rem;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.idea {
		display: flex;
		flex-direction: column;
		min-width: 0;
		background: var(--card);
		border: 1px solid var(--edge);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: 0.35rem 0.8rem 0.45rem;
	}
	.idea-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		min-height: 2.25rem;
		font-family: var(--sans);
		font-size: var(--step--1);
		color: var(--ink-soft);
		border-bottom: 1px solid var(--edge);
	}
	.idea-head h3 {
		min-width: 0;
		margin: 0;
		font: inherit;
		font-weight: 700;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.idea-head .all {
		display: inline-grid;
		place-items: center;
		min-height: 2.25rem;
		padding: 0 0.2rem;
		font-weight: 400;
		white-space: nowrap;
	}
	/* ↻ Une autre: the drawing and the word, so it says what it does. */
	.reroll {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		min-height: 2.25rem;
		padding: 0 0.4rem;
		margin-right: -0.4rem;
		font-size: var(--step--1);
		font-weight: 400;
		color: var(--ink);
		white-space: nowrap;
	}
	.reroll > span:first-child {
		font-size: 1.15rem;
		line-height: 1;
	}
	/* The season's and the last added's head: one link to their whole list. */
	a.idea-head.linked {
		text-decoration: none;
		color: var(--ink-soft);
	}
	a.idea-head.linked .all {
		display: inline-flex;
		align-items: center;
		color: var(--link);
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}
	a.idea-head.linked:hover h3 {
		color: var(--ink);
		text-decoration: underline;
		text-underline-offset: 0.15em;
	}
	/* Phone: which card of the sideways row is in view. */
	.dots {
		display: none;
	}
	/* The rows: a card's ruled lines, a title each in the serif. */
	.idea .rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.idea .rows li + li {
		border-top: 1px solid var(--edge);
	}
	.idea .rows a {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 2.75rem;
		padding-block: 0.3rem;
		color: var(--ink);
		text-decoration: none;
		font-family: var(--serif);
		font-weight: 700;
		font-size: 0.9375rem;
		line-height: 1.25;
	}
	/* The title, then a quieter line: who it is from · its time · its course. */
	.idea .rows .tx {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.idea .rows .t,
	.idea .rows .f {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	/* A quieter line in the sans: at this size the serif's thin strokes blur on the cream. */
	.idea .rows .f {
		font-family: var(--sans);
		font-weight: 400;
		font-size: 0.875rem;
		line-height: 1.35;
		color: var(--ink-soft);
	}
	.idea .rows a:hover .t,
	.pick:hover .t {
		text-decoration: underline;
		text-decoration-thickness: 1px;
		text-underline-offset: 0.15em;
	}
	.idea .thumb {
		flex: none;
		width: 3rem;
		height: 2.1rem;
		overflow: hidden;
		border: 1px solid var(--edge);
		border-radius: 2px;
		background: var(--paper);
	}
	.idea .thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.idea .thumb.glyph {
		display: grid;
		place-items: center;
		color: var(--ink-soft);
	}
	/* The card at random: its title large, who it is from, its scan's corner when it has one. */
	.pick {
		flex: 1;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-rows: auto 1fr;
		column-gap: 0.7rem;
		padding-top: 0.6rem;
		color: var(--ink);
		text-decoration: none;
	}
	.pick .t {
		align-self: start;
		font-family: var(--serif);
		font-size: var(--step-1);
		font-weight: 700;
		line-height: 1.2;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.pick .kind {
		display: inline-flex;
		vertical-align: -0.1em;
		margin-right: 0.4rem;
		font-size: 1rem;
	}
	/* Who it is from, its time, its course: two lines at most, never clipped mid-letter. */
	.pick .f {
		grid-column: 1;
		align-self: start;
		margin-top: 0.15rem;
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		font-family: var(--sans);
		font-size: 0.875rem;
		line-height: 1.35;
		color: var(--ink-soft);
	}
	.pick .scan {
		grid-column: 2;
		grid-row: 1 / -1;
		align-self: center;
		width: 5rem;
		height: 4rem;
		position: relative;
		overflow: hidden;
		background: var(--paper);
		border: 1px solid var(--edge);
		border-radius: 2px;
	}
	.pick .scan img {
		position: absolute;
		left: -4%;
		top: -6%;
		width: 170%;
		height: auto;
		max-width: none;
	}
	@media (max-width: 47.99rem) {
		.ideas > ul {
			grid-template-columns: none;
			grid-auto-flow: column;
			grid-auto-columns: 82%;
			margin: -4px -1rem;
			padding: 4px 1rem;
			overflow-x: auto;
			scroll-snap-type: x mandatory;
			scroll-padding-inline: 1rem;
			scrollbar-width: none;
		}
		.ideas > ul::-webkit-scrollbar {
			display: none;
		}
		.idea {
			scroll-snap-align: start;
		}
		.idea-head,
		.idea-head .all,
		.idea .rows a,
		.ideas-top .pantry {
			min-height: 2.75rem;
		}
		.reroll {
			min-height: 2.75rem;
			gap: 0.2rem;
			font-size: 0.8125rem;
		}
		.dots {
			display: flex;
			justify-content: center;
			gap: 0.4rem;
			margin: 0.5rem 0 0;
		}
		.dots span {
			width: 0.45rem;
			height: 0.45rem;
			border-radius: 50%;
			background: var(--edge);
			transition: background-color 0.15s;
		}
		.dots span.on {
			background: var(--ink);
		}
		@media (prefers-reduced-motion: reduce) {
			.dots span {
				transition: none;
			}
		}
	}
	/* The whole box: a few filters to tap, under the search box, one row (it scrolls sideways on a phone). */
	.start ul {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		list-style: none;
		margin: 0 0 0.9rem;
		padding: 0;
	}
	.start a {
		display: inline-flex;
		align-items: center;
		min-height: 2.25rem;
		padding: 0 0.85rem;
		border: 1px solid var(--edge);
		border-radius: 1.4rem;
		background: var(--card);
		color: var(--ink);
		text-decoration: none;
		font-size: var(--step--1);
		white-space: nowrap;
	}
	.start a:hover {
		border-color: var(--ink);
	}
	/* A wide screen has these filters beside the list, in « Filtres ». */
	@media (min-width: 60rem) {
		.start {
			display: none;
		}
	}
	@media (max-width: 47.99rem) {
		/* One row that scrolls sideways: its right edge fades out over a chip's width, so a cut chip reads as « more this way ». */
		.start ul {
			flex-wrap: nowrap;
			margin: 0 -1rem 0.75rem;
			padding: 0 3rem 0 1rem;
			overflow-x: auto;
			scrollbar-width: none;
			-webkit-mask-image: linear-gradient(to right, #000 calc(100% - 3.5rem), rgb(0 0 0 / 0.15) calc(100% - 0.5rem), transparent);
			mask-image: linear-gradient(to right, #000 calc(100% - 3.5rem), rgb(0 0 0 / 0.15) calc(100% - 0.5rem), transparent);
		}
		.start ul::-webkit-scrollbar {
			display: none;
		}
		.start li {
			flex: none;
		}
	}
	@media (max-width: 47.99rem), (pointer: coarse) {
		.start a {
			min-height: 2.75rem;
		}
	}
	@media (max-width: 59.99rem) {
		.results.railed .start ul {
			margin-right: 1.15rem;
		}
	}
	/* « Aussi : piment vert (40) · piment rouge (17) »: the names a word stands for, each narrowing the list. */
	.also {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 0.5rem;
		margin: 0 0 0.5rem;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.also a {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		font-family: var(--serif);
		font-size: 1rem;
		font-weight: 700;
	}
	/* A name the word heads without meaning it: offered apart, in the plain weight. */
	.also a.apart {
		font-weight: 400;
	}
	.also .n {
		margin-left: 0.25em;
		font-family: var(--sans);
		font-size: var(--step--1);
		font-weight: 400;
		color: var(--ink-soft);
	}
	/* Nothing with every word: each word alone. */
	.partial {
		list-style: none;
		margin: 0.4rem 0 0;
		padding: 0;
	}
	.partial a,
	.partial .none {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
	}
	.partial a {
		font-weight: 700;
	}
	.respell {
		margin: 0 0 0.5rem;
		font-family: var(--serif);
		color: var(--ink);
	}
	.respell a {
		font-weight: 700;
	}
	/* « Chercher exactement »: small, after the line, the way back to the words as typed. */
	.respell .sep {
		margin: 0 0.4rem;
		color: var(--ink-soft);
	}
	.respell a.exact {
		font-family: var(--sans);
		font-size: var(--step--1);
		font-weight: 500;
		white-space: nowrap;
	}
	.empty-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 0.5rem;
		list-style: none;
		margin: 0.6rem 0 0.9rem;
		padding: 0;
		font-family: var(--sans);
	}
	.empty-chips .chip {
		min-height: 2.75rem;
	}
	.empty {
		padding: 1.5rem 0;
		color: var(--ink-soft);
		font-size: var(--step-1);
		font-family: var(--serif);
	}
	.empty p {
		margin: 0 0 0.5rem;
	}
</style>
