<script lang="ts">
	// A plain string with its markers styled.
	import { segments } from '$lib/render/markers';
	import { MARKER_TITLES } from '$lib/render/markdown';

	let { text }: { text: string } = $props();
	const parts = $derived(segments(text));
</script>

{#each parts as p, i (i)}{#if p.marker}<mark
			class="mk mk-{p.marker}"
			title={p.marker === 'uncertain-alt' ? `${MARKER_TITLES[p.marker]} ${p.alternative}` : MARKER_TITLES[p.marker]}>{p.text}</mark
		>{:else}{p.text}{/if}{/each}
