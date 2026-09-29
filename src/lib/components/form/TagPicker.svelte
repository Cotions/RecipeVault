<script lang="ts" module>
	export interface TagVocab {
		tags: [string, string][];
		canonical: { tag: string; label: string; aliases: string[] }[];
		pending: string[];
	}
</script>

<script lang="ts">
	// Tags (plan 04, Phase 5.2; Q11 B): autocomplete over the vault's tags and
	// their aliases, shown by their French label. A tag not in the list is
	// kept as she typed it and waits, pending, for the owner (/etiquettes);
	// when a known tag is two letters away it is offered instead (W501).
	import Suggest, { type Option } from './Suggest.svelte';
	import { classifyTag, type TagStatus } from '$lib/vault/tagstatus';
	import { fold } from '$lib/vault/normalize';
	import { form as f } from '$lib/i18n/fr-form';
	import { tagLabel } from '$lib/i18n/fr';
	import { formHintText } from '$lib/i18n/diagnostics';

	let { tags = $bindable(), vocab, labels = {} }: { tags: string[]; vocab: TagVocab; labels?: Record<string, string> } = $props();

	const map = $derived(new Map(vocab.tags));
	const pending = $derived(new Set(vocab.pending));
	let query = $state('');
	const status = (t: string): TagStatus => classifyTag(map, pending, t);
	const label = (t: string) => {
		const s = status(t);
		return s.status === 'known' ? tagLabel(s.canonical, labels[s.canonical]) : t;
	};

	function load(q: string): Option[] {
		const k = fold(q);
		const have = new Set(tags.map((t) => { const s = status(t); return s.status === 'known' ? s.canonical : t; }));
		const list: Option[] = vocab.canonical
			.filter((c) => !have.has(c.tag) && (!k || fold(c.label).includes(k) || c.tag.includes(k.replace(/\s+/g, '-')) || c.aliases.some((a) => fold(a).includes(k))))
			.slice(0, 8)
			.map((c) => ({ value: c.tag, label: tagLabel(c.tag, labels[c.tag] ?? c.label) }));
		const s = q.trim() ? status(q) : undefined;
		if (s && s.status !== 'known' && s.status !== 'empty' && !tags.includes(q.trim())) list.push({ value: q.trim(), label: f.tagAdd(q.trim()), meta: f.tagNew, special: true });
		return list;
	}

	function add(t: string) {
		const s = status(t);
		const v = s.status === 'known' ? s.canonical : t.trim();
		if (v && !tags.includes(v)) tags.push(v);
		query = '';
	}
</script>

<div class="tags" data-testid="tags">
	<ul class="chips" aria-label={f.tags}>
		{#each tags as t, i (i)}
			{@const s = status(t)}
			<li class:pending={s.status !== 'known'}>
				<span>{label(t)}</span>
				{#if s.status === 'pending' || s.status === 'new'}<small>{f.tagNew}</small>{/if}
				<button type="button" aria-label={f.tagRemove(label(t))} onclick={() => tags.splice(i, 1)}>✕</button>
			</li>
			{#if (s.status === 'pending' || s.status === 'new') && s.suggestion}
				<li class="hint">
					{formHintText.W501({ value: t, suggestion: tagLabel(s.suggestion, labels[s.suggestion]) })}
					<button
						type="button"
						class="btn"
						onclick={() => {
							const sug = s.suggestion!;
							tags.splice(i, 1, ...(tags.includes(sug) ? [] : [sug]));
						}}>{f.useSuggestion(tagLabel(s.suggestion, labels[s.suggestion]))}</button
					>
				</li>
			{/if}
		{/each}
	</ul>
	<Suggest
		id="tag-search"
		label={f.tagSearch}
		bind:value={query}
		{load}
		onpick={(o) => add(o.value)}
		onenter={() => query.trim() && add(query)}
		autocapitalize="none"
		testid="tag-search"
	/>
</div>

<style>
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		list-style: none;
		margin: 0 0 0.4rem;
		padding: 0;
	}
	.chips li {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding-left: 0.6rem;
		border: 1.5px solid var(--ink);
		border-radius: 999px;
		background: var(--card);
	}
	.chips li.pending {
		border-style: dashed;
		border-color: var(--pencil);
	}
	.chips li.hint {
		flex-basis: 100%;
		border: 0;
		border-left: 3px solid var(--link);
		border-radius: 0;
		background: #eef2f7;
		padding: 0.3rem 0.6rem;
		font-size: var(--step--1);
		flex-wrap: wrap;
	}
	small {
		color: var(--pencil);
		font-size: 0.8em;
	}
	.chips button:not(.btn) {
		min-width: 44px;
		min-height: 40px;
		border: 0;
		background: none;
		cursor: pointer;
		color: var(--ink-soft);
		border-radius: 999px;
	}
	.hint .btn {
		min-height: 44px;
	}
</style>
