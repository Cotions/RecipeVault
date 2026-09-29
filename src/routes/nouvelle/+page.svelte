<script lang="ts">
	import RecipeForm from '$lib/components/form/RecipeForm.svelte';
	import { t, form as f } from '$lib/i18n/fr';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{f.newTitle} — {t.app.name}</title>
</svelte:head>

<RecipeForm {data} />
