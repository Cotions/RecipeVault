<script lang="ts">
	// Possible duplicates (plan 05, Phase 7): pairs of recipes with nearly the
	// same ingredients, most similar first, 20 a page; three ways to settle a
	// pair, each one commit, each undoable from the message that follows it.
	import { enhance } from '$app/forms';
	import { t } from '$lib/i18n/fr';
	import { slugify } from '$lib/vault/slug';
	import Marked from '$lib/components/Marked.svelte';
	import type { PageProps } from './$types';
	import type { PairSide } from '$lib/server/duplicates';

	let { data, form }: PageProps = $props();
	const s = t.duplicates;
	const keep = () => ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
	const pct = (x: number) => Math.round(100 * x);
	const familyName = (r: PairSide) => r.familyLabel ?? r.family ?? '';
	/** The family offered: one of theirs, else one named after the first title. */
	const familyFor = (a: PairSide, b: PairSide) => a.family ?? b.family ?? slugify(a.title);
	const labelFor = (a: PairSide, b: PairSide) => (a.family || b.family ? '' : a.title);
	const pageHref = (p: number) => (p === 1 ? '/doublons' : `/doublons?page=${p}`);
</script>

<svelte:head><title>{s.title}</title></svelte:head>

<h1>{s.title}</h1>
<p class="intro">{s.intro}</p>

{#if form?.message}
	<div class="flash" class:error={!form.ok} role="status" data-testid="flash">
		<span>{form.message}</span>
		{#if form.ok && 'undo' in form && form.undo}
			<form method="POST" action="?/undo" use:enhance={keep}>
				<input type="hidden" name="pair" value={form.pair} />
				<input type="hidden" name="kind" value={form.undo.kind} />
				{#if form.undo.kind === 'dismiss'}
					<input type="hidden" name="a" value={form.undo.a} />
					<input type="hidden" name="b" value={form.undo.b} />
				{:else}
					<input type="hidden" name="commit" value={form.undo.commit} />
					<input type="hidden" name="slug" value={form.undo.slug} />
				{/if}
				<button class="btn" type="submit">{s.undo}</button>
			</form>
		{/if}
	</div>
{/if}

{#if !data.pairs.length}
	<p class="empty">{s.empty}</p>
{:else}
	<p class="count">{s.count(data.total)}</p>
	<ul class="pairs">
		{#each data.pairs as p (p.a.slug + ' ' + p.b.slug)}
			{@const oneFamily = !!p.a.family && p.a.family === p.b.family}
			{@const id = `${p.a.slug}--${p.b.slug}`}
			<li class="card" data-pair="{p.a.slug} {p.b.slug}">
				<header>
					<span class="score">{s.score(pct(p.score))}</span>
					{#if p.titles}<span class="mark">{p.titles === 'same' ? s.sameTitle : s.nearTitle}</span>{/if}
				</header>
				<div class="sides">
					{#each [p.a, p.b] as r (r.slug)}
						<div class="side">
							<h2><a href="/r/{r.slug}"><Marked text={r.title} /></a></h2>
							<p class="meta">
								{r.source || s.noSource}{#if r.sourceType && t.source[r.sourceType as keyof typeof t.source]}{' '}({t.source[r.sourceType as keyof typeof t.source]}){/if}
							</p>
							{#if r.family}<p class="meta">{s.familyOf(familyName(r), r.variant)}</p>{/if}
							{#if r.status}<p class="meta">{t.status[r.status] ?? r.status}</p>{/if}
							{#if r.usedBy.length}
								<p class="meta" data-testid="used-by">
									{s.usedBy}
									{#each r.usedBy as u, i (u.slug)}{i ? ', ' : ' '}<a href="/r/{u.slug}">{u.title}</a>{/each}
								</p>
							{/if}
						</div>
					{/each}
				</div>
				<dl class="elements">
					<dt>{s.shared}</dt>
					<dd>{p.shared.join(', ')}</dd>
					{#if p.onlyA.length}<dt>{s.only(p.a.title)}</dt><dd>{p.onlyA.join(', ')}</dd>{/if}
					{#if p.onlyB.length}<dt>{s.only(p.b.title)}</dt><dd>{p.onlyB.join(', ')}</dd>{/if}
				</dl>
				<p><a class="compare" href="/doublons/comparer?a={p.a.slug}&b={p.b.slug}">{s.compare}</a></p>

				<div class="actions">
					<details name="pair-{id}">
						<summary>{s.versions}</summary>
						{#if oneFamily}
							<p class="help">{s.sameFamily}</p>
						{:else}
							<form method="POST" action="?/versions" use:enhance={keep}>
								<input type="hidden" name="a" value={p.a.slug} />
								<input type="hidden" name="b" value={p.b.slug} />
								<input type="hidden" name="hashA" value={p.a.hash} />
								<input type="hidden" name="hashB" value={p.b.hash} />
								<p class="help">{s.versionsHelp}</p>
								<label for="fam-{id}">{s.family}</label>
								<input id="fam-{id}" name="family" type="text" required value={familyFor(p.a, p.b)} />
								{#if !p.a.family && !p.b.family}
									<label for="label-{id}">{s.familyLabel}</label>
									<input id="label-{id}" name="label" type="text" maxlength={data.labelMax} value={labelFor(p.a, p.b)} />
								{/if}
								<label for="va-{id}">{s.variant(p.a.title)}</label>
								<input id="va-{id}" name="variantA" type="text" required value={p.a.variantText ?? ''} />
								<label for="vb-{id}">{s.variant(p.b.title)}</label>
								<input id="vb-{id}" name="variantB" type="text" required value={p.b.variantText ?? ''} />
								<button class="btn primary" type="submit">{s.versionsSave}</button>
							</form>
						{/if}
					</details>

					<details name="pair-{id}">
						<summary>{s.same}</summary>
						<form method="POST" action="?/same" use:enhance={keep}>
							<input type="hidden" name="a" value={p.a.slug} />
							<input type="hidden" name="b" value={p.b.slug} />
							<input type="hidden" name="hashA" value={p.a.hash} />
							<input type="hidden" name="hashB" value={p.b.hash} />
							<input type="hidden" name="titleA" value={p.a.title} />
							<input type="hidden" name="titleB" value={p.b.title} />
							<p class="help">{s.sameHelp}</p>
							{#if p.a.usedBy.length && p.b.usedBy.length}
								<p class="help" data-testid="both-used">{s.bothUsed}</p>
							{:else}
								<fieldset>
									<!-- The value is the one that goes: "Garder A" sends B to the trash. A recipe
									     used as a sub-recipe elsewhere is never the one that goes. -->
									<label class="radio"
										><input type="radio" name="drop" value={p.b.slug} checked={!p.b.usedBy.length} disabled={!!p.b.usedBy.length} /> {s.keep(p.a.title)}</label
									>
									<label class="radio"
										><input type="radio" name="drop" value={p.a.slug} checked={!!p.b.usedBy.length} disabled={!!p.a.usedBy.length} /> {s.keep(p.b.title)}</label
									>
								</fieldset>
								{#if p.a.usedBy.length || p.b.usedBy.length}<p class="help">{s.keepUsed(p.a.usedBy.length ? p.a.title : p.b.title)}</p>{/if}
								<button class="btn danger" type="submit">{s.sameSave}</button>
							{/if}
						</form>
					</details>

					<details name="pair-{id}">
						<summary>{s.distinct}</summary>
						<form method="POST" action="?/distinct" use:enhance={keep}>
							<input type="hidden" name="a" value={p.a.slug} />
							<input type="hidden" name="b" value={p.b.slug} />
							<input type="hidden" name="distinct" value={data.distinctHash} />
							<p class="help">{s.distinctHelp}</p>
							<button class="btn" type="submit">{s.distinctSave}</button>
						</form>
					</details>
				</div>
			</li>
		{/each}
	</ul>
	{#if data.pages > 1}
		<nav class="pager" aria-label={s.page(data.page, data.pages)}>
			{#if data.page > 1}<a class="btn" href={pageHref(data.page - 1)}>{s.prev}</a>{/if}
			<span>{s.page(data.page, data.pages)}</span>
			{#if data.page < data.pages}<a class="btn" href={pageHref(data.page + 1)}>{s.next}</a>{/if}
		</nav>
	{/if}
{/if}

<style>
	h1 {
		font-size: var(--step-4);
	}
	.intro {
		color: var(--ink-soft);
		max-width: var(--measure);
		margin: 0.4rem 0 1.25rem;
	}
	.empty,
	.count {
		color: var(--ink-soft);
	}
	.flash {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		padding: 0.6rem 1rem;
		background: #e7f2ec;
		border-left: 4px solid var(--ok);
		margin: 0 0 1rem;
		max-width: 44rem;
	}
	.flash.error {
		background: #fbeceb;
		border-left-color: var(--rule-red);
	}
	.pairs {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 1rem;
		max-width: 44rem;
	}
	.card {
		background: var(--card);
		border: 1px solid var(--line);
		border-top: 3px solid var(--rule-red);
		border-radius: var(--radius);
		padding: 0.9rem 1rem 1rem;
	}
	header {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: baseline;
	}
	.score {
		font-weight: 700;
	}
	.mark {
		background: var(--highlight);
		color: var(--highlight-ink);
		padding: 0.05rem 0.55rem;
		border-radius: 999px;
		font-size: var(--step--1);
	}
	.sides {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 0.75rem;
		margin: 0.6rem 0;
	}
	h2 {
		font-size: var(--step-1);
	}
	h2 a {
		display: inline-block;
		min-height: 44px;
		padding: 0.4rem 0;
	}
	.meta {
		color: var(--ink-soft);
		font-size: var(--step--1);
		margin: 0.15rem 0 0;
	}
	.elements {
		margin: 0.5rem 0;
		font-size: var(--step--1);
	}
	.elements dt {
		font-weight: 600;
		margin-top: 0.35rem;
	}
	.elements dd {
		margin: 0;
	}
	.compare {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		font-weight: 600;
	}
	.actions {
		display: grid;
		gap: 0.25rem;
		border-top: 1px solid var(--line);
		padding-top: 0.5rem;
	}
	summary {
		cursor: pointer;
		color: var(--link);
		font-weight: 600;
		min-height: 44px;
		display: flex;
		align-items: center;
	}
	details[open] summary {
		color: var(--ink);
	}
	details form {
		display: grid;
		gap: 0.4rem;
		padding: 0 0 0.75rem;
	}
	.help {
		margin: 0 0 0.25rem;
		font-size: var(--step--1);
		color: var(--ink-soft);
		max-width: var(--measure);
	}
	label {
		font-weight: 600;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		display: grid;
	}
	.radio {
		font-weight: normal;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 44px;
	}
	input[type='text'] {
		min-height: 44px;
		font: inherit;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--card);
		color: var(--ink);
	}
	.btn {
		min-height: 44px;
	}
	.pager {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin: 1rem 0;
	}
</style>
