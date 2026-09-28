<script lang="ts">
	import { enhance } from '$app/forms';
	import { t } from '$lib/i18n/fr';
	import { queueRowId } from '$lib/render/links';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** Keep the page where it is: the row that was settled disappears, the next one moves up. */
	const keep = () => async ({ update }: { update: (o?: { reset?: boolean; invalidateAll?: boolean }) => Promise<void> }) => update({ reset: false });
	const browseHref = (name: string) => `/?q=${encodeURIComponent(name)}&relies=non`;
</script>

<svelte:head><title>{t.queue.title} — {t.app.name}</title></svelte:head>

<h1>{t.queue.title}</h1>
<p class="intro">{t.queue.intro}</p>

{#if data.gone && !form?.message}
	<p class="flash" role="status">{t.queue.gone}</p>
{/if}
{#if form?.message}
	<p class="flash" class:error={!form.ok} role={form.ok ? 'status' : 'alert'}>{form.message}</p>
{/if}

<datalist id="entries">
	{#each data.entries as e (e.slug)}
		<option value={e.slug}>{e.name}</option>
	{/each}
</datalist>

{#if data.rows.length}
	<ol class="queue">
		{#each data.rows as row, ri (row.key)}
			<li class="row" id={queueRowId(row.key)} data-key={row.key}>
				<div class="head">
					<h2 class="name">{row.forms[0].name}</h2>
					<span class="count">{t.queue.count(row.count, row.recipes)} · {t.queue.lang[row.lang] ?? row.lang}</span>
					<a class="see" href={browseHref(row.forms[0].name)}>{t.queue.recipes}</a>
				</div>
				{#if row.forms.length > 1}
					<p class="forms">
						{#each row.forms as f, i (f.name)}{i ? ' · ' : ''}« {f.name} » ({f.count}){/each}
					</p>
				{/if}

				{#if row.ambiguous}
					<p class="warn">{t.queue.ambiguous}</p>
					{#if row.ruleClash.length}
						<p class="warn" data-rule-clash>{t.queue.ruleClash(row.ruleClash.map((s) => `« ${row.candidates.find((c) => c.slug === s)?.name ?? s} »`).join(' et de '))}</p>
					{/if}
					<h3>{t.queue.owners}</h3>
					<ul class="cands">
						{#each row.candidates as c (c.slug)}
							<li>
								<span class="cand">{c.name} <code>{c.slug}</code></span>
								<form method="POST" action="?/unlink" use:enhance={keep}>
									<input type="hidden" name="key" value={row.key} />
									<input type="hidden" name="slug" value={c.slug} />
									<input type="hidden" name="hash" value={c.hash} />
									<button class="btn" type="submit">{t.queue.remove(c.name)}</button>
								</form>
							</li>
						{/each}
					</ul>
				{:else}
					<h3>{t.queue.suggestions}</h3>
					{#if row.candidates.length}
						<ul class="cands">
							{#each row.candidates as c (c.slug)}
								<li>
									<span class="cand">{c.name} <code>{c.slug}</code></span>
									<form method="POST" action="?/link" use:enhance={keep}>
										<input type="hidden" name="key" value={row.key} />
										<input type="hidden" name="form" value={row.forms[0].name} />
										<input type="hidden" name="slug" value={c.slug} />
										<input type="hidden" name="hash" value={c.hash} />
										<button class="btn primary" type="submit">{t.queue.thisOne}</button>
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
						<form method="POST" action="?/link" use:enhance={keep}>
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
					<form method="POST" action="?/rule" use:enhance={keep}>
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
						<form method="POST" action="?/create" use:enhance={keep}>
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
	{#if data.total > data.rows.length}
		<p class="intro">{t.queue.more(data.total - data.rows.length)}</p>
	{/if}
{:else}
	<p class="intro">{t.queue.empty}</p>
{/if}

<style>
	h1 {
		font-size: var(--step-3);
	}
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
		border-top: 2px solid var(--rule-red);
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
	.cand code {
		color: var(--ink-soft);
		font-size: var(--step--1);
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
