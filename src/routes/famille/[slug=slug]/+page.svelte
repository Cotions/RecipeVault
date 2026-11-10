<script lang="ts">
	import PageHead from '$lib/components/PageHead.svelte';
	import { enhance } from '$app/forms';
	import { t } from '$lib/i18n';
	import { locale } from '$lib/prefs';
	import { formatSeconds } from '$lib/render/duration';
	import { provenanceLine } from '$lib/render/provenance';
	import Marked from '$lib/components/Marked.svelte';
	import SourceGlyph from '$lib/components/SourceGlyph.svelte';
	import { fold } from '$lib/vault/normalize';
	import Suggest, { type Option } from '$lib/components/form/Suggest.svelte';
	import { Settling, undoToast, type Settled } from '$lib/settle.svelte';
	import { invalidateAll } from '$app/navigation';
	import { toast } from '$lib/toast.svelte';
	import { variantShown } from '$lib/form';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const d = $derived(data.diff);
	/** The label, else the shortest title among its recipes — never the slug. */
	const name = $derived(d.name);
	const stars = (n: number | null) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '—');
	/** Who or where each variant is from: what tells same titles apart (render/provenance.ts). */
	const from = $derived(Object.fromEntries(d.variants.map((v) => [v.slug, provenanceLine({ ...v, variant: null })])));
	/**
	 * What sets each one apart, as written in `variant:` (« Sans gluten »).
	 * Left out when the provenance line already says it (`variant: pierrette`
	 * under « de Matante Pierrette »): one name, not the same one twice.
	 */
	const words = (x: string) => fold(x.replace(/[-’']/g, ' ')).split(' ').filter(Boolean);
	function variantName(v: (typeof d.variants)[number]): string | null {
		if (!v.variant) return null;
		const said = new Set(words(from[v.slug] ?? ''));
		// As she reads it (lib/form/family.ts): « de Tante Aline », « de la revue », « sirop d'érable ».
		const name = variantShown(v.variant, v);
		if (words(name).every((w) => said.has(w) || w === 'de' || w === 'd' || w === 'du' || w === 'des' || w === 'la')) return null;
		return name.charAt(0).toUpperCase() + name.slice(1);
	}
	// « même ingrédient ? [Relier] »: the name not linked yet, linked from here (/resoudre?/link), « Annuler » in the toast.
	const linkForm: SubmitFunction = () => async ({ result }) => {
		const r = (result.type === 'success' || result.type === 'failure' ? result.data : undefined) as Partial<Settled> | undefined;
		if (result.type === 'success' && r?.ok) {
			undoToast(r as Settled, '/resoudre?/undo');
			await invalidateAll();
		} else toast.show({ text: r?.message ?? t.app.undoFailed, error: true });
	};
	const maybeOf = (row: (typeof d.rows)[number], slug: string) => row.maybe?.find((m) => m.slug === slug);
	/** The review state is the owner's upkeep (an account with the Markdown tools). */
	const upkeep = $derived(!!data.user?.markdown);

	// « + Ajouter une recette à ce groupe »: find a recipe, say what sets it
	// apart, one commit; « Annuler » in the toast (lib/settle.svelte.ts).
	const settling = new Settling();
	let query = $state('');
	let adding = $state<{ slug: string; title: string } | null>(null);
	let variant = $state('');
	async function findRecipes(q: string): Promise<Option[]> {
		const res = await fetch(`/api/suggest?kind=recipe&q=${encodeURIComponent(q)}`);
		if (!res.ok) return [];
		const own = new Set(d.variants.map((v) => v.slug));
		return ((await res.json()).items as { slug: string; title: string }[]).filter((r) => !own.has(r.slug)).map((r) => ({ value: r.slug, label: r.title }));
	}
	function pickRecipe(o: Option) {
		adding = { slug: o.value, title: o.label };
		query = o.label;
		// Never a fragment of the title (« aux », « trois »): empty, examples in the placeholder.
		variant = '';
	}
	const addForm = settling.form('add', () => {
		adding = null;
		query = '';
		variant = '';
	});
</script>

<svelte:head><title>{name} — {t.families.title} — {t.app.name}</title></svelte:head>

<PageHead title={name} count={t.families.variants(d.variants.length)} back={{ href: '/familles', label: t.families.title }} />

{#if form?.message}
	<p class="flash" class:error={!form.ok} role="status">{form.message}</p>
{/if}

<details class="rename" open={form?.ok === false}>
	<summary>{t.families.rename}</summary>
	<form method="POST" action="?/label" use:enhance={() => ({ update }) => update({ reset: false })}>
		<input type="hidden" name="hash" value={data.labelsHash} />
		<label for="family-label">{t.families.label}</label>
		<p class="help" id="family-label-help">{t.families.labelHelp(d.family)}</p>
		<div class="row">
			<input
				id="family-label"
				name="label"
				type="text"
				maxlength={data.labelMax}
				value={form?.ok === false ? (form.label ?? '') : (d.label ?? '')}
				placeholder={d.fallback}
				aria-describedby="family-label-help"
			/>
			<button class="btn" type="submit">{t.families.labelSave}</button>
		</div>
	</form>
</details>

<ul class="variants">
	{#each d.variants as v (v.slug)}
		<li>
			<a href="/r/{v.slug}"><Marked text={v.title} /></a>
			{#if variantName(v)}<span class="tag">{variantName(v)}</span>{/if}
			{#if upkeep && v.status === 'needs-review'}<span class="review">{t.status['needs-review']}</span>{/if}
			<!-- Who or where it is from, after the drawing of its kind of source (as on the list's rows). -->
			{#if from[v.slug] || !variantName(v)}
				<span class="from" class:unknown={!from[v.slug]}><SourceGlyph type={v.source_type} />{from[v.slug] || t.browse.unknownFrom}</span>
			{/if}
			{#if d.unique[v.slug]?.length}
				<p class="only">{t.families.only} : {d.unique[v.slug].join(', ')}</p>
			{/if}
		</li>
	{/each}
</ul>

{#if upkeep}
	<details class="add" data-testid="family-add">
		<summary>{t.families.add}</summary>
		<div class="add-body">
			<Suggest id="family-add-search" label={t.families.addSearch} bind:value={query} load={findRecipes} onpick={pickRecipe} testid="family-add-search" />
			{#if adding}
				<form
					method="POST"
					action="?/join"
					use:enhance={addForm}
				>
					<input type="hidden" name="recipe" value={adding.slug} />
					<label for="family-add-variant">{t.duplicates.variant(adding.title)}</label>
					<div class="row">
						<input id="family-add-variant" name="variant" type="text" required placeholder={t.duplicates.variantPlaceholder} bind:value={variant} />
						<button class="btn primary" type="submit">{t.families.addSave}</button>
					</div>
				</form>
			{/if}
		</div>
	</details>
{/if}

{#if d.variants.length > 1}
	<h2>{t.families.diff}</h2>
	<!-- ✓ / – say yes / no (usability round 4: a lone dot read as a bullet). -->
	<p class="legend" data-testid="diff-legend">{t.families.legend}</p>
	<div class="scroll">
		<table>
			<thead>
				<tr>
					<th scope="col"></th>
					{#each d.variants as v (v.slug)}<th scope="col"
							><a href="/r/{v.slug}"><Marked text={v.title} /></a>{#if variantName(v)}<span class="from">{variantName(v)}</span>{:else if from[v.slug]}<span class="from">{from[v.slug]}</span>{/if}</th
						>{/each}
				</tr>
			</thead>
			<tbody>
				{#if d.differs.total_s}
					<tr class="fact"><th scope="row">{t.families.totalTime}</th>{#each d.variants as v (v.slug)}<td>{v.total_s ? formatSeconds(v.total_s, locale()) : '—'}</td>{/each}</tr>
				{/if}
				{#if d.differs.servings}
					<tr class="fact"><th scope="row">{t.families.servings}</th>{#each d.variants as v (v.slug)}<td>{v.servings ?? '—'}{#if v.servings_max}–{v.servings_max}{/if}</td>{/each}</tr>
				{/if}
				{#if d.differs.difficulty}
					<tr class="fact"><th scope="row">{t.families.difficulty}</th>{#each d.variants as v (v.slug)}<td>{v.difficulty ?? '—'}</td>{/each}</tr>
				{/if}
				{#if d.differs.rating}
					<tr class="fact"><th scope="row">{t.families.rating}</th>{#each d.variants as v (v.slug)}<td class="stars">{stars(v.rating)}</td>{/each}</tr>
				{/if}
				{#each d.rows as row (row.item)}
					<tr>
						<th scope="row"><Marked text={row.label} /></th>
						{#each d.variants as v (v.slug)}
							{@const maybe = maybeOf(row, v.slug)}
							<td class:yes={row.in.includes(v.slug)} class:maybe={!!maybe}
								>{#if row.in.includes(v.slug)}<span class="mark-yes" aria-hidden="true">✓</span><span class="visually-hidden">{t.families.yes}</span>{:else if maybe}<span class="maybe-name">« <Marked text={maybe.name} /> »</span>
									<span class="maybe-q">{t.families.maybeSame}</span>
									{#if upkeep}
										<form method="POST" action="/resoudre?/link" use:enhance={linkForm}>
											<input type="hidden" name="key" value={maybe.key} />
											<input type="hidden" name="form" value={maybe.name} />
											<input type="hidden" name="slug" value={row.item} />
											<input type="hidden" name="hash" value={data.entries[row.item]?.hash ?? ''} />
											<button class="btn" type="submit" title={t.families.maybeLinkTitle(maybe.name, data.entries[row.item]?.name ?? row.label)}>{t.families.maybeLink}</button>
										</form>
									{/if}{:else}<span class="mark-no" aria-hidden="true">–</span><span class="visually-hidden">{t.families.no}</span>{/if}</td
							>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if d.common.length}
		<details class="common">
			<summary>{t.families.common(d.common.length)}</summary>
			<p>{d.common.join(', ')}</p>
		</details>
	{/if}
{/if}

<style>
	.flash {
		padding: 0.6rem 1rem;
		background: #e7f2ec;
		border-left: 4px solid var(--ok);
		margin: 0 0 1rem;
		max-width: 40rem;
	}
	.flash.error {
		background: var(--danger-bg);
		border-left-color: var(--danger);
	}
	.rename {
		margin: 0 0 1.25rem;
		max-width: 40rem;
	}
	.add {
		margin: -1rem 0 2rem;
		max-width: 40rem;
	}
	.add summary {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		cursor: pointer;
		color: var(--link);
		font-weight: 600;
	}
	.add-body {
		display: grid;
		gap: 0.5rem;
	}
	.add form {
		display: grid;
		gap: 0.25rem;
	}
	.add label {
		font-weight: 600;
		font-size: var(--step--1);
	}
	.add .row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.add input {
		flex: 1 1 14rem;
		min-height: 44px;
	}
	.add .btn {
		min-height: 44px;
	}
	.rename summary {
		cursor: pointer;
		color: var(--link);
		font-weight: 600;
		font-size: var(--step--1);
	}
	.rename form {
		margin-top: 0.5rem;
	}
	.rename label {
		font-weight: 600;
	}
	.rename .help {
		margin: 0.15rem 0 0.4rem;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.rename .row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.rename input {
		flex: 1 1 14rem;
	}
	.variants {
		list-style: none;
		margin: 0 0 2rem;
		padding: 0;
		display: grid;
		gap: 0.6rem;
	}
	@media (min-width: 48rem) {
		.variants {
			grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
		}
	}
	.variants li {
		background: var(--card);
		border: 1px solid var(--edge);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		padding: 0.7rem 1rem;
	}
	.variants a {
		font-family: var(--serif);
		font-weight: 700;
		font-size: var(--step-1);
	}
	.tag {
		display: inline-block;
		margin-left: 0.4rem;
		color: var(--ink-soft);
		font-size: var(--step--1);
	}
	/* The owner's review state: a word in small capitals, as on the list's rows. */
	.review {
		display: inline-block;
		margin-left: 0.5rem;
		font-size: 0.8125rem;
		font-variant: small-caps;
		text-transform: lowercase;
		letter-spacing: 0.04em;
		color: var(--review-ink, #7a5c00);
	}
	/* Who it is from, in ink, after its source's drawing: what tells same titles apart (as on the home cards). */
	.from {
		display: block;
		font-family: var(--serif);
		font-style: italic;
		font-weight: 400;
		color: var(--ink);
		font-size: 0.875rem;
	}
	.variants .from {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		margin-top: 0.15rem;
		font-size: 0.9375rem;
	}
	.variants .from :global(.glyph) {
		width: 1.25rem;
		height: 1.25rem;
		margin-top: 0.05rem;
		color: var(--ink);
	}
	.from.unknown {
		color: var(--ink-soft);
	}
	.only {
		margin: 0.3rem 0 0;
		font-size: var(--step--1);
		color: var(--ink);
	}
	h2 {
		font-size: var(--step-2);
		margin-bottom: 0.75rem;
	}
	/* Positioned, so the cells' visually-hidden words stay inside the scroll box. */
	.scroll {
		position: relative;
		overflow-x: auto;
		background: var(--card);
		border: 1px solid var(--edge);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}
	table {
		border-collapse: collapse;
		min-width: 100%;
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		padding: 0.45rem 0.8rem;
		border-bottom: 1px solid var(--rule-blue);
		text-align: center;
		white-space: nowrap;
	}
	th[scope='row'] {
		text-align: left;
		font-weight: 500;
		white-space: normal;
		min-width: 10rem;
	}
	thead th {
		font-family: var(--serif);
		vertical-align: bottom;
		white-space: normal;
		min-width: 9rem;
		max-width: 14rem;
	}
	tr.fact th,
	tr.fact td {
		font-weight: 700;
		background: #f7f9fb;
	}
	td.yes {
		color: var(--ink);
		font-weight: 700;
	}
	.mark-no {
		color: var(--pencil);
	}
	.legend {
		margin: -0.4rem 0 0.6rem;
		color: var(--ink-soft);
		font-size: var(--step--1);
	}
	/* A name not linked yet, likely this row's ingredient: said so, with « Relier ». */
	td.maybe {
		white-space: normal;
		font-size: var(--step--1);
		color: var(--ink-soft);
		line-height: 1.3;
	}
	.maybe-name {
		display: block;
		color: var(--ink);
	}
	.maybe-q {
		display: block;
		font-style: italic;
	}
	td.maybe form {
		margin-top: 0.25rem;
	}
	td.maybe .btn {
		min-height: 44px;
		font-size: var(--step--1);
	}
	.stars {
		color: var(--ink);
		letter-spacing: 0.05em;
	}
	.common {
		margin-top: 1rem;
		max-width: var(--measure);
	}
	.common summary {
		cursor: pointer;
		color: var(--link);
		font-weight: 600;
	}
</style>
