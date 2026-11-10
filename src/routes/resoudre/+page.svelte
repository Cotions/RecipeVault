<script lang="ts">
	import PageHead from '$lib/components/PageHead.svelte';
	import { enhance } from '$app/forms';
	import { t } from '$lib/i18n';
	import { page } from '$app/state';
	import { queueRowId } from '$lib/render/links';
	import { Settling } from '$lib/settle.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** A decision folds the row away at once and says so in the toast, with « Annuler » (lib/settle.svelte.ts). */
	const settling = new Settling();
	const keep = (key: string) => settling.form(key);
	const browseHref = (name: string) => `/?q=${encodeURIComponent(name)}&relies=non`;
	/** The same name on two entries: their file names tell them apart. */
	const twin = (cands: { name: string }[], name: string) => cands.filter((c) => c.name === name).length > 1;
	/** The rows shown. */
	const inOrder = $derived(data.rows.length);
	/**
	 * The keyboard (usability round 3): 1, 2, 3 take the row's first, second,
	 * third suggestion, Enter the first — the row holding the focus, else the
	 * first row still waiting. Never while typing in a field, nor with a
	 * modifier; Enter only when the focus is on no control of its own.
	 * Only a clear match (`strong`, lib/ingredients/resolve.ts) is taken at
	 * once (usability round 5: « huile » in 13 recipes was one key from a
	 * guess): a guess's key puts the focus on it, Enter then takes it, and
	 * Enter alone takes no guess.
	 */
	function onkey(e: KeyboardEvent) {
		if (e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
		const el = document.activeElement as HTMLElement | null;
		if (el?.closest('input, textarea, select, [contenteditable]')) return;
		const n = e.key === 'Enter' ? 1 : /^[1-9]$/.test(e.key) ? Number(e.key) : 0;
		if (!n) return;
		if (e.key === 'Enter' && el && el !== document.body && el.closest('a, button, summary')) return;
		const row = (el?.closest('li.row:not(.gone)') as HTMLElement | null) ?? document.querySelector<HTMLElement>('ol.queue > li.row:not(.gone)');
		const pick = row?.querySelectorAll<HTMLButtonElement>('[data-pick]')[n - 1];
		if (!pick) return;
		const sure = pick.hasAttribute('data-sure');
		if (e.key === 'Enter' && !sure) return;
		e.preventDefault();
		if (sure) pick.click();
		else pick.focus();
	}
	const nextHref = $derived.by(() => {
		const u = new URL(page.url);
		u.searchParams.set('n', String(data.rows.length + data.step));
		return u.pathname + u.search;
	});
</script>

<svelte:head><title>{t.queue.title} — {t.app.name}</title></svelte:head>
<svelte:window onkeydown={onkey} />

<PageHead title={t.queue.title} count={data.total ? t.queue.headCount(data.total) : null} intro={t.queue.intro} />

{#if data.gone && !form?.message}
	<p class="flash" role="status">{t.queue.gone}</p>
{/if}
<!-- Without JavaScript the decision comes back with the page; with it, in the toast. -->
{#if form?.message}
	<p class="flash" class:error={!form.ok} role={form.ok ? 'status' : 'alert'}>{form.message}</p>
{/if}

<datalist id="entries">
	{#each data.entries as e (e.slug)}
		<option value={e.slug}>{e.name}</option>
	{/each}
</datalist>

{#if data.rows.length}
	<ol class="queue" class:busy={settling.busy}>
		{#each data.rows as row, ri (row.key)}
			<li class="row" class:gone={settling.gone.has(row.key)} id={queueRowId(row.key)} data-key={row.key}>
				<div class="head">
					<h2 class="name">{row.forms[0].name}</h2>
					<span class="count">{t.queue.count(row.count, row.recipes)} · {t.queue.lang[row.lang] ?? row.lang}</span>
					<a class="see" href={browseHref(row.forms[0].name)}>{t.queue.recipes}</a>
				</div>
				{#if row.forms.length > 1}
					<p class="forms">
						{#each row.forms as f, i (f.name)}{i ? ' · ' : ''}{t.queue.form(f.name, f.count)}{/each}
					</p>
				{/if}

				{#if row.ambiguous}
					<p class="warn">{t.queue.ambiguous}</p>
					{#if row.ruleClash.length}
						<p class="warn" data-rule-clash>{t.queue.ruleClash(row.ruleClash.map((s) => row.candidates.find((c) => c.slug === s)?.name ?? s))}</p>
					{/if}
					<h3>{t.queue.owners}</h3>
					<ul class="cands">
						{#each row.candidates as c (c.slug)}
							<li>
								<span class="cand">{c.name}{#if twin(row.candidates, c.name)} <small>({c.slug})</small>{/if}</span>
								<form method="POST" action="?/unlink" use:enhance={keep(row.key)}>
									<input type="hidden" name="key" value={row.key} />
									<input type="hidden" name="slug" value={c.slug} />
									<input type="hidden" name="hash" value={c.hash} />
									<button class="btn" type="submit">{t.queue.remove(c.name)}</button>
								</form>
							</li>
						{/each}
					</ul>
				{:else}
					{@const sure = !!row.candidates[0]?.strong}
					<h3>{sure || !row.candidates.length ? t.queue.suggestions : t.queue.guesses}</h3>
					{#if row.candidates.length}
						<ul class="cands">
							{#each row.candidates as c, ci (c.slug)}
								<li>
									<span class="cand">{c.name}{#if twin(row.candidates, c.name)} <small>({c.slug})</small>{/if}</span>
									<form method="POST" action="?/link" use:enhance={keep(row.key)}>
										<input type="hidden" name="key" value={row.key} />
										<input type="hidden" name="form" value={row.forms[0].name} />
										<input type="hidden" name="slug" value={c.slug} />
										<input type="hidden" name="hash" value={c.hash} />
										<!-- The strongest first, and the key that takes it (1, 2, 3; Enter: the first) — the answer only when it is a clear match. -->
										{#if !ci && sure}
											<button class="btn primary" type="submit" data-pick data-sure aria-keyshortcuts="1 Enter" title={t.queue.key(1)}
												><kbd aria-hidden="true">1</kbd>{t.queue.thisOne}</button
											>
										{:else}
											<button class="btn" type="submit" data-pick data-sure={c.strong || undefined} aria-keyshortcuts={String(ci + 1)} title={c.strong ? t.queue.key(ci + 1) : t.queue.keyGuess(ci + 1)}
												><kbd aria-hidden="true">{ci + 1}</kbd>{t.queue.thisOne}</button
											>
										{/if}
									</form>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="none">{t.queue.none}</p>
					{/if}
				{/if}

				{#if !row.ruleClash.length}
					<details class="more">
						<summary>{t.queue.link}</summary>
						<form method="POST" action="?/link" use:enhance={keep(row.key)}>
							<input type="hidden" name="key" value={row.key} />
							<input type="hidden" name="form" value={row.forms[0].name} />
							<label>
								{t.queue.linkField}
								<input name="slug" list="entries" required autocomplete="off" />
							</label>
							<button class="btn" type="submit">{t.queue.linkSubmit}</button>
						</form>
					</details>
				{/if}
				<details class="more">
					<summary>{t.queue.rule}</summary>
					<form method="POST" action="?/rule" use:enhance={keep(row.key)}>
						<input type="hidden" name="key" value={row.key} />
						<input type="hidden" name="form" value={row.forms[0].name} />
						<p class="help">{t.queue.ruleHelp}</p>
						<label>
							{t.queue.linkField}
							<input name="slug" list={row.ambiguous ? `owners-${ri}` : 'entries'} required autocomplete="off" />
						</label>
						{#if row.ambiguous}
							<datalist id={`owners-${ri}`}>
								{#each row.candidates as c (c.slug)}
									<option value={c.slug}>{c.name}</option>
								{/each}
							</datalist>
						{/if}
						<fieldset>
							<legend>{t.queue.ruleUnits}</legend>
							{#each row.units.filter((u) => u.unit !== null) as u (u.unit)}
								<label class="check"><input type="checkbox" name="unit" value={u.unit} /> {u.unit} ({u.count})</label>
							{/each}
							{#each data.unitClasses as c (c)}
								<label class="check"><input type="checkbox" name="unit" value={c} /> {t.queue.ruleClass[c] ?? c}</label>
							{/each}
						</fieldset>
						<label>
							{t.queue.ruleWords}
							<input name="words" autocomplete="off" />
						</label>
						<p class="help">{t.queue.ruleWordsHelp}</p>
						<label class="check"><input type="checkbox" name="lang" /> {t.queue.ruleLang(t.queue.lang[row.lang] ?? row.lang)}</label>
						<button class="btn" type="submit">{t.queue.ruleSubmit}</button>
					</form>
				</details>
				{#if !row.ruleClash.length}
					<details class="more">
						<summary>{t.queue.create}</summary>
						<form method="POST" action="?/create" use:enhance={keep(row.key)}>
							<input type="hidden" name="key" value={row.key} />
							<label>
								{t.queue.slug}
								<input name="slug" value={row.slug} required pattern="[a-z0-9]+(-[a-z0-9]+)*" />
							</label>
							<p class="help">{t.queue.slugHelp}</p>
							<label>
								{t.queue.category}
								<select name="category" required>
									<option value="">{t.queue.categoryPick}</option>
									{#each data.categories as c (c)}
										<option value={c}>{t.category[c] ?? c}</option>
									{/each}
								</select>
							</label>
							<label class="check"><input type="checkbox" name="staple" /> {t.queue.staple}</label>
							<button class="btn" type="submit">{t.queue.createSubmit}</button>
						</form>
					</details>
				{/if}
			</li>
		{/each}
	</ol>
	{#if data.total > inOrder}
		<p class="more" data-testid="queue-more">
			<span>{t.queue.shown(inOrder, data.total)}</span> — <a href={nextHref} data-sveltekit-noscroll>{t.queue.next}</a>
		</p>
	{/if}
{:else}
	<p class="intro">{t.queue.empty}</p>
{/if}

<style>
	.intro {
		color: var(--ink-soft);
		font-family: var(--serif);
		font-size: var(--step-1);
		margin: 0.25rem 0 1.25rem;
		max-width: var(--measure);
	}
	.flash {
		padding: 0.6rem 1rem;
		background: #e7f2ec;
		border-left: 4px solid var(--ok);
		margin: 0 0 1rem;
		max-width: 40rem;
	}
	.flash.error {
		background: #fbeceb;
		border-left-color: var(--rule-red);
	}
	.queue {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.8rem;
		max-width: 48rem;
	}
	.row {
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 0.7rem 1rem;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.3rem 0.8rem;
	}
	.name {
		font-family: var(--serif);
		font-size: var(--step-1);
		margin: 0;
	}
	.count,
	.forms,
	.none,
	.help {
		color: var(--ink-soft);
		font-size: var(--step--1);
	}
	.forms,
	.none {
		margin: 0.3rem 0;
	}
	.see {
		font-size: var(--step--1);
	}
	.warn {
		margin: 0.4rem 0;
		font-size: var(--step--1);
	}
	h3 {
		font-size: var(--step--1);
		margin: 0.6rem 0 0.3rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--ink-soft);
	}
	.cands {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.3rem;
	}
	.cands li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	/* The key that takes a suggestion: shown where there is a keyboard. */
	kbd {
		display: none;
		font: inherit;
		font-size: var(--step--1);
		min-width: 1.3em;
		margin-right: 0.45rem;
		padding: 0 0.3em;
		border: 1px solid currentColor;
		border-radius: 3px;
		opacity: 0.75;
		text-align: center;
	}
	@media (hover: hover) and (pointer: fine) {
		kbd {
			display: inline-block;
		}
	}
	.cand small {
		color: var(--ink-soft);
	}
	/* « Retirer de « champignons en conserve » » wraps on a phone rather than push the row past the screen. */
	.cands form {
		max-width: 100%;
	}
	.cands .btn {
		white-space: normal;
		text-align: start;
	}
	/* A decision made: the row folds away at once, and no click lands on the one moving up. */
	.queue.busy {
		pointer-events: none;
	}
	.row.gone {
		display: none;
	}
	.more {
		margin: 1rem 0;
		font-size: var(--step--1);
		color: var(--ink-soft);
	}
	.more a {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		font-weight: 600;
	}
	.more {
		margin-top: 0.5rem;
	}
	.more summary {
		cursor: pointer;
		color: var(--link);
		font-weight: 600;
		font-size: var(--step--1);
	}
	.more form {
		display: grid;
		gap: 0.4rem;
		margin-top: 0.4rem;
		max-width: 28rem;
	}
	.more label {
		display: grid;
		gap: 0.15rem;
		font-weight: 600;
	}
	.more fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.9rem;
	}
	.more legend {
		font-weight: 600;
		padding: 0;
	}
	.more .check {
		display: flex;
		gap: 0.4rem;
		font-weight: 400;
	}
	.help {
		margin: 0;
	}
</style>
