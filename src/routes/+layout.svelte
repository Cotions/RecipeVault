<script lang="ts">
	import '../app.css';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { t, form as tf } from '$lib/i18n';
	import Toast from '$lib/components/Toast.svelte';
	import Menu from '$lib/components/Menu.svelte';
	import { setPrefs } from '$lib/prefs';
	import { setConversions } from '$lib/render/system';
	import { setUnitWords } from '$lib/render/unitwords';
	import { cookbar } from '$lib/cookbar.svelte';
	import CookChip from '$lib/components/CookChip.svelte';
	import { onMount } from 'svelte';

	let { children, data } = $props();

	// Hydrated: event handlers are attached (the e2e specs wait for it before a first tap).
	onMount(() => {
		document.documentElement.dataset.ready = '';
	});

	// The vault's unit words, installed before any page renders (server and
	// browser), and again when the layout data changes.
	// svelte-ignore state_referenced_locally
	setUnitWords(data?.unitWords);
	$effect.pre(() => setUnitWords(data?.unitWords));

	// What the signed-in person chose (language, measuring system, own unit
	// words), installed before anything renders. A page already shown does not
	// follow a change (signing in, saving /compte): it is loaded again. In the
	// browser only: the server serves several people at once, so the hook
	// answers per request there (module state would leak to the next one).
	// svelte-ignore state_referenced_locally
	const shownFor = JSON.stringify(data?.prefs ?? null);
	if (browser) {
		// svelte-ignore state_referenced_locally
		setPrefs(data?.prefs);
		// svelte-ignore state_referenced_locally
		setConversions(data?.conversions);
	}
	$effect(() => {
		if (JSON.stringify(data?.prefs ?? null) !== shownFor) location.reload();
	});

	const kitchen = $derived(page.url.pathname.endsWith('/cuisine'));
	const markdown = $derived(!!data?.user?.markdown);
	const here = $derived(page.url.pathname + page.url.search);
	// The pages read every day, always in sight.
	// Each with a small line drawing, shown in the phone's bottom bar.
	const nav = $derived([
		{ href: '/', label: t.app.nav.browse, icon: 'box', match: (p: string) => p === '/' || p.startsWith('/r/') },
		{ href: '/familles', label: t.app.nav.families, icon: 'cards', match: (p: string) => p.startsWith('/famille') },
		{ href: '/ingredients', label: t.app.nav.ingredients, icon: 'leaf', match: (p: string) => p.startsWith('/ingredients') },
		{ href: '/garde-manger', label: t.app.nav.pantry, icon: 'jar', match: (p: string) => p === '/garde-manger' }
	]);
	/** Writing a new recipe, by hand or by pasting: « Nouvelle recette » is the current place (an edit is the recipe's, under Recettes). */
	const writing = $derived(page.url.pathname === '/nouvelle' || page.url.pathname === '/ajouter');
	// Pages with their own bar at the bottom (the form's save bar): no tab bar under it on a phone.
	const editing = $derived(['/nouvelle', '/ajouter'].includes(page.url.pathname) || page.url.pathname.endsWith('/modifier'));
	// The rest, in the header's « Plus » menu: the Markdown tools for an
	// account that asked for them (plan 04, Q2 B), the trash, the account.
	// Each queue has its row always, in the same place (a queue that empties
	// keeps its row, with nothing after it), and says after its name only what
	// is new and waits for her (« Étiquettes · 3 à décider », « Doublons · 1
	// nouveau »), after the backlog's total in the soft ink for À relier and
	// Doublons (« Doublons · 74 · 1 nouveau », UI round 2: a backlog with no
	// number read as nothing to do). The button's number
	// (« Plus · 3 ») is what waits for a decision and is news: the tags to
	// accept, the duplicate cards holding a recipe saved since this device's
	// mark (lib/server/seen.ts; /doublons moves it once it has shown them). The
	// part of a line the number counts is in ink (`stamp`); the button's
	// tooltip says what it counts. Nothing new: no
	// mark on the button at all (usability round 4: a lone dot said nothing).
	type MoreItem = { href: string; label: string; match: (p: string) => boolean; stamp?: string; total?: number };
	const fresh = $derived({ tags: data?.pendingTags ?? 0, dups: data?.freshDuplicates ?? 0 });
	const more = $derived<MoreItem[]>([
		...(markdown ? [{ href: '/ajouter', label: t.app.nav.add, match: (p: string) => p === '/ajouter' }] : []),
		...(markdown
			? [
					{ href: '/resoudre', label: t.app.nav.queue, total: data?.queueTotal ?? 0, match: (p: string) => p === '/resoudre' },
					{ href: '/etiquettes', label: t.app.nav.pendingTags, stamp: fresh.tags ? t.app.toDecide(fresh.tags) : undefined, match: (p: string) => p === '/etiquettes' },
					{ href: '/doublons', label: t.app.nav.duplicates, total: data?.duplicates ?? 0, stamp: fresh.dups ? t.app.freshPart(fresh.dups) : undefined, match: (p: string) => p.startsWith('/doublons') }
				]
			: []),
		// The trash is for whoever can put a recipe there and take it back: signed in.
		...(data?.user ? [{ href: '/corbeille', label: t.app.nav.trash, match: (p: string) => p === '/corbeille' }] : [])
	]);
	/** One of « Plus »'s pages is the one shown (Ajouter aside: « Nouvelle recette » shows it): the button gets the tabs' underline. */
	const inMore = $derived(page.url.pathname === '/compte' || more.some((m) => m.href !== '/ajouter' && m.match(page.url.pathname)));
	/** Decisions waiting in the Markdown tools, on the menu's button (PLANNING.md, « Plus »). */
	const waiting = $derived(markdown ? fresh.tags + fresh.dups : 0);
	const signIn = $derived(here === '/' ? '/connexion' : `/connexion?suite=${encodeURIComponent(here)}`);

	// Phone, on a recipe: the tab bar steps out of the way while reading down
	// and comes back at the first move up (or near the top). Never while focus
	// is in it; reduced motion moves it without the slide (app.css).
	const reading = $derived(page.url.pathname.startsWith('/r/'));
	let tabs: HTMLElement | undefined = $state();
	let tucked = $state(false);
	let lastY = 0;
	function onscroll() {
		const y = window.scrollY;
		const dy = y - lastY;
		if (Math.abs(dy) < 6) return;
		lastY = y;
		tucked = reading && dy > 0 && y > 120 && !tabs?.contains(document.activeElement);
	}
	$effect(() => {
		void page.url.pathname;
		tucked = false;
		lastY = window.scrollY;
	});
</script>

<svelte:window {onscroll} />

<svelte:head>
	<!-- A file, not an import: Vite would inline it as a 3.5 kB data URL in every page; a file is fetched once and cached. -->
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
	<meta name="theme-color" content="#1c2a42" />
	<meta name="description" content={t.app.description} />
</svelte:head>

{#if kitchen}
	{@render children()}
{:else}
	<a class="skip visually-hidden" href="#main">{t.app.skip}</a>
	<header class="site no-print" class:editing>
		<div class="bar">
			<!-- The app's own name, « Boîte à recettes », with its mark: a card standing in a navy box. Not « Recettes », the tab beside it. -->
			<a class="wordmark" href="/"
				><svg class="mark" viewBox="0 0 26 22" aria-hidden="true"
					><rect x="5.25" y="0.75" width="15.5" height="12" rx="1" fill="var(--card)" stroke="currentColor" stroke-width="1.3" /><path d="M5.6 3.9h14.8" stroke="var(--rule-red)" stroke-width="1.3" /><path d="M8 6.9h10M8 9.4h7" stroke="var(--rule-blue)" stroke-width="1.1" /><path
						d="M1.5 9.5h23l-1.2 11a1 1 0 0 1-1 .9H3.7a1 1 0 0 1-1-.9z"
						fill="currentColor"
					/><rect x="10" y="13" width="6" height="3.2" rx="0.6" fill="var(--card)" /></svg
				><span>{t.app.name}</span></a
			>
			<nav aria-label={t.app.navLabel} bind:this={tabs} class:tucked onfocusin={() => (tucked = false)}>
				{#each nav as item (item.href)}
					<a href={item.href} aria-current={item.match(page.url.pathname) ? 'page' : undefined}
						><svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
							{#if item.icon === 'box'}<path d="M3 9h18v11H3zM5 9V5h14v4M9 13h6" />
							{:else if item.icon === 'cards'}<path d="M7 4h13v12H7zM4 7v13h13" /><path d="M10 8h7M10 11h5" />
							{:else if item.icon === 'leaf'}<path d="M5 19C5 10 10 5 20 4c0 10-5 15-14 15zM5 19l8-8" />
							{:else}<path d="M7 3h10v3H7zM6 6h12l1 3v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9z" /><path d="M5 12h14" />{/if}
						</svg><span>{item.label}</span></a
					>
				{/each}
				{#if reading && cookbar.href && cookbar.offscreen}
					<!-- Phone, on a recipe, once the head's Cuisiner is out of sight: the same link as a fifth cell, in ink. -->
					<a class="cook" href={cookbar.href} data-testid="cook-bar"
						><svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
							><path d="M4 11h16v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3zM2 11h20M9.5 7.5c0-1.2 1.2-1.3 1.2-2.5M13.5 7.5c0-1.2 1.2-1.3 1.2-2.5" /></svg
						><span>{cookbar.label ?? t.recipe.cookMode}</span></a
					>
				{/if}
			</nav>
			<!-- A cook in progress on this device: its soonest timer, a tap back to kitchen mode. -->
			<CookChip signedIn={!!data?.user} />
			<div class="account">
				<!-- The recipe form (plan 04, Phase 4), for anyone signed in. Quiet: most
				     people here read and cook; the filled ink is for Cuisiner and Enregistrer.
				     A « + » on a phone. Current on every page that writes a recipe. -->
				{#if data?.user}
					<a class="btn new" href="/nouvelle" title={tf.nav} aria-current={page.url.pathname === '/nouvelle' ? 'page' : writing ? 'true' : undefined}
						><span class="plus" aria-hidden="true">+</span><span class="new-label">{tf.nav}</span></a
					>
				{:else if page.url.pathname !== '/connexion'}
					<a class="signin" href={signIn}>{t.auth.signIn}</a>
				{/if}
				<!-- Signed out, nothing in it: no « Plus » at all (« Se connecter » is beside it). -->
				{#if more.length || data?.user}
					<Menu label={t.app.moreLabel} text={t.app.more} badge={waiting} badgeLabel={t.app.waiting(fresh.tags, fresh.dups)} current={inMore} testid="more">
						{#if editing}
							<!-- Phone, on a form page: no tab bar under the save bar, so the four pages head « Plus » (usability round 5). -->
							<div class="phone-pages" data-testid="more-pages">
								{#each nav as item (item.href)}
									<a href={item.href} aria-current={item.match(page.url.pathname) ? 'page' : undefined}>{item.label}</a>
								{/each}
								<hr />
							</div>
						{/if}
						{#each more as item (item.href)}
							<a class="q-line" href={item.href} aria-current={item.match(page.url.pathname) ? 'page' : undefined}
								><span>{item.label}</span>{#if item.total}<span class="q-status"
										><span class="q-sep" aria-hidden="true">·</span><span class="visually-hidden"> · </span>{item.total}</span
									>{/if}{#if item.stamp}<span class="q-status"
										><span class="q-sep" aria-hidden="true">·</span><span class="visually-hidden"> · </span><span class="q-new">{item.stamp}</span></span
									>{/if}</a
							>
						{/each}
						{#if data?.user}
							<hr />
							<a class="who" href="/compte" title={t.account.linkTitle} aria-current={page.url.pathname === '/compte' ? 'page' : undefined}>{data.user.name}</a>
							<form method="POST" action="/connexion?/logout">
								<button type="submit">{t.auth.signOut}</button>
							</form>
						{/if}
					</Menu>
				{/if}
			</div>
		</div>
	</header>
	<main id="main">
		{@render children()}
	</main>
{/if}
<Toast />

<style>
	.skip:focus {
		position: fixed !important;
		top: 0.5rem;
		left: 0.5rem;
		width: auto;
		height: auto;
		clip: auto;
		background: var(--card);
		padding: 0.5rem 1rem;
		z-index: 100;
	}
	header.site {
		background: var(--card);
		/* the red header rule of an index card */
		border-bottom: 3px solid var(--rule-red);
	}
	.bar {
		max-width: 76rem;
		margin: 0 auto;
		padding: 0.5rem 1rem;
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.25rem 1.5rem;
	}
	.wordmark {
		font-family: var(--serif);
		font-size: var(--step-2);
		font-weight: 700;
		color: var(--ink);
		text-decoration: none;
		letter-spacing: -0.01em;
	}
	nav {
		display: flex;
		gap: 0.1rem 1.1rem;
		flex-wrap: wrap;
	}
	nav a {
		color: var(--ink-soft);
		text-decoration: none;
		font-weight: 500;
		padding: 0.35rem 0;
		border-bottom: 2px solid transparent;
	}
	nav a:hover {
		color: var(--ink);
	}
	nav a[aria-current='page'] {
		color: var(--ink);
		border-bottom-color: var(--ink);
	}
	.account {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	/* The header's two buttons, quiet: a warm outline, ink under the pointer. */
	.new,
	.account :global(summary.btn) {
		border-color: var(--field-edge);
	}
	/* What is new in a queue and waits for her, in words at its item's end in
	   « Plus », in ink, sentence case (what the button's number counts). */
	.q-status {
		color: var(--ink-soft);
		font-size: var(--step--1);
		font-weight: 400;
		font-variant-numeric: tabular-nums;
	}
	/* « Doublons · 1 nouveau »: the count after the name, not pushed to the far edge. */
	header a.q-line {
		justify-content: flex-start;
		gap: 0;
	}
	.q-sep {
		margin: 0 0.4rem;
	}
	.q-new {
		color: var(--ink);
		font-weight: 600;
	}
	/* The four pages in « Plus »: only where the tab bar is gone (a phone, on a form page). */
	.phone-pages {
		display: none;
	}
	/* The bar's Cuisiner: a phone thing only. */
	.cook {
		display: none;
	}
	.new:hover,
	.account :global(summary.btn:hover) {
		border-color: var(--ink);
	}
	.plus {
		font-size: 1.25em;
		line-height: 1;
		font-weight: 500;
	}
	/* Current like a tab: the ink line under it, as under the tabs; the
	   button itself unchanged (a pressed ground read as stuck). */
	.new,
	.account :global(summary.btn) {
		position: relative;
	}
	.new[aria-current]::after,
	.account :global(summary.btn.current)::after {
		content: '';
		position: absolute;
		left: 0.5rem;
		right: 0.5rem;
		bottom: -0.45rem;
		height: 2px;
		background: var(--ink);
	}
	.signin {
		color: var(--ink-soft);
		font-weight: 500;
		text-underline-offset: 0.2em;
	}
	.wordmark {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		white-space: nowrap;
	}
	.mark {
		width: 1.85rem;
		height: 1.55rem;
		flex: none;
		margin-top: -0.2rem;
	}
	nav .icon {
		display: none;
	}
	/* Phone: the wordmark and the actions at the top; the pages in a bar at the
	   bottom, under the thumb (not on the form pages, which have their save bar there). */
	@media (max-width: 40rem) {
		.bar {
			gap: 0.25rem 0.75rem;
		}
		nav {
			position: fixed;
			inset: auto 0 0 0;
			z-index: 35;
			display: grid;
			grid-template-columns: repeat(4, minmax(0, 1fr));
			gap: 0;
			background: var(--card);
			border-top: 1px solid var(--edge);
			box-shadow: 0 -2px 12px rgb(60 50 30 / 0.08);
			padding-bottom: env(safe-area-inset-bottom);
		}
		nav a {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 0.1rem;
			min-height: 3.5rem;
			padding: 0.35rem 0.25rem;
			border-bottom: 0;
			border-top: 2px solid transparent;
			font-size: 0.8125rem;
			line-height: 1.1;
			text-align: center;
			white-space: nowrap;
			letter-spacing: -0.01em;
		}
		/* A very narrow phone: « Garde-manger » still on one line. */
		@media (max-width: 22.5rem) {
			nav a {
				font-size: 0.75rem;
			}
		}
		nav a[aria-current='page'] {
			border-top-color: var(--ink);
			color: var(--ink);
			font-weight: 700;
		}
		nav {
			transition: transform 0.2s ease;
		}
		nav.tucked {
			transform: translateY(calc(100% + 2px));
			box-shadow: none;
		}
		nav .icon {
			display: block;
			width: 1.5rem;
			height: 1.5rem;
		}
		/* On a recipe, with the head's Cuisiner out of sight: a fifth cell,
		   wider, solid ink; the four tabs keep their places. */
		nav:has(.cook) {
			grid-template-columns: repeat(4, minmax(0, 1fr)) auto;
		}
		nav:has(.cook) a {
			padding-inline: 0.1rem;
		}
		nav a.cook {
			display: flex;
			margin: 0.35rem 0.35rem 0.35rem 0.1rem;
			padding-inline: 0.7rem;
			min-height: 2.9rem;
			border: 0;
			border-radius: var(--radius);
			background: var(--ink);
			color: #fff;
			font-weight: 700;
			font-size: 0.8125rem;
		}
		nav a.cook:hover {
			color: #fff;
			background: #2b3d5c;
		}
		.editing nav {
			display: none;
		}
		.editing .phone-pages {
			display: contents;
		}
		.wordmark {
			font-size: 1.3rem;
			gap: 0.4rem;
		}
		.wordmark .mark {
			width: 1.55rem;
			height: 1.3rem;
		}
	}
	/* Up to a laptop's width, a « + » the size of a thumb, so the header stays
	   one row; its name stays « Nouvelle recette ». */
	@media (max-width: 56rem) {
		.new {
			justify-content: center;
			width: 2.75rem;
			min-height: 2.75rem;
			padding: 0;
		}
		.new .plus {
			font-size: 1.6rem;
		}
		.new-label {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
			white-space: nowrap;
		}
	}
	main {
		max-width: 76rem;
		margin: 0 auto;
		padding: 1.25rem 1rem 4rem;
	}
	@media (max-width: 40rem) {
		main {
			padding-bottom: 7rem;
		}
	}
	@media print {
		main {
			padding: 0;
			max-width: none;
		}
	}
</style>
