<script lang="ts">
	// A plain string with the words a search matched marked (render/hits.ts),
	// and, with `markers`, its inline markers styled as Marked does — except
	// [+], which in a list's title is a small raised « + » (its title says
	// « ajouté à la transcription »), not the recipe page's « ajouté » chip
	// (usability round 4). Text only: nothing here is read as HTML.
	import { t } from '$lib/i18n';
	import { hitSegments } from '$lib/render/hits';
	import { markerTitle } from '$lib/render/markdown';
	import { segments } from '$lib/render/markers';

	let { text, terms = [], markers = false }: { text: string; terms?: string[]; markers?: boolean } = $props();
	const parts = $derived(markers ? segments(text) : [{ text, marker: undefined, alternative: undefined }]);
</script>

{#each parts as p, i (i)}{#if p.marker === 'added'}<mark class="mk mk-added plus" title={markerTitle('added')}
			><span aria-hidden="true">+</span><span class="visually-hidden">{t.recipe.markerAdded}</span></mark
		>{:else if p.marker}<mark
			class="mk mk-{p.marker}"
			title={markerTitle(p.marker, p.marker === 'uncertain-alt' ? p.alternative : undefined)}>{p.text}</mark
		>{:else}{#each hitSegments(p.text, terms) as s, j (j)}{#if s.hit}<mark class="hit">{s.text}</mark>{:else}{s.text}{/if}{/each}{/if}{/each}

<style>
	/* [+] in a list: a pencil « + » raised after the word, no chip. */
	.plus {
		display: inline;
		border: 0;
		padding: 0 0 0 0.1em;
		font-size: 0.7em;
		vertical-align: super;
		line-height: 0;
		color: var(--pencil);
	}
	/* Not the highlighter yellow: that means an uncertain reading. */
	.hit {
		background: var(--hit-bg, #dbe6f3);
		color: inherit;
		font-weight: 700;
		border-radius: 2px;
		padding: 0 0.05em;
		box-decoration-break: clone;
		-webkit-box-decoration-break: clone;
	}
</style>
