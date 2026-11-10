<script lang="ts">
	// The kind of source, as a small line drawing: a family card (with its red
	// rule), a book, a clipping, a site, a show, a pencil (written here); a
	// plain card when the recipe does not say; a pile of cards filed one
	// behind the other for several recipes under one title (the list's
	// same-title group); two cards side by side, offset, for a family's
	// variants (the Variantes tab's drawing). The recipe page sets it before
	// the provenance; the list at the start of a row.
	import { t } from '$lib/i18n';

	let {
		type,
		/** Read out by a screen reader; off where the words beside it already say it. */
		labelled = true,
		/** Several recipes under one title: a pile of cards (`type` is then ignored). */
		stack = false,
		/** A family's variants: the Variantes tab's drawing (`type` is then ignored). */
		variants = false
	}: { type: string | null | undefined; labelled?: boolean; stack?: boolean; variants?: boolean } = $props();
	const label = $derived(
		variants ? t.browse.glyphVariants : stack ? t.browse.glyphStack : type ? (t.source[type] ?? type) : t.browse.unknownFrom
	);
</script>

<svg
	class="glyph"
	viewBox="0 0 20 20"
	role={labelled ? 'img' : undefined}
	aria-label={labelled ? label : undefined}
	aria-hidden={labelled ? undefined : 'true'}
	fill="none"
	stroke="currentColor"
	stroke-width="1.4"
	stroke-linecap="round"
	stroke-linejoin="round"
>
	<title>{label}</title>
	{#if variants}<path d="M6 3.5h11v10H6zM3.5 6v10.5h10.5" /><path d="M8.5 7h6M8.5 9.5h4" stroke-width="1.1" />
	{:else if stack}<path d="M5.5 3h9M4 5.5h12" stroke-width="1.1" /><rect x="2.5" y="8" width="15" height="9" rx="1" /><path d="M5 11.25h10M5 13.75h6" stroke-width="1.1" />
	{:else if type === 'family'}<rect x="2.5" y="4" width="15" height="12" rx="1" /><path d="M2.5 7.5h15" stroke="var(--rule-red)" /><path d="M5 10.5h10M5 13h7" stroke-width="1.1" />
	{:else if type === 'book'}<path d="M10 5.6C8.2 4.4 5.6 4.1 3 4.4v10.8c2.6-.3 5.2 0 7 1.2 1.8-1.2 4.4-1.5 7-1.2V4.4c-2.6-.3-5.2 0-7 1.2zM10 5.6v10.8" />
	{:else if type === 'magazine'}<rect x="3" y="3" width="14" height="14" stroke-dasharray="2.2 1.6" /><path d="M6 7h8M6 10h8M6 13h5" stroke-width="1.1" />
	{:else if type === 'website'}<circle cx="10" cy="10" r="6.75" /><path d="M3.5 10h13M10 3.25c1.9 1.9 2.8 4.2 2.8 6.75s-.9 4.85-2.8 6.75M10 3.25C8.1 5.15 7.2 7.45 7.2 10s.9 4.85 2.8 6.75" stroke-width="1.1" />
	{:else if type === 'tv'}<rect x="2.5" y="5.5" width="15" height="10" rx="1.5" /><path d="M7 2.5l3 3 3-3M7 17.5h6" />
	{:else if type === 'invented'}<path d="M4.5 15.5l.9-3.6 8-8 2.7 2.7-8 8zM12 5.3l2.7 2.7" />
	{:else}<rect x="2.5" y="4" width="15" height="12" rx="1" /><path d="M5 8h10M5 10.75h10M5 13.5h6" stroke-width="1.1" stroke-dasharray="1.6 1.4" />{/if}
</svg>

<style>
	.glyph {
		flex: none;
		width: 1.15em;
		height: 1.15em;
		color: var(--ink-soft);
	}
</style>
