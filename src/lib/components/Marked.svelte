<script lang="ts">
	// A plain string with its markers styled.
	import { segments } from '$lib/render/markers';
	import { markerTitle } from '$lib/render/markdown';

	let { text }: { text: string } = $props();
	const parts = $derived(segments(text));
</script>

{#each parts as p, i (i)}{#if p.marker}<mark
			class="mk mk-{p.marker}"
			title={markerTitle(p.marker, p.marker === 'uncertain-alt' ? p.alternative : undefined)}>{p.text}</mark
		>{:else}{p.text}{/if}{/each}
