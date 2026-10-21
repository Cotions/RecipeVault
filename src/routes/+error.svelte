<script lang="ts">
	import { page } from '$app/state';
	import { t } from '$lib/i18n';
	import PageHead from '$lib/components/PageHead.svelte';

	// SvelteKit's own messages are English status texts; ours (error(404, '…')) are in the person's language and kept.
	const DEFAULTS = new Set(['Not Found', 'Internal Error', 'Method Not Allowed', 'Forbidden', 'Bad Request']);
	const raw = $derived(page.error?.message ?? '');
	const message = $derived(raw && !DEFAULTS.has(raw) ? raw : page.status === 404 ? t.error.notFound : t.error.generic);
</script>

<svelte:head><title>{message} — {t.app.name}</title></svelte:head>

<PageHead kicker={String(page.status)} title={message} />
<p><a href="/">{t.error.home}</a></p>
