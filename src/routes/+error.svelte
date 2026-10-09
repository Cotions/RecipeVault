<script lang="ts">
	import { page } from '$app/state';
	import { t } from '$lib/i18n/fr';

	// SvelteKit's own messages are English status texts; ours (error(404, '…')) are French and kept.
	const DEFAULTS = new Set(['Not Found', 'Internal Error', 'Method Not Allowed', 'Forbidden', 'Bad Request']);
	const raw = $derived(page.error?.message ?? '');
	const message = $derived(raw && !DEFAULTS.has(raw) ? raw : page.status === 404 ? t.error.notFound : t.error.generic);
</script>

<svelte:head><title>{message}</title></svelte:head>

<h1>{page.status}</h1>
<p>{message}</p>
<p><a href="/">{t.error.home}</a></p>
