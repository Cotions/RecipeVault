<script lang="ts">
	// The app's toast (src/lib/toast.svelte.ts): a status line with at most one
	// action ("Annuler", "Rétablir") and a link. Rendered once, by the layout.
	import { toast } from '$lib/toast.svelte';

	let busy = $state(false);

	async function run() {
		const a = toast.current?.toast.action;
		if (!a || busy) return;
		busy = true;
		try {
			await a.run();
		} finally {
			busy = false;
		}
	}
</script>

<div class="toast-slot no-print" role="status" aria-live="polite">
	{#if toast.current}
		{@const t = toast.current.toast}
		<div class="toast" class:error={t.error} data-testid="toast">
			<span class="text">{t.text}</span>
			{#if t.link}<a href={t.link.href}>{t.link.label}</a>{/if}
			{#if t.action}
				<button type="button" class="act" disabled={busy} onclick={run}>{t.action.label}</button>
			{/if}
			<button type="button" class="close" aria-label="Fermer" onclick={() => toast.close()}>✕</button>
		</div>
	{/if}
</div>

<style>
	.toast {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 1rem;
	}
	.toast.error {
		background: var(--rule-red);
	}
	.text {
		flex: 1 1 12rem;
	}
	.act,
	.close {
		min-height: 44px;
		min-width: 44px;
		background: none;
		border: 1.5px solid rgba(255, 255, 255, 0.7);
		border-radius: var(--radius);
		color: #fff;
		font-weight: 700;
		cursor: pointer;
		padding: 0 0.9rem;
	}
	.close {
		border-color: transparent;
		padding: 0;
	}
	.act:disabled {
		opacity: 0.6;
	}
</style>
