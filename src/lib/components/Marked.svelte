<script lang="ts">
	// A plain string with its markers styled. [+] reads as a word, « ajouté »,
	// in a small chip (app.css); its title says the rest.
	import { t } from '$lib/i18n';
	import { segments } from '$lib/render/markers';
	import { markerTitle } from '$lib/render/markdown';

	let { text }: { text: string } = $props();
	const parts = $derived(segments(text));
</script>

{#each parts as p, i (i)}{#if p.marker}<mark
			class="mk mk-{p.marker}"
			title={markerTitle(p.marker, p.marker === 'uncertain-alt' ? p.alternative : undefined)}>{p.marker === 'added' ? t.recipe.markerAdded : p.text}</mark
		>{:else}{p.text}{/if}{/each}
