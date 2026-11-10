<script lang="ts">
	// "Ajouter une photo" (plan 04, Phase 6; Q13 A): a file picker that, on a
	// phone, offers the camera and the gallery. Sends to /api/photo with the hash
	// of the recipe file the page showed, then reloads the page's data. Signed
	// out, it is a link to the sign-in page instead (writes need a session).
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { t } from '$lib/i18n';
	import { toast } from '$lib/toast.svelte';

	let {
		slug,
		hash,
		label = t.photo.add,
		menu = false
	}: {
		slug: string;
		hash: string;
		label?: string;
		/** An item of a ⋯ menu: a row like the others, no box, no help line; the menu closes once a photo is chosen and what follows is said in the toast. */
		menu?: boolean;
	} = $props();

	/** Same cap as the server (src/lib/server/photos.ts, PHOTO_MAX_BYTES): refused here without sending 25 MB over kitchen wifi. */
	const MAX_MB = 25;
	let busy = $state(false);
	let shown = $state<{ text: string; ok: boolean } | null>(null);
	/** In a menu, said in the toast (the menu is closed by then); else under the button. */
	const message = {
		get current() {
			return shown;
		},
		set(m: { text: string; ok: boolean } | null) {
			if (!menu) shown = m;
			else if (m) toast.show({ text: m.text, error: !m.ok }, m.ok ? 0 : 10_000);
			else toast.close();
		}
	};
	const signIn = $derived(`/connexion?suite=${encodeURIComponent(`/r/${slug}`)}`);

	async function send(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (menu) input.closest('details')?.removeAttribute('open');
		if (file.size > MAX_MB * 1024 * 1024) {
			message.set({ text: t.photo.tooBig(MAX_MB), ok: false });
			return;
		}
		busy = true;
		message.set({ text: t.photo.sending, ok: true });
		const body = new FormData();
		body.set('slug', slug);
		body.set('hash', hash);
		body.set('photo', file);
		try {
			const res = await fetch('/api/photo', { method: 'POST', body });
			const data = await res.json().catch(() => ({}));
			if (res.status === 401) {
				location.href = signIn;
				return;
			}
			if (!res.ok) {
				message.set({ text: data.message ? `${t.photo.failed} (${data.message})` : t.photo.failed, ok: false });
				return;
			}
			// The page reloads its data: the photo (or the HEIC placeholder) takes this prompt's place.
			await invalidateAll();
			message.set(null);
		} catch {
			message.set({ text: t.photo.offline, ok: false });
		} finally {
			busy = false;
		}
	}
</script>

<div class="upload no-print" class:menu>
	{#if page.data.user}
		<label class:btn={!menu} class:busy aria-busy={busy}>
			<input type="file" accept="image/*" disabled={busy} onchange={send} data-testid="photo-input" />
			{label}
		</label>
	{:else}
		<a class:btn={!menu} href={signIn}>{label}</a>
	{/if}
	{#if !menu}<span class="help">{t.photo.addHelp}</span>{/if}
	{#if message.current}<p class="msg" class:error={!message.current.ok} role="status">{message.current.text}</p>{/if}
</div>

<style>
	.upload {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.75rem;
		padding: 0.9rem 1rem;
		border: 1px dashed var(--line);
		border-radius: var(--radius);
	}
	/* A row of the ⋯ menu, like its links and buttons (Menu.svelte). */
	.menu {
		display: contents;
	}
	.menu label,
	.menu a {
		display: flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0.4rem 1rem;
		color: var(--ink);
		font-weight: 500;
		text-decoration: none;
		white-space: nowrap;
	}
	.menu label:hover {
		background: #f3eee2;
	}
	.menu label:focus-within {
		outline-offset: -3px;
	}
	label {
		position: relative;
		cursor: pointer;
	}
	/* The native control stays in the page (keyboard, screen readers) but is drawn by the label. */
	input {
		position: absolute;
		inset: 0;
		opacity: 0;
		width: 100%;
		cursor: pointer;
	}
	label:focus-within {
		outline: 2px solid currentColor;
		outline-offset: 2px;
	}
	.busy {
		opacity: 0.6;
	}
	.help {
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.msg {
		flex-basis: 100%;
		margin: 0;
		font-size: var(--step--1);
	}
	.msg.error {
		color: var(--rule-red);
	}
</style>
