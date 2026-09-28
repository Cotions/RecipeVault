<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { t } from '$lib/i18n/fr';
	import { codeText } from '$lib/i18n/diagnostics';
	import { formatMoney, formatPack, packDefaults } from '$lib/render/money';
	import { ingredientHref } from '$lib/render/links';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** The row whose price editor is open. */
	let editing = $state<string | null>(null);
	/** The shop typed last, offered again on the next row (a receipt is one shop). */
	let lastShop = $state('');
	let saving = $state(false);

	const cols = ['nom', 'categorie', 'recettes', 'date'] as const;

	function sortHref(col: string): string {
		const u = new URL(page.url);
		const same = (u.searchParams.get('tri') ?? 'a-saisir') === col;
		u.searchParams.set('tri', col);
		if (same && u.searchParams.get('inverse') !== '1') u.searchParams.set('inverse', '1');
		else u.searchParams.delete('inverse');
		return u.pathname + u.search;
	}
	const sortedBy = (col: string) => (data.filter.sort === col ? (data.filter.reverse ? 'descending' : 'ascending') : undefined);

	async function open(slug: string | null) {
		editing = slug;
		if (!slug) return;
		await tick();
		const el = document.getElementById(`amount-${slug}`) as HTMLInputElement | null;
		el?.focus();
		el?.scrollIntoView({ block: 'nearest' });
	}

	function keydown(e: KeyboardEvent) {
		const slug = editing;
		if (e.key !== 'Escape' || !slug) return;
		e.preventDefault();
		editing = null;
		tick().then(() => document.getElementById(`enter-${slug}`)?.focus());
	}

	/** Enter saves, then the editor moves down one row (the list as it was before the save). */
	const submit: SubmitFunction = ({ formData }) => {
		const slug = String(formData.get('slug'));
		const i = data.rows.findIndex((r) => r.slug === slug);
		const next = data.rows[i + 1]?.slug ?? null;
		saving = true;
		return async ({ result, update }) => {
			saving = false;
			await update({ reset: false });
			if (result.type === 'success') {
				lastShop = String(formData.get('shop') ?? '');
				await open(next);
			}
		};
	};

	function filterChange(e: Event) {
		const f = (e.currentTarget as HTMLElement).closest('form') as HTMLFormElement;
		const params = new URLSearchParams();
		for (const [k, v] of new FormData(f)) if (String(v)) params.set(k, String(v));
		for (const k of ['tri', 'inverse']) {
			const v = page.url.searchParams.get(k);
			if (v) params.set(k, v);
		}
		goto(`?${params}`, { keepFocus: true, noScroll: true, replaceState: true });
	}
	const filtered = $derived(!!(data.filter.q || data.filter.category || data.filter.prix || data.filter.essentiel));
</script>

<svelte:window onkeydown={keydown} />

<svelte:head><title>{t.ingredients.title} — {t.app.name}</title></svelte:head>

<h1>{t.ingredients.title}</h1>
<p class="intro">{t.ingredients.intro}</p>
<p class="count">{t.ingredients.count(data.total, data.priced)}</p>

{#if form?.message}
	<p class="flash" class:error={!form.ok} role={form.ok ? 'status' : 'alert'}>{form.message}</p>
{/if}

{#if data.problems.length}
	<details class="problems">
		<summary>{t.ingredients.problems(data.problems.length)}</summary>
		<ul>
			{#each data.problems as p, i (i)}
				<li>
					<strong>{t.ingredients.line(p.line)}</strong> — {codeText[p.code] ?? p.message}
					<details class="tech">
						<summary>{t.diagnostics.technical}</summary>
						<code>{p.code}</code> {p.message}{#if p.fix}<br />{p.fix}{/if}
					</details>
				</li>
			{/each}
		</ul>
	</details>
{/if}

<form class="filters" method="GET" data-sveltekit-keepfocus data-sveltekit-replacestate>
	<label class="q">
		<span class="visually-hidden">{t.ingredients.search}</span>
		<input type="search" name="q" value={data.filter.q} placeholder={t.ingredients.search} oninput={filterChange} autocomplete="off" />
	</label>
	<label>
		{t.ingredients.category}
		<select name="categorie" value={data.filter.category} onchange={filterChange}>
			<option value="">{t.ingredients.allCategories}</option>
			{#each data.categories as c (c)}<option value={c}>{t.category[c] ?? c}</option>{/each}
		</select>
	</label>
	<label>
		{t.ingredients.priced}
		<select name="prix" value={data.filter.prix} onchange={filterChange}>
			<option value="">{t.ingredients.pricedAll}</option>
			<option value="oui">{t.ingredients.pricedYes}</option>
			<option value="non">{t.ingredients.pricedNo}</option>
		</select>
	</label>
	<label>
		{t.ingredients.staple}
		<select name="essentiel" value={data.filter.essentiel} onchange={filterChange}>
			<option value="">{t.ingredients.stapleAll}</option>
			<option value="oui">{t.ingredients.stapleYes}</option>
			<option value="non">{t.ingredients.stapleNo}</option>
		</select>
	</label>
	{#if data.filter.sort !== 'a-saisir'}<input type="hidden" name="tri" value={data.filter.sort} />{/if}
	<noscript><button class="btn" type="submit">{t.ingredients.filter}</button></noscript>
	{#if filtered}<a class="clear" href="/ingredients{data.filter.sort !== 'a-saisir' ? `?tri=${data.filter.sort}` : ''}">{t.ingredients.clear}</a>{/if}
</form>

<datalist id="shops">
	{#each data.shops as s (s)}<option value={s}></option>{/each}
</datalist>

{#if data.rows.length}
	<p class="sort-note">
		{#if data.filter.sort === 'a-saisir'}{t.ingredients.sortDefault}{:else}<a href="/ingredients">{t.ingredients.sortDefault}</a>{/if}
	</p>
	<table class="index">
		<thead>
			<tr>
				{#each cols as c (c)}
					<th scope="col" aria-sort={sortedBy(c)} class={c}><a href={sortHref(c)}>{t.ingredients.cols[c]}</a></th>
				{/each}
				<th scope="col" class="act"><span class="visually-hidden">{t.ingredients.enter}</span></th>
			</tr>
		</thead>
		<tbody>
			{#each data.rows as r (r.slug)}
				<tr id="i-{r.slug}" class:priced={!!r.price} class:open={editing === r.slug}>
					<th scope="row" class="nom">
						<a class="name" href={ingredientHref(r.slug)}>{r.name}</a>
						<code>{r.slug}</code>
						{#if r.staple}<span class="tag">{t.ingredients.stapleMark}</span>{/if}
					</th>
					<td class="categorie">{t.category[r.category] ?? r.category}</td>
					<td class="recettes">{r.recipes}</td>
					<td class="date">
						{#if r.price}
							<span class="money">{formatMoney(r.price.amount, { currency: r.price.currency, locale: data.money.locale })}</span>
							<span class="pack">{t.ingredients.per(formatPack(r.price.packQty, r.price.packUnit))}</span>
							<span class="meta">{[r.price.shop, r.price.date].filter(Boolean).join(' · ')}</span>
							{#if r.price.stale}<span class="stale" title={t.ingredients.staleTitle}>{t.ingredients.stale}</span>{/if}
						{:else}
							<span class="none">{t.ingredients.noPrice}</span>
						{/if}
					</td>
					<td class="act">
						<button id="enter-{r.slug}" class="btn quiet" type="button" aria-expanded={editing === r.slug} aria-label={t.ingredients.enterFor(r.name)} onclick={() => open(editing === r.slug ? null : r.slug)}>
							{t.ingredients.enter}
						</button>
					</td>
				</tr>
				{#if editing === r.slug}
					{@const pack = packDefaults(r.price, r.defaultUnit)}
					<tr class="editor">
						<td colspan="5">
							<form method="POST" action="?/price" use:enhance={submit}>
								<input type="hidden" name="slug" value={r.slug} />
								<label>
									{t.ingredients.amount} ({data.money.currency})
									<input id="amount-{r.slug}" name="amount" inputmode="decimal" required autocomplete="off" size="7" />
								</label>
								<label>
									{t.ingredients.packQty}
									<input name="pack_qty" inputmode="decimal" required autocomplete="off" size="6" value={pack.qty} />
								</label>
								<label>
									{t.ingredients.packUnit}
									<select name="pack_unit" required value={pack.unit}>
										<option value="">{t.ingredients.unitPick}</option>
										{#each data.units as u (u)}<option value={u}>{t.ingredients.unit[u] ?? u}</option>{/each}
									</select>
								</label>
								<label>
									{t.ingredients.shop}
									<input name="shop" list="shops" autocomplete="off" size="12" value={lastShop || r.price?.shop || ''} />
								</label>
								<label>
									{t.ingredients.date}
									<input name="date" type="date" required value={data.today} />
								</label>
								<div class="buttons">
									<button class="btn primary" type="submit" disabled={saving}>{t.ingredients.save}</button>
									<button class="btn quiet" type="button" onclick={() => (editing = null)}>{t.ingredients.cancel}</button>
								</div>
								<p class="keys">{t.ingredients.keys}</p>
							</form>
						</td>
					</tr>
				{/if}
			{/each}
		</tbody>
	</table>
{:else}
	<p class="intro">{data.total ? t.ingredients.empty : t.ingredients.emptyRegistry}</p>
{/if}

<style>
	h1 {
		font-size: var(--step-3);
	}
	.intro {
		color: var(--ink-soft);
		font-family: var(--serif);
		font-size: var(--step-1);
		margin: 0.25rem 0 0.5rem;
		max-width: var(--measure);
	}
	.count,
	.sort-note {
		color: var(--ink-soft);
		font-size: var(--step--1);
		margin: 0 0 0.75rem;
	}
	.flash {
		padding: 0.6rem 1rem;
		background: #e7f2ec;
		border-left: 4px solid var(--ok);
		margin: 0 0 1rem;
		max-width: 48rem;
	}
	.flash.error {
		background: #fbeceb;
		border-left-color: var(--rule-red);
	}
	.problems {
		margin: 0 0 1rem;
		max-width: 48rem;
	}
	.problems summary {
		cursor: pointer;
		color: var(--rule-red);
		font-weight: 600;
	}
	.problems ul {
		margin: 0.4rem 0 0;
		padding-left: 1.2rem;
	}
	.tech {
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 0.5rem 1rem;
		margin: 0 0 0.75rem;
	}
	.filters label {
		display: grid;
		gap: 0.1rem;
		font-size: var(--step--1);
		font-weight: 600;
	}
	.filters .q input {
		min-width: 16rem;
	}
	.clear {
		font-size: var(--step--1);
	}
	.index {
		width: 100%;
		max-width: 64rem;
		border-collapse: collapse;
		background: var(--card);
		border-top: 2px solid var(--rule-red);
	}
	.index th,
	.index td {
		text-align: left;
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid var(--rule-blue);
		vertical-align: baseline;
	}
	thead th {
		font-size: var(--step--1);
		white-space: nowrap;
	}
	thead th a {
		color: var(--ink);
		text-decoration: none;
	}
	thead th[aria-sort] a {
		text-decoration: underline;
	}
	thead th[aria-sort='ascending'] a::after {
		content: ' ↓';
	}
	thead th[aria-sort='descending'] a::after {
		content: ' ↑';
	}
	.recettes {
		text-align: right !important;
		font-variant-numeric: tabular-nums;
	}
	tbody th {
		font-weight: 400;
	}
	.name {
		font-weight: 600;
		color: inherit;
	}
	code,
	.meta,
	.none,
	.pack {
		color: var(--ink-soft);
		font-size: var(--step--1);
	}
	.tag,
	.stale {
		font-size: var(--step--1);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 0 0.35rem;
		margin-left: 0.3rem;
	}
	.stale {
		border-color: var(--highlight);
		background: #fdf6d3;
		color: var(--highlight-ink);
	}
	.money {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	tr:target,
	tr.open {
		background: #fdf9e6;
	}
	.editor form {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 0.5rem 0.8rem;
		padding: 0.3rem 0 0.2rem;
	}
	.editor label {
		display: grid;
		gap: 0.1rem;
		font-size: var(--step--1);
		font-weight: 600;
	}
	.buttons {
		display: flex;
		gap: 0.4rem;
	}
	.keys {
		flex-basis: 100%;
		margin: 0;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	@media (max-width: 40rem) {
		.categorie,
		thead .categorie {
			display: none;
		}
	}
</style>
