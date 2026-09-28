<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { t } from '$lib/i18n/fr';
	import { codeText } from '$lib/i18n/diagnostics';
	import { formatMoney, formatPack } from '$lib/render/money';
	import { unitLabel } from '$lib/render/ingredient';
	import { ingredientHref, ingredientRowHref, queueHref } from '$lib/render/links';
	import type { NameRule } from '$lib/ingredients/types';
	import Marked from '$lib/components/Marked.svelte';
	import type { Unit } from '$lib/vault/types';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const e = $derived(data.entry);
	const keep = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
	const u = (unit: string, n = 1) => (t.ingredients.unit[unit] && n < 2 ? t.ingredients.unit[unit] : unitLabel(unit as Unit, n, 'fr'));
	/** Three significant digits, decimal comma. */
	const num = (x: number) => String(Number(x.toPrecision(3))).replace('.', ',');
	const amount = (x: number) => (data.unit ? `${num(x)} ${u(data.unit, x)}` : num(x));
	const pct = (x: number) => (Math.abs(x) < 0.005 ? t.ingredient.same : `${x > 0 ? '+' : '−'}${Math.round(Math.abs(x) * 100)} %`);
	const money = (a: number, currency: string) => formatMoney(a, { currency, locale: data.money.locale });
	const written = (w: { qty: string; value: number | null; unit: string | null; toTaste: boolean; optional: boolean }) =>
		[w.qty ? `${w.qty}${w.unit ? ` ${u(w.unit, w.value ?? 1)}` : ''}` : w.toTaste ? t.ingredient.toTaste : w.unit ? u(w.unit) : t.ingredient.noQty, w.optional ? t.ingredient.optional : '']
			.filter(Boolean)
			.join(', ');
	function ruleText(r: NameRule): string {
		const c = [
			r.lang && t.ingredient.ruleLang(r.lang),
			r.unit && t.ingredient.ruleUnit(r.unit.map((x) => t.queue.ruleClass[x] ?? u(x)).join(' ou ')),
			r.words && t.ingredient.ruleWords(r.words.map((w) => `« ${w} »`).join(' ou '))
		].filter(Boolean);
		return t.ingredient.rule(r.names.join(' », « '), c.join(t.ingredient.and));
	}
	const merged = $derived(page.url.searchParams.get('fusion'));
	const weightRows = $derived([...Object.entries(e.weights).map(([unit, g]) => ({ unit, g: String(g).replace('.', ',') })), { unit: '', g: '' }, { unit: '', g: '' }]);
	let mergeInto = $state('');
	const mergeName = $derived(data.entries.find((x) => x.slug === mergeInto || x.name === mergeInto)?.name ?? mergeInto);
</script>

<svelte:head><title>{data.name} — {t.ingredients.title} — {t.app.name}</title></svelte:head>

<p class="back no-print"><a href="/ingredients">← {t.ingredient.back}</a></p>

<header class="head">
	<h1>{data.name}</h1>
	<p class="meta">
		<code>{e.slug}</code> · {t.category[e.category] ?? e.category}
		{#if e.staple}<span class="tag">{t.ingredient.staple}</span>{/if}
		{#if e.auGout}<span class="tag">{t.ingredient.auGout}</span>{/if}
	</p>
</header>

{#if form?.message}
	<p class="flash" class:error={!form.ok} role={form.ok ? 'status' : 'alert'}>{form.message}</p>
{:else if merged}
	<p class="flash" role="status">{t.ingredient.merged(merged, data.name)}</p>
{/if}

{#if data.broken}<p class="flash error">{t.ingredient.broken}</p>{/if}
{#if data.problems.length}
	<details class="problems">
		<summary>{t.ingredient.problems} ({data.problems.length})</summary>
		<ul>
			{#each data.problems as p, i (i)}
				<li>
					{codeText[p.code] ?? p.message}
					<details class="tech">
						<summary>{t.diagnostics.technical}</summary>
						<code>{p.code}</code>{#if p.path} <code>{p.path}</code>{/if} {p.message}{#if p.fix}<br />{p.fix}{/if}
					</details>
				</li>
			{/each}
		</ul>
	</details>
{/if}

<div class="grid">
	<section class="card" aria-labelledby="h-names">
		<h2 id="h-names">{t.ingredient.names}</h2>
		<dl class="names">
			{#each ['fr', 'en'] as l (l)}
				{#if e.names[l as 'fr' | 'en'].length}
					<dt>{t.ingredient.lang[l]}</dt>
					<dd>{e.names[l as 'fr' | 'en'].join(' · ')}</dd>
				{/if}
			{/each}
		</dl>
		{#if e.when?.length}
			<h3>{t.ingredient.rules}</h3>
			<ul class="rules">
				{#each e.when as r, i (i)}<li>{ruleText(r)}</li>{/each}
			</ul>
		{/if}
		<form class="inline" method="POST" action="?/alias" use:enhance={keep}>
			<input type="hidden" name="hash" value={data.hash} />
			<label>
				{t.ingredient.addNameField}
				<input name="name" required autocomplete="off" />
			</label>
			<label>
				{t.ingredient.addNameLang}
				<select name="lang">
					<option value="fr">{t.ingredient.lang.fr}</option>
					<option value="en">{t.ingredient.lang.en}</option>
				</select>
			</label>
			<button class="btn" type="submit">{t.ingredient.addNameSubmit}</button>
		</form>

		<h3>{t.ingredient.allergens}</h3>
		{#if data.allergens.length}
			<ul class="chips">
				{#each data.allergens as a (a.slug)}<li>{a.label}</li>{/each}
			</ul>
		{:else}
			<p class="soft">{t.ingredient.noAllergen}</p>
		{/if}

		<h3>{t.ingredient.facts}</h3>
		<dl class="facts">
			<dt>{t.ingredient.defaultUnit}</dt>
			<dd>{e.defaultUnit ? u(e.defaultUnit) : t.ingredient.none}</dd>
			<dt>{t.ingredient.density}</dt>
			<dd>{e.density !== undefined ? t.ingredient.densityValue(num(e.density)) : t.ingredient.none}</dd>
			<dt>{t.ingredient.weights}</dt>
			<dd>
				{#each Object.entries(e.weights) as [unit, g], i (unit)}{i ? ' · ' : ''}{t.ingredient.weightValue(u(unit), num(g!))}{:else}{t.ingredient.none}{/each}
			</dd>
		</dl>
	</section>

	<section class="card" aria-labelledby="h-price">
		<h2 id="h-price">{t.ingredient.price}</h2>
		{#if data.current}
			<p class="current">
				<span class="money">{money(data.current.amount, data.current.currency)}</span>
				<span class="pack">{t.ingredients.per(formatPack(data.current.packQty, data.current.packUnit))}</span>
				<span class="soft">{[data.current.shop, data.current.date].filter(Boolean).join(' · ')}</span>
			</p>
			{#if data.current.stale}<p class="stale" role="note">{t.ingredient.stale}</p>{/if}
		{:else}
			<p class="soft">{t.ingredient.noPrice}</p>
		{/if}
		<p><a href={ingredientRowHref(e.slug)}>{t.ingredient.enterPrice}</a></p>
		{#if data.history.length > 1 || (data.history.length && !data.current)}
			<h3>{t.ingredient.history}</h3>
			<table class="history">
				<thead>
					<tr>
						<th scope="col">{t.ingredient.historyCols.date}</th>
						<th scope="col">{t.ingredient.historyCols.price}</th>
						<th scope="col">{t.ingredient.historyCols.shop}</th>
						<th scope="col">{t.ingredient.historyCols.change}</th>
					</tr>
				</thead>
				<tbody>
					{#each [...data.history].reverse() as h (h.line)}
						<tr class:current={h.current} class:foreign={!h.usable}>
							<td>{h.date}</td>
							<td>
								{money(h.amount, h.currency)} {t.ingredients.per(formatPack(h.packQty, h.packUnit))}
								{#if !h.usable}<span class="soft">({t.ingredient.foreign(h.currency)})</span>{/if}
							</td>
							<td>{h.shop}</td>
							<td class="change">{h.change !== undefined ? pct(h.change) : ''}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}

		<h3>{t.ingredient.substitutes}</h3>
		{#if data.substitutes.length}
			<ul class="chips">
				{#each data.substitutes as s (s.slug)}<li><a href={ingredientHref(s.slug)}>{s.name}</a></li>{/each}
			</ul>
		{:else}<p class="soft">{t.ingredient.noSubstitute}</p>{/if}
		<h3>{t.ingredient.substituteFor}</h3>
		{#if data.substituteFor.length}
			<ul class="chips">
				{#each data.substituteFor as s (s.slug)}<li><a href={ingredientHref(s.slug)}>{s.name}</a></li>{/each}
			</ul>
		{:else}<p class="soft">{t.ingredient.noSubstitute}</p>{/if}
	</section>
</div>

<section class="card" aria-labelledby="h-recipes">
	<h2 id="h-recipes">{t.ingredient.recipes(data.uses.length)}</h2>
	{#if data.uses.length}
		{#if data.unit && data.unitFrom}
			<p class="soft">{t.ingredient.byAmount(`${u(data.unit, 2)} (${t.ingredient.unitFrom[data.unitFrom]})`)}</p>
			{#if data.total.recipes}
				<p class="total">
					{t.ingredient.total(amount(data.total.amount), data.total.recipes)}{#if data.total.unconverted}<span class="soft">
							· {t.ingredient.unconverted(data.total.unconverted)}</span
						>{/if}
				</p>
			{/if}
		{/if}
		<ol class="uses">
			{#each data.uses as r (r.slug)}
				<li>
					<a href="/r/{r.slug}"><Marked text={r.title} /></a>
					{#if r.option}
						<span class="soft">— {t.ingredient.option}</span>
					{:else}
						<span class="soft">— {r.written.map(written).join(' + ')}</span>
						{#if r.amount !== undefined && data.unit && !(r.written.length === 1 && r.written[0].unit === data.unit)}<span class="amt">≈ {amount(r.amount)}</span>{/if}
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
</section>

<section class="card" aria-labelledby="h-drift">
	<h2 id="h-drift">{t.ingredient.drift}</h2>
	<p class="soft">{t.ingredient.driftHelp}</p>
	{#if data.drift.length}
		<ul class="drift">
			{#each data.drift as d (d.key)}
				<li>
					<span class="form">« {d.forms[0].name} »</span>
					<span class="soft">{t.queue.count(d.count, d.recipes)}{#if d.forms.length > 1} · {d.forms.slice(1).map((f) => `« ${f.name} »`).join(', ')}{/if}</span>
					{#if d.ambiguous}
						<span class="soft">({t.ingredient.driftAmbiguous})</span>
						<a href={queueHref(d.key)}>{t.ingredient.driftQueue}</a>
					{:else}
						<form method="POST" action="?/link" use:enhance={keep}>
							<input type="hidden" name="key" value={d.key} />
							<input type="hidden" name="form" value={d.forms[0].name} />
							<input type="hidden" name="hash" value={data.hash} />
							<button class="btn primary" type="submit">{t.ingredient.linkHere}</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="soft">{t.ingredient.driftNone}</p>
	{/if}
</section>

<details class="card edit">
	<summary><h2>{t.ingredient.edit}</h2></summary>
	<p class="soft">{t.ingredient.editHelp}</p>
	{#key data.hash}
		<form method="POST" action="?/edit" use:enhance={keep}>
			<input type="hidden" name="hash" value={data.hash} />
			<div class="cols">
				<label>
					{t.ingredient.namesField('fr')}
					<textarea name="names_fr" rows="5">{e.names.fr.join('\n')}</textarea>
				</label>
				<label>
					{t.ingredient.namesField('en')}
					<textarea name="names_en" rows="5">{e.names.en.join('\n')}</textarea>
				</label>
			</div>
			<div class="cols">
				<label>
					{t.ingredient.category}
					<select name="category" value={e.category}>
						{#each data.categories as c (c)}<option value={c}>{t.category[c] ?? c}</option>{/each}
					</select>
				</label>
				<label>
					{t.ingredient.defaultUnit}
					<select name="default_unit" value={e.defaultUnit ?? ''}>
						<option value="">{t.ingredient.unitNone}</option>
						{#each data.units as x (x)}<option value={x}>{u(x)}</option>{/each}
					</select>
				</label>
				<label>
					{t.ingredient.densityField}
					<input name="density" inputmode="decimal" size="6" autocomplete="off" value={e.density !== undefined ? String(e.density).replace('.', ',') : ''} />
				</label>
			</div>
			<label class="check"><input type="checkbox" name="staple" checked={e.staple} /> {t.ingredient.stapleField}</label>
			<label class="check"><input type="checkbox" name="au_gout" checked={e.auGout} /> {t.ingredient.auGoutField}</label>
			<fieldset>
				<legend>{t.ingredient.weightsField}</legend>
				{#each weightRows as w, i (i)}
					<div class="weight">
						<select name="weight_unit" value={w.unit} aria-label={t.ingredient.weightUnit}>
							<option value="">{t.ingredient.unitNone}</option>
							{#each data.units as x (x)}<option value={x}>{u(x)}</option>{/each}
						</select>
						<input name="weight_g" inputmode="decimal" size="6" autocomplete="off" value={w.g} aria-label={t.ingredient.weightGrams} />
					</div>
				{/each}
			</fieldset>
			<label>
				{t.ingredient.substitutesField}
				<input name="substitutes" list="entries" autocomplete="off" value={e.substitutes.join(', ')} />
			</label>
			{#if data.allergenList.length}
				<fieldset>
					<legend>{t.ingredient.allergensField}</legend>
					{#each data.allergenList as a (a.slug)}
						<label class="check"><input type="checkbox" name="allergens" value={a.slug} checked={e.allergens.includes(a.slug)} /> {a.label}</label>
					{/each}
				</fieldset>
			{/if}
			<button class="btn primary" type="submit">{t.ingredient.save}</button>
		</form>
	{/key}
</details>

<details class="card edit">
	<summary><h2>{t.ingredient.merge}</h2></summary>
	<p class="soft">{t.ingredient.mergeHelp(data.name)}</p>
	<form
		method="POST"
		action="?/merge"
		use:enhance={({ cancel }) => {
			if (!confirm(t.ingredient.mergeConfirm(data.name, mergeName))) cancel();
			return async ({ update }) => update({ reset: false });
		}}
	>
		<input type="hidden" name="hash" value={data.hash} />
		<label>
			{t.ingredient.mergeField}
			<input name="into" list="entries" required autocomplete="off" bind:value={mergeInto} />
		</label>
		<button class="btn" type="submit">{t.ingredient.mergeSubmit}</button>
	</form>
</details>

<datalist id="entries">
	{#each data.entries as x (x.slug)}<option value={x.slug}>{x.name}</option>{/each}
</datalist>

<p class="soft file">{t.ingredient.file(data.path)}</p>

<style>
	.back {
		margin: 0 0 0.5rem;
		font-size: var(--step--1);
	}
	h1 {
		font-size: var(--step-3);
		margin: 0;
	}
	h2 {
		font-size: var(--step-1);
		margin: 0 0 0.5rem;
	}
	h3 {
		font-size: var(--step-0);
		margin: 1rem 0 0.3rem;
	}
	.meta,
	.soft {
		color: var(--ink-soft);
	}
	.soft {
		font-size: var(--step--1);
	}
	.tag {
		font-size: var(--step--1);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 0 0.35rem;
		margin-left: 0.3rem;
	}
	.flash {
		padding: 0.6rem 1rem;
		background: #e7f2ec;
		border-left: 4px solid var(--ok);
		margin: 0.75rem 0;
		max-width: 48rem;
	}
	.flash.error {
		background: #fbeceb;
		border-left-color: var(--rule-red);
	}
	.problems summary {
		cursor: pointer;
		color: var(--rule-red);
		font-weight: 600;
	}
	.tech {
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
		gap: 1rem;
		margin: 1rem 0;
	}
	.card {
		background: var(--card);
		border-top: 2px solid var(--rule-red);
		padding: 0.8rem 1rem 1rem;
		margin: 0 0 1rem;
	}
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.2rem 0.8rem;
		margin: 0;
	}
	dt {
		font-weight: 600;
	}
	dd {
		margin: 0;
	}
	.chips {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.chips li {
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 0 0.4rem;
	}
	.rules {
		margin: 0;
		padding-left: 1.2rem;
	}
	form.inline,
	.drift form {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 0.4rem 0.8rem;
		margin-top: 0.6rem;
	}
	.drift form {
		display: inline-flex;
		margin: 0 0 0 0.5rem;
	}
	label {
		display: grid;
		gap: 0.1rem;
		font-size: var(--step--1);
		font-weight: 600;
	}
	label.check {
		display: flex;
		gap: 0.4rem;
		font-weight: 400;
		align-items: baseline;
	}
	.current .money {
		font-size: var(--step-2);
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.stale {
		border-left: 4px solid var(--highlight);
		background: #fdf6d3;
		color: var(--highlight-ink);
		padding: 0.3rem 0.6rem;
	}
	.history {
		border-collapse: collapse;
		width: 100%;
		font-size: var(--step--1);
	}
	.history th,
	.history td {
		text-align: left;
		padding: 0.25rem 0.4rem;
		border-bottom: 1px solid var(--rule-blue);
	}
	.history tr.current {
		font-weight: 700;
	}
	.history tr.foreign {
		color: var(--ink-soft);
	}
	.change {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.total {
		font-weight: 600;
	}
	.uses {
		margin: 0;
		padding-left: 1.4rem;
	}
	.uses li {
		margin: 0.15rem 0;
	}
	.amt {
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		margin-left: 0.3rem;
	}
	.drift {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.drift li {
		padding: 0.3rem 0;
		border-bottom: 1px solid var(--rule-blue);
	}
	.form {
		font-weight: 600;
	}
	.edit summary {
		cursor: pointer;
	}
	.edit summary h2 {
		display: inline;
	}
	.edit form {
		display: grid;
		gap: 0.6rem;
		max-width: 44rem;
	}
	.cols {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem 1rem;
	}
	.cols label {
		flex: 1 1 12rem;
	}
	fieldset {
		border: 1px solid var(--line);
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 1rem;
	}
	.weight {
		display: flex;
		gap: 0.3rem;
	}
	.file {
		margin-top: 1.5rem;
	}
</style>
