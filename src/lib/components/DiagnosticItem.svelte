<script lang="ts">
	// One checker diagnostic for a person: the French explanation and place,
	// who settles it, and the checker's own English message behind "Détail
	// technique" (it carries the specifics: the values, the suggested fix).
	import { t } from '$lib/i18n/fr';
	import { explain, fixerText, placeOf, type PlaceContext } from '$lib/i18n/diagnostics';
	import { fixerOf } from '$lib/vault/codes';

	interface Props {
		d: { code: string; path: string | null; message: string; fix?: string; severity?: string };
		/** The parsed file, to name groups, ingredients and sections. */
		file?: PlaceContext;
		/** Say who settles it (the paste box: the app here, or the AI through the fix-request block). */
		who?: boolean;
	}

	let { d, file, who = false }: Props = $props();
	const place = $derived(placeOf(d.path, file));
	const fixer = $derived(fixerOf(d.code));
</script>

<li class="diag-item {d.severity ?? 'error'}">
	<code class="code">{d.code || '—'}</code>
	<span class="text">{d.code ? explain(d.code) : d.message}</span>
	{#if place}<span class="where">{place}</span>{/if}
	{#if who && d.severity !== 'info'}<span class="who {fixer}">{fixerText[fixer]}</span>{/if}
	<details class="tech">
		<summary>{t.diagnostics.technical}</summary>
		<p>
			{#if d.path}<code class="path">{d.path}</code>{/if}
			<span lang="en">{d.message}</span>
			{#if d.fix}<span class="fix" lang="en">{d.fix}</span>{/if}
		</p>
	</details>
</li>

<style>
	.diag-item {
		padding: 0.45rem 0;
		border-bottom: 1px solid var(--rule-blue);
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem 0.5rem;
		align-items: baseline;
		list-style: none;
	}
	.code {
		font-weight: 700;
		font-size: var(--step--1);
	}
	.error .code {
		color: var(--rule-red);
	}
	.text {
		flex: 1 1 16rem;
	}
	.where {
		flex-basis: 100%;
		font-size: var(--step--1);
		color: var(--ink-soft);
		font-weight: 600;
	}
	.who {
		flex-basis: 100%;
		font-size: var(--step--1);
		color: var(--link);
	}
	.tech {
		flex-basis: 100%;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.tech summary {
		cursor: pointer;
		width: fit-content;
	}
	.tech p {
		margin: 0.25rem 0 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.5rem;
	}
	.path {
		font-size: 0.9em;
	}
	.fix {
		flex-basis: 100%;
	}
</style>
