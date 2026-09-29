<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { t, form as tf } from '$lib/i18n/fr';
	import Toast from '$lib/components/Toast.svelte';

	let { children, data } = $props();

	const kitchen = $derived(page.url.pathname.endsWith('/cuisine'));
	const markdown = $derived(!!data?.user?.markdown);
	const here = $derived(page.url.pathname + page.url.search);
	const nav = $derived([
		{ href: '/', label: t.app.nav.browse, match: (p: string) => p === '/' || p.startsWith('/r/') },
		{ href: '/familles', label: t.app.nav.families, match: (p: string) => p.startsWith('/famille') },
		{ href: '/ingredients', label: t.app.nav.ingredients, match: (p: string) => p.startsWith('/ingredients') },
		{ href: '/garde-manger', label: t.app.nav.pantry, match: (p: string) => p === '/garde-manger' },
		// The recipe form (plan 04, Phase 4), for anyone signed in.
		...(data?.user ? [{ href: '/nouvelle', label: tf.nav, match: (p: string) => p === '/nouvelle' }] : []),
		// The Markdown tools, for an account that asked for them (plan 04, Q2 B).
		...(markdown ? [{ href: '/ajouter', label: t.app.nav.add, match: (p: string) => p === '/ajouter' }] : []),
		...(markdown && data?.toResolve ? [{ href: '/resoudre', label: t.app.nav.queue(data.toResolve), match: (p: string) => p === '/resoudre' }] : []),
		...(markdown && data?.pendingTags ? [{ href: '/etiquettes', label: t.app.nav.pendingTags(data.pendingTags), match: (p: string) => p === '/etiquettes' }] : []),
		{ href: '/corbeille', label: t.app.nav.trash, match: (p: string) => p === '/corbeille' }
	]);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#1c2a42" />
</svelte:head>

{#if kitchen}
	{@render children()}
{:else}
	<a class="skip visually-hidden" href="#main">{t.app.skip}</a>
	<header class="site no-print">
		<div class="bar">
			<a class="wordmark" href="/">{t.app.name}</a>
			<nav aria-label="Principale">
				{#each nav as item (item.href)}
					<a href={item.href} aria-current={item.match(page.url.pathname) ? 'page' : undefined}>{item.label}</a>
				{/each}
			</nav>
			<div class="account">
				{#if data?.user}
					<span class="who" title={t.auth.signedInAs}>{data.user.name}</span>
					<form method="POST" action="/connexion?/logout">
						<button class="linkish" type="submit">{t.auth.signOut}</button>
					</form>
				{:else if page.url.pathname !== '/connexion'}
					<a href={here === '/' ? '/connexion' : `/connexion?suite=${encodeURIComponent(here)}`}>{t.auth.signIn}</a>
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
		padding: 0.6rem 1rem 0.5rem;
		display: flex;
		align-items: baseline;
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
		align-items: baseline;
		gap: 0.75rem;
		font-size: 0.95rem;
	}
	.account form {
		display: inline;
	}
	.who {
		color: var(--ink);
		font-weight: 600;
	}
	.account a,
	.linkish {
		color: var(--ink-soft);
		font: inherit;
		font-weight: 500;
		background: none;
		border: 0;
		padding: 0.35rem 0;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 0.2em;
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
