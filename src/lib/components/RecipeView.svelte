<script lang="ts">
	// A recipe as read: used by the recipe page and, identically, by the paste
	// box preview. Quantities rescale with the servings adjuster, in print too.
	import { onMount, type Snippet } from 'svelte';
	import { t, tagLabel, familyLabel } from '$lib/i18n/fr';
	import { formatDurationValue, formatSeconds } from '$lib/render/duration';
	import { formatAmount, type ScaleBase } from '$lib/render/ingredient';
	import { renderMarkdown } from '$lib/render/markdown';
	import { capFactor, DEFAULT_FACTOR_CAP, MULTIPLIERS, readAmount, servingsStep, scaleTextYield, servingsRange, subRecipeHref, type ScalingRules, type SubScaleRecipe } from '$lib/render/scale';
	import type { Conversions } from '$lib/ingredients/units';
	import { formatOven } from '$lib/render/temperature';
	import { formatNumber } from '$lib/render/fraction';
	import { parseBody } from '$lib/vault/body';
	import { findMarkers } from '$lib/vault/markers';
	import { loadStepStyle, setNumbered, stepStyle } from '$lib/stepstyle.svelte';
	import type { Ingredient, Recipe } from '$lib/vault/types';
	import IngredientLine from './IngredientLine.svelte';
	import Marked from './Marked.svelte';
	import StatusBadge from './StatusBadge.svelte';

	let {
		recipe,
		body,
		titles = {},
		photo = null,
		links = true,
		familyName = null,
		tagViews,
		factor = $bindable(1),
		itemLinks,
		cost,
		photoPrompt,
		scaling = null,
		subScale = null
	}: {
		recipe: Recipe;
		body: string;
		/** Titles of recipes this one links to (sub-recipes, wikilinks) that exist. */
		titles?: Record<string, string>;
		/** The derived display copy; `src` null for a HEIC original (placeholder). */
		photo?: { src: string | null } | null;
		/** False in the paste preview: tags and family do not link away. */
		links?: boolean;
		/** The family's display label (vocab/families.yaml), when it has one. */
		familyName?: string | null;
		/** Recipe page: per tag of `recipe.tags`, its filter key and label (vocab/tag-labels.yaml). Without it (the paste preview) a tag shows as written. */
		tagViews?: { key: string; label: string }[];
		/** The scaling factor (plan 05): the page keeps it in its address (Q1 A). */
		factor?: number;
		/** Recipe page: how each line resolved, by position across groups. */
		itemLinks?: Record<number, { item?: string; key?: string }>;
		/** Recipe page: the cost line, given the current scaling factor. */
		cost?: Snippet<[number]>;
		/** Recipe page: shown where the photo goes when there is none ("Ajouter une photo", plan 04 Q13 A). */
		photoPrompt?: Snippet;
		/** vocab/scaling.yaml (plan 05): how amounts show at another factor; null shows the exact values. */
		scaling?: ScalingRules | null;
		/** Recipe page: the sub-recipes' yields and the conversions, so a sub-recipe's link carries the amount its line needs (Q5 A). */
		subScale?: { conversions: Conversions; recipes: Record<string, SubScaleRecipe> } | null;
	} = $props();

	const lang = $derived(recipe.lang);
	/** Tapping an amount and the free factor (Q8 B): on the recipe page, not in the paste preview. */
	const interactive = $derived(links);
	const cap = $derived(scaling?.factor ?? DEFAULT_FACTOR_CAP);
	/** The servings at the factor: whole on the stepper, possibly not after a typed amount. */
	const servingsNow = $derived(recipe.servings ? recipe.servings * factor : 0);
	const wholeServings = $derived(Math.abs(servingsNow - Math.round(servingsNow)) < 1e-9);
	/** The multipliers offered, and the current factor when it is none of them. */
	const multipliers = $derived(MULTIPLIERS.includes(factor as (typeof MULTIPLIERS)[number]) ? [...MULTIPLIERS] : [...MULTIPLIERS, factor].sort((a, b) => a - b));
	function stepServings(dir: 1 | -1) {
		const next = servingsStep(servingsNow, recipe.servings!, dir, scaling);
		if (next) factor = next.factor;
	}

	// « J'en ai … »: a tapped amount, then factor = typed ÷ written.
	let asking = $state<{ key: string; base: ScaleBase } | null>(null);
	let haveText = $state('');
	let haveError = $state('');
	function ask(key: string, base: ScaleBase) {
		asking = asking?.key === key && asking.base === base ? null : { key, base };
		haveText = '';
		haveError = '';
	}
	/** A typed factor or amount → the factor, or an error line. */
	function checked(n: number | undefined): number | string {
		if (n === undefined) return t.scaling.unreadable;
		return capFactor(n, scaling) ?? t.scaling.outOfRange(formatNumber(cap.min, 'fr'), formatNumber(cap.max, 'fr'));
	}
	function applyHave(e: SubmitEvent) {
		e.preventDefault();
		if (!asking) return;
		const typed = readAmount(haveText);
		const f = checked(typed === undefined ? undefined : typed / asking.base.value);
		if (typeof f === 'string') haveError = f;
		else {
			factor = f;
			asking = null;
		}
	}
	let askFactor = $state(false);
	let factorText = $state('');
	let factorError = $state('');
	function applyFactor(e: SubmitEvent) {
		e.preventDefault();
		const f = checked(readAmount(factorText.replace(/^\s*[×x*]\s*/i, '')));
		if (typeof f === 'string') factorError = f;
		else {
			factor = f;
			askFactor = false;
			factorError = '';
		}
	}
	function focus(node: HTMLInputElement) {
		node.focus();
	}
	/** The position of each group's first line across groups, as the index numbers them. */
	const offsets = $derived(recipe.ingredients.reduce<number[]>((a, g, i) => (a.push(i ? a[i - 1] + recipe.ingredients[i - 1].items.length : 0), a), []));
	/** Q6 B: at another amount, each measure in a step gets its scaled value beside it. */
	const stepScale = $derived(factor === 1 ? undefined : { factor, lang, rules: scaling, title: t.scaling.stepAmountTitle(formatNumber(factor, 'fr')) });
	const html = $derived(renderMarkdown(body, { resolve: (s) => titles[s], numbered: stepStyle.numbered, scale: stepScale }));
	const steps = $derived(parseBody(body).body.steps);
	const hasSteps = $derived(steps.length > 0);
	// Read from the rendered method: an amount split by emphasis or a marker is marked there, not in the raw text.
	const stepHasAmount = $derived(!!stepScale && html.includes('class="step-scaled"'));
	const subHref = $derived(subScale ? (line: Ingredient) => subRecipeHref(line, subScale.recipes[line.recipe!], subScale.conversions, factor, scaling) : undefined);
	onMount(loadStepStyle);
	const oven = $derived(recipe.oven ? formatOven(recipe.oven) : null);
	/** The markers of number fields written with one (`servings: "4 [?]"`), shown after the number. */
	const markersOf = (...raw: (string | undefined)[]) =>
		raw.flatMap((r) => (r ? findMarkers(r, '').map((m) => m.text) : [])).join(' ');
	const ovenMarkers = $derived(recipe.oven ? markersOf(recipe.oven.tempRaw, recipe.oven.tempMaxRaw) : '');
	const servingsMarkers = $derived(markersOf(recipe.servingsRaw, recipe.servingsMaxRaw));
	const kinds = $derived(new Set(recipe.markers.map((m) => (m.kind === 'uncertain-alt' ? 'uncertain' : m.kind))));

	const src = $derived(recipe.source);
	const sourceParts = $derived.by(() => {
		if (!src) return [] as string[];
		const out: string[] = [];
		if (src.title) out.push(src.page !== undefined ? `${src.title}, ${t.recipe.page} ${src.page}` : src.title);
		else if (src.page !== undefined) out.push(`${t.recipe.page} ${src.page}`);
		if (src.note) out.push(src.note);
		return out;
	});

	const times = $derived(
		(
			[
				['prep', t.recipe.prep],
				['cook', t.recipe.cook],
				['rest', t.recipe.rest],
				['total', t.recipe.total]
			] as const
		)
			.map(([k, label]) => ({ label, value: recipe.times?.[k] }))
			.filter((x) => x.value)
	);
	const computedTotal = $derived.by(() => {
		const tm = recipe.times;
		if (!tm || tm.total) return null;
		const parts = [tm.prep, tm.cook, tm.rest].filter((d) => d !== undefined);
		if (parts.length < 2) return null;
		return parts.reduce((n, d) => n + (d.maxSeconds ?? d.seconds), 0);
	});

	/** The yield at the factor (Q7 A): an object scaled like a line, a text's leading number scaled, else the text with the factor beside it. */
	const yieldText = $derived.by(() => {
		const y = recipe.yield;
		if (!y) return null;
		if (typeof y === 'string') {
			const s = scaleTextYield(y, factor, scaling, lang);
			return `${s.approx ? '≈ ' : ''}${s.text}${s.scaled ? '' : ` ${t.scaling.yieldTimes(formatNumber(factor, lang))}`}`;
		}
		const amount = formatAmount(y, { lang, factor, rules: scaling });
		return [amount, y.note].filter(Boolean).join(' ');
	});
	/** The servings at the factor, a range scaled at both ends (Q7 A). */
	const shownServings = $derived(servingsRange(recipe, factor, lang));

	/** Only http(s) becomes a link: a `javascript:` URL in a file must never be clickable. */
	function webUrl(url: string): boolean {
		try {
			return ['http:', 'https:'].includes(new URL(url).protocol);
		} catch {
			return false;
		}
	}

	function host(url: string): string {
		try {
			return new URL(url).hostname || url;
		} catch {
			return url;
		}
	}
</script>

<article class="recipe" lang={lang}>
	<header class="head">
		{#if recipe.family}
			<p class="family">
				{#if links}<a href="/famille/{recipe.family}">{familyLabel(recipe.family, familyName)}</a>{:else}{familyLabel(recipe.family, familyName)}{/if}
				{#if recipe.variant}<span class="variant">— {recipe.variant.replace(/-/g, ' ')}</span>{/if}
			</p>
		{/if}
		<h1><Marked text={recipe.title} /></h1>
		{#if src}
			<p class="source">
				{#if src.author}{t.recipe.by} <strong><Marked text={src.author} /></strong>{/if}
				{#if src.author && (sourceParts.length || src.url)}<span aria-hidden="true"> — </span>{/if}
				{#if !src.author}{src.type ? (t.source[src.type] ?? src.type) : t.recipe.sourceUnknown}{#if sourceParts.length || src.url}<span aria-hidden="true"> — </span>{/if}{/if}
				{#each sourceParts as part, i (i)}{#if i > 0}, {/if}<Marked text={part} />{/each}
				{#if src.url}{#if sourceParts.length}, {/if}{#if webUrl(src.url)}<a href={src.url} rel="noopener noreferrer external">{host(src.url)}</a>{:else}<span class="url">{src.url}</span>{/if}{/if}
			</p>
		{/if}
		<p class="status"><StatusBadge status={recipe.status} /></p>
	</header>

	<dl class="facts">
		{#each times as tm (tm.label)}
			<div><dt>{tm.label}</dt><dd>{formatDurationValue(tm.value!, lang)}</dd></div>
		{/each}
		{#if computedTotal}
			<div><dt>{t.recipe.total}</dt><dd>{formatSeconds(computedTotal, lang)}</dd></div>
		{/if}
		{#if oven}
			<div><dt>{t.recipe.oven}</dt><dd>{oven.written}{#if ovenMarkers}&nbsp;<Marked text={ovenMarkers} />{/if} <span class="conv">({oven.converted})</span></dd></div>
		{/if}
		{#if recipe.servings}
			<div>
				<dt>{t.recipe.servings}</dt>
				<dd>
					{shownServings.lo}{#if shownServings.hi}&nbsp;à&nbsp;{shownServings.hi}{/if}{#if servingsMarkers}&nbsp;<Marked text={servingsMarkers} />{/if}
					{#if recipe.servingsNote}<span class="conv"><Marked text={recipe.servingsNote} /></span>{/if}
				</dd>
			</div>
		{/if}
		{#if yieldText}
			<div><dt>{t.recipe.yield}</dt><dd><Marked text={yieldText} /></dd></div>
		{/if}
	</dl>
	{@render cost?.(factor)}

	{#if recipe.tags.length || recipe.season.length}
		<ul class="tags" aria-label="Étiquettes">
			{#each recipe.tags as tag, i (tag)}
				{@const view = tagViews?.[i] ?? { key: tag, label: tagLabel(tag) }}
				<li>{#if links}<a href="/?tag={encodeURIComponent(view.key)}">{view.label}</a>{:else}{view.label}{/if}</li>
			{/each}
			{#each recipe.season as s (s)}
				<li class="season">{t.season[s] ?? s}</li>
			{/each}
		</ul>
	{/if}

	{#if photo}
		<figure class="photo">
			{#if photo.src}
				<img src={photo.src} alt={t.recipe.photo} loading="lazy" decoding="async" />
			{:else}
				<div class="heic">{t.recipe.heic}</div>
			{/if}
		</figure>
	{:else if photoPrompt}
		<div class="photo no-print">{@render photoPrompt()}</div>
	{/if}

	<div class="columns">
		<section class="ingredients" aria-labelledby="ingredients-title">
			<div class="ing-head">
				<h2 id="ingredients-title">{t.recipe.ingredients}</h2>
				<div class="scaler no-print">
					{#if recipe.servings}
						<button class="step" type="button" aria-label={t.recipe.decrease} disabled={!servingsStep(servingsNow, recipe.servings, -1, scaling)} onclick={() => stepServings(-1)}>−</button>
						<output aria-live="polite">{formatNumber(servingsNow, lang)} <span class="unit">{t.recipe.scale.toLowerCase()}</span></output>
						<button class="step" type="button" aria-label={t.recipe.increase} disabled={!servingsStep(servingsNow, recipe.servings, 1, scaling)} onclick={() => stepServings(1)}>+</button>
					{:else}
						<label>
							<span class="visually-hidden">{t.recipe.scaleFactor}</span>
							<select bind:value={factor}>
								{#each multipliers as m (m)}
									<option value={m}>× {formatNumber(m, lang)}</option>
								{/each}
							</select>
						</label>
					{/if}
					{#if interactive}
						<button class="btn quiet" type="button" aria-expanded={askFactor} onclick={() => ((askFactor = !askFactor), (factorError = ''))}>{t.scaling.other}</button>
					{/if}
					{#if factor !== 1}
						<button class="btn quiet" type="button" onclick={() => ((factor = 1), (asking = null))}>{t.recipe.reset}</button>
					{/if}
				</div>
				{#if factor !== 1}
					<p class="scaled" class:print-only={!recipe.servings || wholeServings}>{t.scaling.factorShown(formatNumber(factor, 'fr'))}</p>
				{/if}
			</div>
			{#if askFactor}
				<form class="ask no-print" onsubmit={applyFactor}>
					<label>{t.scaling.factorLabel} <span aria-hidden="true">×</span> <input inputmode="decimal" autocomplete="off" size="5" bind:value={factorText} use:focus /></label>
					<button class="btn primary" type="submit">{t.scaling.apply}</button>
					{#if factorError}<p class="err" role="alert">{factorError}</p>{/if}
				</form>
			{/if}
			{#if interactive && recipe.ingredients.some((g) => g.items.some((it) => it.qty && !it.toTaste))}
				<p class="tap-hint no-print">{t.scaling.tapHint}</p>
			{/if}
			{#each recipe.ingredients as g, gi (gi)}
				<div class="group" class:optional={g.optional}>
					{#if g.group || g.optional}
						<h3>
							{#if g.group}<Marked text={g.group} />{/if}
							{#if g.optional}<span class="opt">({t.recipe.optionalGroup})</span>{/if}
						</h3>
					{/if}
					<ul>
						{#each g.items as item, ii (ii)}
							{@const key = `${gi}:${ii}`}
							<li>
								<IngredientLine {item} {factor} {lang} {titles} rules={scaling} {subHref} link={itemLinks?.[offsets[gi] + ii]} onscale={interactive ? (b) => ask(key, b) : undefined} />
								{#if asking?.key === key}
									<form class="ask no-print" onsubmit={applyHave}>
										<label>{t.scaling.have(formatAmount({ qty: { value: asking.base.value }, unit: asking.base.unit }, { lang }))} <input inputmode="decimal" autocomplete="off" size="5" bind:value={haveText} use:focus /></label>
										<button class="btn primary" type="submit">{t.scaling.apply}</button>
										<button class="btn quiet" type="button" onclick={() => (asking = null)}>{t.scaling.cancel}</button>
										{#if haveError}<p class="err" role="alert">{haveError}</p>{/if}
									</form>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</section>

		<section class="method">
			{#if hasSteps}
				<label class="step-style no-print">
					<input type="checkbox" checked={stepStyle.numbered} onchange={(e) => setNumbered(e.currentTarget.checked)} />
					{t.recipe.numberSteps}
				</label>
			{/if}
			{#if factor !== 1 && (hasSteps || oven || times.length)}
				<p class="scale-notice" role="note">{t.scaling.stepNotice(formatNumber(factor, 'fr'))}{#if stepHasAmount}{' '}{t.scaling.arrowNotice}{/if}</p>
			{/if}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- markdown-it with html: false -->
			{@html html}
		</section>
	</div>

	{#if kinds.size}
		<aside class="legend" aria-label={t.recipe.legend}>
			{#if kinds.has('uncertain')}<span><mark class="mk mk-uncertain">[?]</mark> {t.recipe.legendUncertain}</span>{/if}
			{#if kinds.has('illegible')}<span><mark class="mk mk-illegible">[illisible]</mark> {t.recipe.legendIllegible}</span>{/if}
			{#if kinds.has('added')}<span><mark class="mk mk-added">[+]</mark> {t.recipe.legendAdded}</span>{/if}
		</aside>
	{/if}
</article>

<style>
	.recipe {
		background: var(--card);
		border-top: 3px solid var(--rule-red);
		padding: 1.25rem 1rem 1.5rem;
		box-shadow: 0 1px 0 var(--line);
	}
	@media (min-width: 48rem) {
		.recipe {
			padding: 2rem 2.25rem 2.25rem;
		}
	}
	.family {
		margin: 0 0 0.25rem;
		font-weight: 600;
		color: var(--ink-soft);
	}
	.variant {
		font-weight: 400;
	}
	h1 {
		font-size: var(--step-3);
		max-width: 30ch;
	}
	@media (min-width: 48rem) {
		h1 {
			font-size: var(--step-4);
		}
	}
	.source {
		margin: 0.5rem 0 0;
		font-family: var(--serif);
		font-size: var(--step-1);
		color: var(--ink-soft);
	}
	.source strong {
		color: var(--ink);
		font-weight: 600;
	}
	.status {
		margin: 0.5rem 0 0;
	}
	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.75rem;
		margin: 1.25rem 0 0;
		padding: 0.75rem 0;
		border-block: 1px solid var(--line);
	}
	.facts div {
		display: flex;
		flex-direction: column;
	}
	.facts dt {
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.facts dd {
		margin: 0;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.conv {
		font-weight: 400;
		color: var(--ink-soft);
	}
	.tags {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0.9rem 0 0;
		padding: 0;
	}
	.tags li {
		font-size: var(--step--1);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 0.05rem 0.5rem;
	}
	.tags a {
		text-decoration: none;
	}
	.tags .season {
		color: var(--ink-soft);
		border-style: dashed;
	}
	.photo {
		margin: 1.25rem 0 0;
	}
	.photo img {
		display: block;
		width: 100%;
		max-height: 26rem;
		object-fit: cover;
		border-radius: var(--radius);
	}
	.heic {
		padding: 2rem 1rem;
		text-align: center;
		color: var(--ink-soft);
		background: repeating-linear-gradient(45deg, #f1f3f5, #f1f3f5 10px, #e9ecf0 10px, #e9ecf0 20px);
	}
	.columns {
		display: grid;
		gap: 1.75rem;
		margin-top: 1.5rem;
	}
	@media (min-width: 56rem) {
		.columns {
			grid-template-columns: minmax(18rem, 5fr) 7fr;
			gap: 2.5rem;
		}
	}
	h2 {
		font-size: var(--step-2);
	}
	.ing-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding-bottom: 0.4rem;
		border-bottom: 2px solid var(--rule-red);
	}
	.scaler {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.scaler output {
		min-width: 5.5rem;
		text-align: center;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.scaler .unit {
		font-weight: 400;
		color: var(--ink-soft);
	}
	.step {
		width: 2.25rem;
		height: 2.25rem;
		border: 1.5px solid var(--ink);
		border-radius: 50%;
		background: var(--card);
		font-size: 1.25rem;
		line-height: 1;
		cursor: pointer;
	}
	.step:disabled {
		opacity: 0.4;
	}
	.print-only {
		display: none;
	}
	.scaled {
		margin: 0;
		font-size: var(--step--1);
		font-weight: 700;
		color: var(--rule-red);
	}
	.tap-hint {
		margin: 0.35rem 0 0;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.ask {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.5rem;
		margin: 0.4rem 0 0.2rem;
		padding: 0.5rem 0.6rem;
		background: var(--paper, #f7f5ef);
		border-left: 3px solid var(--rule-red);
		font-size: var(--step--1);
	}
	.ask input {
		font: inherit;
		font-size: var(--step-0);
		width: 5rem;
		padding: 0.3rem 0.4rem;
		margin-left: 0.25rem;
	}
	.ask .err {
		flex-basis: 100%;
		margin: 0;
		color: var(--rule-red);
	}
	.group h3 {
		font-family: var(--sans);
		font-size: var(--step-0);
		margin: 1rem 0 0;
		color: var(--ink);
	}
	.group.optional h3 .opt {
		font-weight: 400;
		color: var(--ink-soft);
	}
	.group.optional ul {
		color: var(--ink-soft);
	}
	/* The faint blue ruled lines of the card. */
	.group ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.group li {
		padding: 0.45rem 0 0.35rem;
		border-bottom: 1px solid var(--rule-blue);
		line-height: 1.4;
	}
	.method {
		font-family: var(--serif);
		font-size: var(--step-1);
		line-height: 1.6;
		max-width: var(--measure);
	}
	.method :global(h2) {
		font-size: var(--step-2);
		margin: 0 0 0.5rem;
		padding-bottom: 0.4rem;
		border-bottom: 2px solid var(--rule-red);
	}
	.method :global(h2 ~ h2) {
		margin-top: 1.75rem;
	}
	.method :global(h3) {
		font-size: var(--step-1);
		margin: 1.25rem 0 0.25rem;
	}
	.step-style {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 0.25rem;
		font-family: var(--sans);
		font-size: var(--step--1);
		color: var(--ink-soft);
		cursor: pointer;
	}
	.method :global(ol),
	.method :global(ul.steps) {
		padding-left: 1.6rem;
		margin: 0.5rem 0;
	}
	.method :global(ol li),
	.method :global(ul.steps > li) {
		padding-left: 0.3rem;
		margin-bottom: 0.6rem;
	}
	.method :global(ol li::marker),
	.method :global(ul.steps > li::marker) {
		font-family: var(--sans);
		font-weight: 700;
		color: var(--rule-red);
	}
	.method :global(p) {
		margin: 0.5rem 0;
	}
	/* Q6 B: the scaled value after an amount in a step; the card's text stays before it. */
	.method :global(.step-scaled) {
		font-family: var(--sans);
		font-weight: 700;
		color: var(--rule-red);
		white-space: nowrap;
	}
	.scale-notice {
		font-family: var(--sans);
		font-size: var(--step--1);
		color: var(--ink-soft);
		border-left: 3px solid var(--rule-red);
		padding-left: 0.6rem;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.5rem;
		margin-top: 1.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--line);
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	@media print {
		.recipe {
			border: 0;
			box-shadow: none;
			padding: 0;
		}
		h1 {
			font-size: 20pt;
		}
		.photo,
		.status {
			display: none;
		}
		.columns {
			grid-template-columns: 2fr 3fr;
			gap: 1.5rem;
			break-inside: avoid;
		}
		.method {
			font-size: 11pt;
		}
		.print-only {
			display: block;
			margin: 0;
		}
		.group li {
			padding: 0.15rem 0;
		}
	}
</style>
