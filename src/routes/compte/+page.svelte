<script lang="ts">
	import PageHead from '$lib/components/PageHead.svelte';
	import { t } from '$lib/i18n';
	import { DEFAULT_PREFS, LANGS, UNIT_SYSTEMS, WORD_MAX } from '$lib/prefs';
	import { UNITS, type Lang } from '$lib/vault/types';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const mine = $derived(data.prefs ?? DEFAULT_PREFS);
	// The usual words follow the language being chosen, before it is saved.
	// svelte-ignore state_referenced_locally
	let lang = $state<Lang>(mine.lang);
	/** The vault's word for a unit in the chosen language; its code when the vault has none. */
	const usual = $derived((unit: (typeof UNITS)[number]) => data.unitWords?.[unit]?.[lang] ?? [unit, unit]);
</script>

<svelte:head><title>{t.account.title} — {t.app.name}</title></svelte:head>

<PageHead title={t.account.title} intro={t.account.intro} />

{#if form?.message}
	<p class="flash error" role="alert">{form.message}</p>
{:else if data.saved}
	<p class="flash ok" role="status">{t.account.saved}</p>
{/if}

<!-- No `use:enhance`: the page is loaded again, in the language and measures just chosen. -->
<form class="prefs" method="POST">
	<section>
		<h2><label for="langue">{t.account.lang}</label></h2>
		<p class="help">{t.account.langHelp}</p>
		<select id="langue" name="langue" bind:value={lang}>
			{#each LANGS as l (l)}
				<option value={l}>{t.account.langs[l]}</option>
			{/each}
		</select>
	</section>

	<fieldset>
		<legend>{t.account.system}</legend>
		<p class="help">{t.account.systemHelp}</p>
		{#each UNIT_SYSTEMS as s (s)}
			<label class="choice">
				<input type="radio" name="mesures" value={s} checked={mine.system === s} />
				<span>
					<strong>{t.account.systems[s]}</strong>
					<span class="hint">{t.account.systemHints[s]}</span>
				</span>
			</label>
		{/each}
		<p class="help note">{t.account.systemNote}</p>
	</fieldset>

	<section>
		<h2>{t.account.words}</h2>
		<p class="help">{t.account.wordsHelp}</p>
		<div class="words" role="table" aria-label={t.account.words}>
			<div class="row head" role="row">
				<span role="columnheader">{t.account.unit}</span>
				<span role="columnheader">{t.account.one}</span>
				<span role="columnheader">{t.account.many}</span>
			</div>
			{#each UNITS as unit (unit)}
				{@const [one, many] = usual(unit)}
				<div class="row" role="row">
					<span class="usual" role="cell">{one}</span>
					<span role="cell"
						><input type="text" name="un-{unit}" value={mine.words[unit]?.[0] ?? ''} placeholder={one} maxlength={WORD_MAX} autocomplete="off" autocapitalize="none" aria-label={t.account.oneFor(one)} /></span
					>
					<span role="cell"
						><input
							type="text"
							name="des-{unit}"
							value={mine.words[unit] && mine.words[unit][1] !== mine.words[unit][0] ? mine.words[unit][1] : ''}
							placeholder={many}
							maxlength={WORD_MAX}
							autocomplete="off"
							autocapitalize="none"
							aria-label={t.account.manyFor(one)}
						/></span
					>
				</div>
			{/each}
		</div>
	</section>

	<button class="btn primary" type="submit">{t.account.save}</button>
</form>

<style>
	h2,
	legend {
		font-size: var(--step-1);
		font-weight: 700;
		margin: 0;
		padding: 0;
	}
	.prefs {
		display: grid;
		gap: 2rem;
		max-width: 36rem;
	}
	fieldset {
		border: 0;
		margin: 0;
		padding: 0;
		min-width: 0;
	}
	.help {
		color: var(--ink-soft);
		margin: 0.25rem 0 0.75rem;
	}
	.help.note {
		margin: 0.75rem 0 0;
		font-size: 0.95rem;
	}
	select,
	input[type='text'] {
		border: 1.5px solid #b7c0cc;
		border-radius: var(--radius);
		background: var(--card);
		padding: 0.5rem 0.7rem;
		min-height: 2.75rem;
		font-size: 1.05rem;
	}
	input[type='text'] {
		width: 100%;
		min-width: 0;
	}
	.choice {
		display: flex;
		align-items: flex-start;
		gap: 0.7rem;
		padding: 0.5rem 0;
		min-height: 2.75rem;
	}
	.choice input {
		width: 1.4rem;
		height: 1.4rem;
		margin-top: 0.15rem;
		flex: none;
	}
	.choice span {
		display: grid;
	}
	.hint {
		color: var(--ink-soft);
	}
	.words {
		display: grid;
		gap: 0.4rem;
	}
	.row {
		display: grid;
		grid-template-columns: minmax(5.5rem, 1fr) minmax(0, 1.4fr) minmax(0, 1.4fr);
		gap: 0.5rem;
		align-items: center;
	}
	.row.head {
		color: var(--ink-soft);
		font-size: 0.9rem;
		font-weight: 600;
	}
	.usual {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.btn {
		min-height: 2.9rem;
		justify-self: start;
	}
	.flash {
		padding: 0.6rem 1rem;
		border-radius: var(--radius);
		max-width: 36rem;
	}
	.flash.error {
		background: #fbeaea;
		color: var(--rule-red);
	}
	.flash.ok {
		background: #e8f3ea;
		color: #1f5a2c;
	}
</style>
