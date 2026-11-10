<script lang="ts">
	// « ⧉ 3 variantes »: the link from a list row (or a same-title group's
	// head) to its family's page — the Variantes tab's drawing, then the count.
	// It follows the title, never the provenance, so it never takes the width
	// of who the recipe is from. A narrow row (a phone) keeps the drawing and
	// the number; the link's name keeps the words.
	import { t } from '$lib/i18n';
	import SourceGlyph from './SourceGlyph.svelte';

	let { family, n, title }: { family: string; n: number; title?: string } = $props();
	const label = $derived(t.families.variants(n));
</script>

<a class="variants" href="/famille/{family}" {title} aria-label={label}
	><SourceGlyph type={null} variants labelled={false} /><span class="n">{n}<span class="word">{label.slice(String(n).length)}</span></span></a
>

<style>
	/* Above a row-wide link, so it goes to the family page. */
	.variants {
		position: relative;
		z-index: 1;
		flex: none;
		display: inline-block;
		font-family: var(--sans);
		font-size: 0.8125rem;
		font-weight: 400;
		line-height: 1;
		white-space: nowrap;
		color: var(--ink-soft);
		text-decoration: none;
		font-variant-numeric: tabular-nums;
	}
	/* The drawing sits on the line, beside the words: the link keeps the text's baseline. */
	.variants :global(.glyph) {
		width: 1.3em;
		height: 1.3em;
		margin-right: 0.3em;
		vertical-align: -0.3em;
		color: currentColor;
	}
	.n {
		text-decoration: underline;
		text-decoration-color: var(--edge);
		text-underline-offset: 0.2em;
	}
	.variants:hover {
		color: var(--link);
	}
	.variants:hover .n {
		text-decoration-color: currentColor;
	}
	/* A narrow row: the drawing and the number (« ⧉ 3 »), the words in the link's name. */
	@container row (max-width: 26rem) {
		.word {
			display: none;
		}
	}
	/* A finger's target: 44 px, without moving the line. */
	@media (pointer: coarse) {
		.variants {
			padding: 0.75rem 0.45rem;
			margin: -0.75rem -0.45rem;
		}
	}
</style>
