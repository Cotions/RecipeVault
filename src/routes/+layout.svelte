<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { t, form as tf } from '$lib/i18n';
	import Toast from '$lib/components/Toast.svelte';
	import Menu from '$lib/components/Menu.svelte';
	import { setPrefs } from '$lib/prefs';
	import { setConversions } from '$lib/render/system';
	import { setUnitWords } from '$lib/render/unitwords';

	let { children, data } = $props();

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
	const nav = $derived([
		{ href: '/', label: t.app.nav.browse, match: (p: string) => p === '/' || p.startsWith('/r/') },
		{ href: '/familles', label: t.app.nav.families, match: (p: string) => p.startsWith('/famille') },
		{ href: '/ingredients', label: t.app.nav.ingredients, match: (p: string) => p.startsWith('/ingredients') },
		{ href: '/garde-manger', label: t.app.nav.pantry, match: (p: string) => p === '/garde-manger' }
	]);
	// The rest, in the header's « Plus » menu: the Markdown tools for an
	// account that asked for them (plan 04, Q2 B), the trash, the account.
	const more = $derived([
		...(markdown ? [{ href: '/ajouter', label: t.app.nav.add, match: (p: string) => p === '/ajouter' }] : []),
		...(markdown && data?.toResolve ? [{ href: '/resoudre', label: t.app.nav.queue(data.toResolve), match: (p: string) => p === '/resoudre' }] : []),
		...(markdown && data?.pendingTags ? [{ href: '/etiquettes', label: t.app.nav.pendingTags(data.pendingTags), match: (p: string) => p === '/etiquettes' }] : []),
		...(markdown && data?.duplicates ? [{ href: '/doublons', label: t.app.nav.duplicates(data.duplicates), match: (p: string) => p.startsWith('/doublons') }] : []),
		{ href: '/corbeille', label: t.app.nav.trash, match: (p: string) => p === '/corbeille' }
	]);
	/** Things waiting in the Markdown tools, shown on the menu's button. */
	const waiting = $derived(markdown ? (data?.toResolve ?? 0) + (data?.pendingTags ?? 0) + (data?.duplicates ?? 0) : 0);
	const signIn = $derived(here === '/' ? '/connexion' : `/connexion?suite=${encodeURIComponent(here)}`);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#1c2a42" />
	<meta name="description" content={t.app.description} />
</svelte:head>

{#if kitchen}
	{@render children()}
{:else}
	<a class="skip visually-hidden" href="#main">{t.app.skip}</a>
	<header class="site no-print">
		<div class="bar">
			<a class="wordmark" href="/">{t.app.name}</a>
			<nav aria-label={t.app.navLabel}>
				{#each nav as item (item.href)}
					<a href={item.href} aria-current={item.match(page.url.pathname) ? 'page' : undefined}>{item.label}</a>
				{/each}
			</nav>
			<div class="account">
				<!-- The recipe form (plan 04, Phase 4), for anyone signed in: the one action of every page. -->
				{#if data?.user}
					<a class="btn primary new" href="/nouvelle" aria-current={page.url.pathname === '/nouvelle' ? 'page' : undefined}>{tf.nav}</a>
				{:else if page.url.pathname !== '/connexion'}
					<a class="signin" href={signIn}>{t.auth.signIn}</a>
				{/if}
				<Menu label={t.app.moreLabel} text={t.app.more} badge={waiting} testid="more">
					{#each more as item (item.href)}
						<a href={item.href} aria-current={item.match(page.url.pathname) ? 'page' : undefined}>{item.label}</a>
					{/each}
					{#if data?.user}
						<hr />
						<a class="who" href="/compte" title={t.account.linkTitle} aria-current={page.url.pathname === '/compte' ? 'page' : undefined}>{data.user.name}</a>
						<form method="POST" action="/connexion?/logout">
							<button type="submit">{t.auth.signOut}</button>
						</form>
					{/if}
				</Menu>
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
	.new[aria-current='page'] {
		box-shadow: 0 0 0 2px var(--card), 0 0 0 4px var(--ink);
	}
	.signin {
		color: var(--ink-soft);
		font-weight: 500;
		text-underline-offset: 0.2em;
	}
	/* Phone: the wordmark and the actions on the first line, the pages under them. */
	@media (max-width: 40rem) {
		.bar {
			gap: 0.25rem 0.75rem;
		}
		nav {
			order: 3;
			flex-basis: 100%;
			overflow-x: auto;
			flex-wrap: nowrap;
			scrollbar-width: none;
		}
		nav a {
			white-space: nowrap;
		}
	}
	main {
		max-width: 76rem;
		margin: 0 auto;
		padding: 1.25rem 1rem 4rem;
	}
	@media print {
		main {
			padding: 0;
			max-width: none;
		}
	}
</style>
