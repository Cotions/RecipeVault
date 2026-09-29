<script lang="ts">
	// The markers of one form field (plan 04, Q15 A), shown under it — never
	// their syntax: the uncertain reading highlighted as on the recipe page,
	// its other reading as a button, and "C'est bien ça"; text the transcriber
	// added in pencil. Nothing once she edits the field (editing settles them).
	import { confirmField, fieldMarkers, type Written } from '$lib/form';
	import { form as f } from '$lib/i18n/fr-form';
	import type { Lang } from '$lib/vault/types';
	import { withAlternative } from './formui';

	let {
		owner,
		key,
		lang,
		text,
		onpick
	}: {
		owner: { written: Written };
		key: string;
		lang: Lang;
		/** The field's shown value. */
		text: string;
		/** Take the other reading of a `[?: …]`: the whole field's new text, that span replaced. */
		onpick?: (text: string) => void;
	} = $props();

	const m = $derived(fieldMarkers(owner, key, lang));
	const parts = $derived.by(() => {
		const out: { text: string; kind?: string }[] = [];
		let at = 0;
		for (const mk of [...m.marks].sort((a, b) => a.start - b.start)) {
			if (mk.start < at) continue;
			if (mk.start > at) out.push({ text: text.slice(at, mk.start) });
			out.push({ text: text.slice(mk.start, mk.end), kind: mk.kind });
			at = mk.end;
		}
		if (at < text.length) out.push({ text: text.slice(at) });
		return out;
	});
	// Each other reading with its own span; two may read the same.
	const others = $derived(m.marks.filter((x) => x.alternative !== undefined));
	const added = $derived(m.marks.filter((x) => x.kind === 'added').map((x) => text.slice(x.start, x.end)));
</script>

{#if m.marks.length}
	<div class="marks" class:uncertain={m.uncertain} data-testid="marks-{key}">
		<p class="shown">
			{#each parts as p, i (i)}{#if p.kind}<mark class="mk mk-{p.kind}" title={p.kind === 'added' ? f.added(p.text) : f.uncertain}>{p.text || '…'}</mark>{:else}{p.text}{/if}{/each}
		</p>
		{#if m.uncertain}
			<p class="why">{f.uncertain}</p>
			<div class="acts">
				{#if onpick}
					{#each others as mk, i (i)}
						<button type="button" class="btn" onclick={() => onpick(withAlternative(text, mk))}>{f.uncertainOr(mk.alternative ?? '')}</button>
					{/each}
				{/if}
				<button type="button" class="btn" onclick={() => confirmField(owner, key, lang)}>{f.confirm}</button>
			</div>
		{:else if added.length}
			<p class="why">{f.added(added.join(' '))}</p>
		{/if}
	</div>
{/if}

<style>
	.marks {
		margin-top: 0.3rem;
		padding: 0.4rem 0.6rem;
		border-left: 3px solid var(--pencil);
		background: var(--card);
		font-size: var(--step--1);
	}
	.marks.uncertain {
		border-left-color: var(--highlight);
		background: #fffbe0;
	}
	p {
		margin: 0;
	}
	.shown {
		font-family: var(--serif);
		font-size: var(--step-0);
	}
	.why {
		color: var(--ink-soft);
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.35rem;
	}
	.acts .btn {
		min-height: 44px;
		white-space: normal;
		text-align: left;
	}
</style>
