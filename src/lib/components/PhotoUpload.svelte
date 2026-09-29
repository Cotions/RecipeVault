<script lang="ts">
	// "Ajouter une photo" (plan 04, Phase 6; Q13 A): a file picker that, on a
	// phone, offers the camera and the gallery. Sends to /api/photo with the hash
	// of the recipe file the page showed, then reloads the page's data. Signed
	// out, it is a link to the sign-in page instead (writes need a session).
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { t } from '$lib/i18n/fr';

	let { slug, hash, label = t.photo.add }: { slug: string; hash: string; label?: string } = $props();

	/** Same cap as the server (src/lib/server/photos.ts, PHOTO_MAX_BYTES): refused here without sending 25 MB over kitchen wifi. */
	const MAX_MB = 25;
	let busy = $state(false);
	let message = $state<{ text: string; ok: boolean } | null>(null);
	const signIn = $derived(`/connexion?suite=${encodeURIComponent(`/r/${slug}`)}`);

	async function send(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (file.size > MAX_MB * 1024 * 1024) {
			message = { text: t.photo.tooBig(MAX_MB), ok: false };
			return;
		}
		busy = true;
		message = { text: t.photo.sending, ok: true };
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
				message = { text: data.message ? `${t.photo.failed} (${data.message})` : t.photo.failed, ok: false };
				return;
			}
			// The page reloads its data: the photo (or the HEIC placeholder) takes this prompt's place.
			message = null;
			await invalidateAll();
		} catch {
			message = { text: t.photo.offline, ok: false };
		} finally {
			busy = false;
		}
	}
</script>

<div class="upload no-print">
	{#if page.data.user}
		<label class="btn" class:busy aria-busy={busy}>
			<input type="file" accept="image/*" disabled={busy} onchange={send} data-testid="photo-input" />
			{label}
		</label>
	{:else}
		<a class="btn" href={signIn}>{label}</a>
	{/if}
	<span class="help">{t.photo.addHelp}</span>
	{#if message}<p class="msg" class:error={!message.ok} role="status">{message.text}</p>{/if}
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
