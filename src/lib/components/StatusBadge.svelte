<script lang="ts">
	import { t } from '$lib/i18n/fr';

	let { status, broken = false }: { status: string | null | undefined; broken?: boolean } = $props();
</script>

{#if broken}
	<span class="badge broken">{t.card.broken}</span>
{:else if status}
	<span class="badge {status}">{t.status[status] ?? status}</span>
{/if}
