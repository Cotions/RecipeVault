<script lang="ts">
	import { enhance } from '$app/forms';
	import { t } from '$lib/i18n/fr';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let busy = $state(false);
</script>

<svelte:head><title>{t.auth.title} — {t.app.name}</title></svelte:head>

<h1>{t.auth.title}</h1>

{#if data.signedIn}
	<p class="intro">{t.auth.signedIn(data.signedIn)}</p>
	<form method="POST" action="?/logout">
		<button class="btn" type="submit">{t.auth.signOut}</button>
	</form>
{:else}
	<p class="intro">{t.auth.intro}</p>
	{#if form?.message}
		<p class="flash error" role="alert">{form.message}</p>
	{/if}
	<form
		class="signin"
		method="POST"
		action="?/login"
		use:enhance={() => {
			busy = true;
			return async ({ update }) => {
				await update({ reset: false });
				busy = false;
			};
		}}
	>
		<input type="hidden" name="suite" value={data.next} />
		<label>
			<span>{t.auth.login}</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input type="text" name="login" autocomplete="username" autocapitalize="none" spellcheck="false" required autofocus value={form?.login ?? ''} />
		</label>
		<label>
			<span>{t.auth.password}</span>
			<input type="password" name="password" autocomplete="current-password" required />
		</label>
		<label class="stay">
			<input type="checkbox" name="rester" checked={form?.persistent ?? true} />
			<span>{t.auth.stay}</span>
		</label>
		<button class="btn primary" type="submit" disabled={busy}>{t.auth.submit}</button>
	</form>
	<p class="hint">{t.auth.noAccount}</p>
{/if}

<style>
	h1 {
		font-size: var(--step-3);
	}
	.intro {
		color: var(--ink-soft);
		font-family: var(--serif);
		font-size: var(--step-1);
		margin: 0.25rem 0 1.25rem;
		max-width: var(--measure);
	}
	.signin {
		display: grid;
		gap: 1rem;
		max-width: 22rem;
	}
	.signin label {
		display: grid;
		gap: 0.3rem;
		font-weight: 600;
	}
	.signin input[type='text'],
	.signin input[type='password'] {
		border: 1.5px solid #b7c0cc;
		border-radius: var(--radius);
		background: var(--card);
		padding: 0.55rem 0.7rem;
		min-height: 2.9rem;
		font-size: 1.05rem;
	}
	.signin .stay {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-weight: 500;
		min-height: 2.75rem;
	}
	.stay input {
		width: 1.4rem;
		height: 1.4rem;
	}
	.signin .btn {
		min-height: 2.9rem;
		justify-self: start;
	}
	.flash {
		padding: 0.6rem 1rem;
		border-radius: var(--radius);
		max-width: 22rem;
	}
	.flash.error {
		background: #fbeaea;
		color: var(--rule-red);
	}
	.hint {
		color: var(--ink-soft);
		font-size: var(--step--1, 0.9rem);
		margin-top: 1.5rem;
	}
</style>
