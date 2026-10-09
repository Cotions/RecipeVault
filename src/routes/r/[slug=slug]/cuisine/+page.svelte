<script lang="ts">
	// Kitchen mode (PLANNING.md, "Kitchen mode"): a phone or tablet against the
	// backsplash, wet hands, a glance from a metre away. Screen kept on, big
	// type, ingredients as a checklist, one step at a time with large tap
	// zones, timers that survive reloads, everything resumable and offline.
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { t } from '$lib/i18n/fr';
	import IngredientLine from '$lib/components/IngredientLine.svelte';
	import Marked from '$lib/components/Marked.svelte';
	import { parseBody } from '$lib/vault/body';
	import { formatNumber } from '$lib/render/fraction';
	import { formatSeconds } from '$lib/render/duration';
	import { formatAmount, ingredientText } from '$lib/render/ingredient';
	import { renderInline } from '$lib/render/markdown';
	import { amountQuery, canOpenSub, capFactor, MULTIPLIERS, paramFactor, servingsStep, subRecipeScale } from '$lib/render/scale';
	import type { Ingredient, Recipe } from '$lib/vault/types';
	import { stepIngredients } from '$lib/render/steps';
	import { plainText } from '$lib/render/markers';
	import { formatOven } from '$lib/render/temperature';
	import { clock, findDurations } from '$lib/render/timers';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const recipe = $derived(data.recipe);
	const lang = $derived(recipe.lang);
	const steps = $derived(parseBody(data.body).body.steps);
	const subs = $derived(Object.fromEntries(data.subs.map((s) => [s.slug, s])));
	const oven = $derived(recipe.oven ? formatOven(recipe.oven) : null);

	interface Timer {
		id: string;
		label: string;
		step: number;
		/** Epoch ms when it rings: stored, not a countdown, so reloads and sleeping tabs stay right. */
		end: number;
		total: number;
		done?: boolean;
	}

	interface Saved {
		/** Which recipe content the session belongs to: ticks are by position. */
		v: string;
		/** Last change, epoch ms: an old session is not resumed. */
		at: number;
		step: number;
		ticks: string[];
		/** The scaling factor (plan 05). Older sessions stored `servings` or `multiplier`. */
		factor: number;
		servings?: number;
		multiplier?: number;
		timers: Timer[];
		dark: boolean;
	}

	// svelte-ignore state_referenced_locally -- one recipe per page instance
	const key = `rv-kitchen:${data.recipe.slug}`;
	// -1: the ingredient checklist; 0…n-1: steps; n: done.
	let step = $state(-1);
	let ticks = $state<Set<string>>(new Set());
	let factor = $state(1);
	let timers = $state<Timer[]>([]);
	let dark = $state(false);
	let now = $state(Date.now());
	let notice = $state(false);
	let open = $state<Record<string, boolean>>({});
	let restored = false;

	/** A session older than this is a new cook, not a resume. */
	const SESSION_MS = 12 * 3600 * 1000;

	/** FNV-1a of the ingredient list and steps: a replaced recipe file starts a fresh session. */
	function fingerprint(s: string): string {
		let h = 0x811c9dc5;
		for (let i = 0; i < s.length; i++) {
			h ^= s.charCodeAt(i);
			h = Math.imul(h, 0x01000193);
		}
		return (h >>> 0).toString(36);
	}
	const version = $derived(fingerprint(JSON.stringify([recipe.ingredients, steps.map((x) => x.text)])));

	/** The servings at the factor: the stepper moves to the next whole number. */
	const servingsNow = $derived(recipe.servings ? recipe.servings * factor : 0);
	const multipliers = $derived(MULTIPLIERS.includes(factor as (typeof MULTIPLIERS)[number]) ? [...MULTIPLIERS] : [...MULTIPLIERS, factor].sort((a, b) => a - b));
	function stepServings(dir: 1 | -1) {
		const next = servingsStep(servingsNow, recipe.servings!, dir, data.scaling);
		if (next) factor = next.factor;
	}

	function load() {
		const url = page.url.searchParams;
		dark = matchMedia('(prefers-color-scheme: dark)').matches;
		try {
			const s: Partial<Saved> = JSON.parse(localStorage.getItem(key) ?? '{}');
			if (typeof s.dark === 'boolean') dark = s.dark;
			// Resume only the same recipe content, recently, and not a finished cook.
			const resume = s.v === version && typeof s.at === 'number' && Date.now() - s.at < SESSION_MS && typeof s.step === 'number' && s.step < steps.length;
			if (resume) {
				step = Math.max(-1, s.step!);
				if (s.ticks) ticks = new Set(s.ticks);
				const saved =
					typeof s.factor === 'number' ? s.factor : recipe.servings && typeof s.servings === 'number' ? s.servings / recipe.servings : typeof s.multiplier === 'number' ? s.multiplier : undefined;
				const f = saved === undefined ? undefined : capFactor(saved, data.scaling);
				if (f !== undefined) factor = f;
				if (s.timers) timers = s.timers;
			}
		} catch {
			// a broken entry: start fresh
		}
		// The amount chosen on the recipe page wins over the session. It is then
		// dropped from the address, so a reload resumes what was set here.
		const asked = paramFactor(url, recipe, data.scaling);
		if (asked !== undefined) factor = asked;
		if (url.has('portions') || url.has('fois')) {
			try {
				replaceState(page.url.pathname, page.state);
			} catch {
				// the router is not ready: the parameter stays, harmless
			}
		}
		restored = true;
	}

	function restart() {
		step = -1;
		ticks = new Set();
		timers = [];
	}

	$effect(() => {
		const snapshot: Saved = { v: version, at: Date.now(), step, ticks: [...ticks], factor, timers, dark };
		if (restored) localStorage.setItem(key, JSON.stringify(snapshot));
	});

	// --- screen stays on ------------------------------------------------------

	let lock: WakeLockSentinel | null = null;
	async function keepAwake() {
		if (document.visibilityState !== 'visible') return;
		try {
			if (!('wakeLock' in navigator)) throw new Error('unsupported');
			lock = await navigator.wakeLock.request('screen');
		} catch {
			if (!localStorage.getItem('rv-wakelock-notice')) notice = true;
		}
	}
	function dismissNotice() {
		notice = false;
		localStorage.setItem('rv-wakelock-notice', '1');
	}

	// --- timers ---------------------------------------------------------------

	let audio: AudioContext | null = null;
	function ring() {
		try {
			audio ??= new AudioContext();
			for (let i = 0; i < 3; i++) {
				const o = audio.createOscillator();
				const g = audio.createGain();
				o.frequency.value = 880;
				g.gain.setValueAtTime(0.0001, audio.currentTime + i * 0.5);
				g.gain.exponentialRampToValueAtTime(0.4, audio.currentTime + i * 0.5 + 0.02);
				g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + i * 0.5 + 0.35);
				o.connect(g).connect(audio.destination);
				o.start(audio.currentTime + i * 0.5);
				o.stop(audio.currentTime + i * 0.5 + 0.4);
			}
		} catch {
			// no sound available
		}
		navigator.vibrate?.([400, 200, 400, 200, 400]);
	}

	function startTimer(seconds: number, label: string, stepIndex: number) {
		audio ??= new AudioContext(); // unlocked by this tap, so the alarm can play later
		timers = [...timers, { id: `${Date.now()}-${Math.random()}`, label, step: stepIndex, end: Date.now() + seconds * 1000, total: seconds }];
	}
	function stopTimer(id: string) {
		timers = timers.filter((x) => x.id !== id);
	}

	let tickHandle: ReturnType<typeof setInterval> | undefined;
	function tick() {
		now = Date.now();
		let rang = false;
		timers = timers.map((x) => {
			if (!x.done && x.end <= now) {
				rang = true;
				return { ...x, done: true };
			}
			return x;
		});
		if (rang) ring();
	}

	// --- navigation -----------------------------------------------------------

	function go(delta: number) {
		step = Math.max(-1, Math.min(steps.length, step + delta));
	}

	let startX = 0;
	let startY = 0;
	function onPointerDown(e: PointerEvent) {
		startX = e.clientX;
		startY = e.clientY;
	}
	function onPointerUp(e: PointerEvent) {
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;
		if ((e.target as HTMLElement).closest('button, a, input, label, summary')) return;
		if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) return go(dx < 0 ? 1 : -1);
		if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
			const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
			go(e.clientX - rect.left < rect.width / 2 ? -1 : 1);
		}
	}
	function onKey(e: KeyboardEvent) {
		// Not a browser shortcut (Alt+← is Back), not typing, not Space on a focused button (a timer, the servings).
		if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
		const target = e.target as HTMLElement;
		if (target.closest('input, select, textarea, [contenteditable]')) return;
		if (e.key === ' ' && target.closest('button, a, summary')) return;
		if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
			e.preventDefault();
			go(1);
		} else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
			e.preventDefault();
			go(-1);
		}
	}

	// --- step text with timer buttons ----------------------------------------

	/** Q6 B: at another amount, each measure in a step gets its scaled value beside it. */
	function stepScale(f: number, stepLang: Recipe['lang']) {
		return f === 1 ? undefined : { factor: f, lang: stepLang, rules: data.scaling, title: t.scaling.stepAmountTitle(formatNumber(f, 'fr')) };
	}

	type Piece = { html: string } | { seconds: number; max?: number; text: string };
	function pieces(text: string): Piece[] {
		const out: Piece[] = [];
		let last = 0;
		// The timers read the original text; the amounts are marked inside the text between them.
		const opts = { resolve: (s: string) => data.titles[s], scale: stepScale(factor, lang) };
		for (const d of findDurations(text)) {
			if (d.start > last) out.push({ html: renderInline(text.slice(last, d.start), opts) });
			out.push({ seconds: d.maxSeconds ?? d.seconds, max: d.maxSeconds, text: d.text });
			last = d.end;
		}
		if (last < text.length) out.push({ html: renderInline(text.slice(last), opts) });
		return out;
	}

	// --- sub-recipes (Q5 A) ------------------------------------------------------

	/**
	 * A sub-recipe's expansion at the amount its line needs at `at` (the factor
	 * of the level holding the line: the page's, or the enclosing expansion's,
	 * so nested factors multiply), or as written with its yield.
	 */
	function subView(item: Ingredient, sub: Recipe, at: number): { factor: number; scaled: boolean; whole?: string | null } {
		const f = subRecipeScale(item, sub, data.conversions, at, data.scaling);
		if (f !== undefined) return { factor: f, scaled: f !== 1 };
		// Not scalable by the rule: as written, saying how much the whole recipe makes.
		const y = sub.yield;
		const yieldText = !y ? null : typeof y === 'string' ? y : [formatAmount(y, { lang: sub.lang }), y.note].filter(Boolean).join(' ');
		return { factor: 1, scaled: false, whole: yieldText ?? (sub.servings ? t.card.servings(sub.servings, sub.servingsMax) : null) };
	}

	const tickKey = (g: number, i: number) => `${g}:${i}`;
	function toggleTick(k: string) {
		const next = new Set(ticks);
		if (next.has(k)) next.delete(k);
		else next.add(k);
		ticks = next;
	}

	onMount(() => {
		load();
		keepAwake();
		tick();
		tickHandle = setInterval(tick, 500);
		const vis = () => {
			if (document.visibilityState === 'visible') {
				keepAwake();
				tick();
			}
		};
		document.addEventListener('visibilitychange', vis);
		return () => document.removeEventListener('visibilitychange', vis);
	});
	onDestroy(() => {
		clearInterval(tickHandle);
		lock?.release().catch(() => {});
	});

	const current = $derived(step >= 0 && step < steps.length ? steps[step] : null);
	const stepLines = $derived(current ? stepIngredients(current.text, recipe.ingredients, data.plural) : []);
</script>

<svelte:head>
	<title>{plainText(recipe.title)} — {t.recipe.cookMode}</title>
	<meta name="theme-color" content={dark ? '#0f1520' : '#fffffd'} />
</svelte:head>

<svelte:window onkeydown={onKey} />

<!-- A sub-recipe line's expansion, and inside it its own sub-recipes' (Q5 A,
     issue #13): each level at the amount its line needs at the level above.
     Keyed by position, so the same sub-recipe opens separately in two places. -->
{#snippet subRecipe(item: Ingredient, at: number, path: string[], key: string)}
	{#if item.recipe && subs[item.recipe] && canOpenSub(item.recipe, path)}
		{@const sub = subs[item.recipe]}
		<button class="expand" type="button" aria-expanded={!!open[key]} onclick={() => (open[key] = !open[key])}>
			{open[key] ? t.kitchen.collapse : t.kitchen.expand}
		</button>
		{#if open[key]}
			{@const sv = subView(item, sub.recipe, at)}
			<div class="sub">
				<p class="subtitle"><Marked text={sub.recipe.title} />{#if sv.scaled}{' '}<span class="subscale">{t.scaling.subScaled(formatNumber(sv.factor, 'fr'))}</span>{/if}</p>
				{#if sv.whole !== undefined}<p class="subwhole">{t.scaling.subWhole(sv.whole)}</p>{/if}
				<ul>
					{#each sub.recipe.ingredients.flatMap((sg) => sg.items) as si, sk (sk)}
						<li>
							<IngredientLine item={si} factor={sv.factor} lang={sub.recipe.lang} rules={data.scaling} />
							{@render subRecipe(si, sv.factor, [...path, sub.slug], `${key}/${sk}`)}
						</li>
					{/each}
				</ul>
				<ol>
					{#each parseBody(sub.body).body.steps as ss, sk (sk)}
						<li>{@html renderInline(ss.text, { scale: stepScale(sv.factor, sub.recipe.lang) })}</li>
					{/each}
				</ol>
			</div>
		{/if}
	{/if}
{/snippet}

<div class="kitchen" class:dark>
	<header class="top">
		<!-- Back to the recipe at the amount cooked here (plan 05, Q1 A: the amount lives in the address). -->
		<a class="quit" href="/r/{recipe.slug}{amountQuery(recipe, factor)}">← {t.kitchen.back}</a>
		<p class="name"><Marked text={recipe.title} /></p>
		<div class="tools">
			{#if recipe.servings}
				<div class="scaler">
					<button type="button" aria-label={t.recipe.decrease} disabled={!servingsStep(servingsNow, recipe.servings, -1, data.scaling)} onclick={() => stepServings(-1)}>−</button>
					<output aria-live="polite">{formatNumber(servingsNow, lang)} <span class="unit">{t.recipe.scale.toLowerCase()}</span></output>
					<button type="button" aria-label={t.recipe.increase} disabled={!servingsStep(servingsNow, recipe.servings, 1, data.scaling)} onclick={() => stepServings(1)}>+</button>
				</div>
			{:else}
				<select aria-label={t.recipe.scaleFactor} bind:value={factor}>
					{#each multipliers as m (m)}<option value={m}>× {formatNumber(m, lang)}</option>{/each}
				</select>
			{/if}
			<button class="mode" type="button" onclick={() => (dark = !dark)}>{dark ? t.kitchen.light : t.kitchen.dark}</button>
		</div>
	</header>

	{#if notice}
		<p class="notice" role="status">{t.kitchen.wakeLock}<button type="button" onclick={dismissNotice}>{t.kitchen.dismiss}</button></p>
	{/if}

	{#if timers.length}
		<ul class="timers" aria-label={t.kitchen.timer}>
			{#each timers as tm (tm.id)}
				<li class:done={tm.done}>
					<span class="tlabel">{tm.label}</span>
					<span class="clock" role="timer">{tm.done ? t.kitchen.finished : clock(tm.end - now)}</span>
					<button type="button" onclick={() => stopTimer(tm.id)}>{t.kitchen.stop}</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if step === -1}
		<section class="ingredients">
			{#if data.photo?.src}<img class="photo" src={data.photo.src} alt={t.recipe.photo} />{/if}
			<h1>{t.kitchen.ingredients}</h1>
			{#if oven}<p class="oven">{t.recipe.oven} : <strong>{oven.written}</strong> · {oven.converted}</p>{/if}
			{#each recipe.ingredients as g, gi (gi)}
				{#if g.group || g.optional}<h2>{#if g.group}<Marked text={g.group} />{/if}{#if g.optional} <span class="opt">({t.recipe.optionalGroup})</span>{/if}</h2>{/if}
				<ul>
					{#each g.items as item, ii (ii)}
						{@const k = tickKey(gi, ii)}
						<li class:ticked={ticks.has(k)}>
							<label>
								<input type="checkbox" checked={ticks.has(k)} onchange={() => toggleTick(k)} />
								<span><IngredientLine {item} {factor} {lang} titles={{}} rules={data.scaling} /></span>
							</label>
							{@render subRecipe(item, factor, [recipe.slug], k)}
						</li>
					{/each}
				</ul>
			{/each}
			<button class="start" type="button" onclick={() => (step = 0)} disabled={!steps.length}>{t.kitchen.start} →</button>
			{#if !steps.length}<p>{t.kitchen.noSteps}</p>{/if}
		</section>
	{:else}
		<!-- Left half goes back, right half goes forward; swipe works too. The
		     pager buttons and arrow keys do the same for keyboards and screen readers. -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<section class="stage" aria-live="polite" onpointerdown={onPointerDown} onpointerup={onPointerUp}>
			{#if step < steps.length}
				<p class="count">
					{t.kitchen.step(step + 1, steps.length)}{#if current?.subheading}{` · ${current.subheading}`}{/if}
				</p>
				{#if factor !== 1}<p class="scale-notice" role="note">{t.scaling.stepNotice(formatNumber(factor, 'fr'))}{#if pieces(current!.text).some((p) => 'html' in p && p.html.includes('class="step-scaled"'))}{' '}{t.scaling.arrowNotice}{/if}</p>{/if}
				{#if step > 0}<p class="ghost prev">{plainText(steps[step - 1].text, (s) => data.titles[s])}</p>{/if}
				<p class="now">
					{#each pieces(current!.text) as p, i (i)}
						{#if 'html' in p}{@html p.html}{:else}<button
								class="timer"
								type="button"
								onclick={() => startTimer(p.seconds, `${t.kitchen.stepShort(step + 1)} · ${p.max ? t.kitchen.timerUpTo(formatSeconds(p.seconds, lang)) : formatSeconds(p.seconds, lang)}`, step)}
								>⏱ {p.text}</button
							>{/if}
					{/each}
				</p>
				{#if stepLines.length}
					<ul class="step-ings">
						{#each stepLines as s (`${s.group}:${s.item}`)}
							<li>{ingredientText(s.ingredient, { factor, lang, rules: data.scaling })}</li>
						{/each}
					</ul>
				{/if}
				{#if step < steps.length - 1}<p class="ghost next">{plainText(steps[step + 1].text, (s) => data.titles[s])}</p>{/if}
			{:else}
				<p class="now done">{t.kitchen.done}</p>
				<button class="start restart" type="button" onclick={restart}>{t.kitchen.restart}</button>
			{/if}
		</section>
		<nav class="pager">
			<button type="button" onclick={() => go(-1)}>← {step === 0 ? t.kitchen.list : t.kitchen.prev}</button>
			{#if step < steps.length}<button type="button" class="primary" onclick={() => go(1)}>{t.kitchen.next} →</button>{/if}
		</nav>
	{/if}
</div>

<style>
	.kitchen {
		--bg: #fffffd;
		--fg: #121b2b;
		--soft: #56607a;
		--line: #cfdcec;
		--accent: #b3302c;
		--btn: #eef2f7;
		min-height: 100dvh;
		background: var(--bg);
		color: var(--fg);
		font-family: var(--sans);
		font-size: 1.25rem;
		display: flex;
		flex-direction: column;
		user-select: none;
	}
	.kitchen.dark {
		--bg: #0f1520;
		--fg: #f3f5f8;
		--soft: #9aa6bb;
		--line: #2a3548;
		--accent: #ff8a80;
		--btn: #1d2738;
		color-scheme: dark;
	}
	.top {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		border-bottom: 3px solid var(--accent);
		flex-wrap: wrap;
	}
	.quit {
		color: var(--fg);
		font-weight: 600;
		text-decoration: none;
		padding: 0.5rem 0.25rem;
	}
	.name {
		margin: 0;
		flex: 1;
		min-width: 8rem;
		font-family: var(--serif);
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tools {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.scaler {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
	.scaler .unit {
		font-weight: 400;
		font-size: 0.9rem;
		color: var(--soft);
	}
	.scaler output {
		min-width: 2ch;
		text-align: center;
		font-weight: 700;
	}
	button,
	select {
		min-height: 3rem;
		min-width: 3rem;
		border: 2px solid var(--fg);
		background: var(--btn);
		color: var(--fg);
		border-radius: 6px;
		font-size: 1.1rem;
		font-weight: 600;
		cursor: pointer;
		padding: 0 0.75rem;
	}
	button:disabled {
		opacity: 0.4;
	}
	.notice {
		margin: 0;
		padding: 0.5rem 0.75rem;
		background: #f6e27a;
		color: #3b2f00;
		font-size: 1rem;
	}
	.notice button {
		min-height: 2.25rem;
		margin-left: 0.5rem;
		border-color: #3b2f00;
		background: transparent;
		color: inherit;
	}
	.timers {
		list-style: none;
		margin: 0;
		padding: 0.5rem 0.75rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		border-bottom: 1px solid var(--line);
		position: sticky;
		top: 0;
		background: var(--bg);
		z-index: 2;
	}
	.timers li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.25rem 0.4rem 0.25rem 0.8rem;
		border: 2px solid var(--fg);
		border-radius: 6px;
	}
	.timers li.done {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
		animation: pulse 1s infinite alternate;
	}
	@keyframes pulse {
		to {
			opacity: 0.65;
		}
	}
	.tlabel {
		font-size: 0.95rem;
	}
	.clock {
		font-size: 1.6rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	.timers button {
		min-height: 2.5rem;
	}
	.ingredients {
		padding: 1rem 1rem 6rem;
		max-width: 44rem;
		width: 100%;
		margin: 0 auto;
	}
	h1 {
		font-size: 2rem;
	}
	.photo {
		display: block;
		width: 100%;
		max-height: 12rem;
		object-fit: cover;
		border-radius: 6px;
		margin-bottom: 1rem;
	}
	h2 {
		font-family: var(--sans);
		font-size: 1.2rem;
		margin: 1.25rem 0 0.25rem;
		color: var(--soft);
	}
	.oven {
		margin: 0.5rem 0 0;
		font-size: 1.4rem;
	}
	.ingredients > ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.ingredients > ul > li {
		border-bottom: 1px solid var(--line);
		padding: 0.25rem 0;
	}
	.ingredients label {
		display: flex;
		gap: 0.9rem;
		align-items: flex-start;
		padding: 0.6rem 0;
		cursor: pointer;
		font-size: 1.45rem;
		line-height: 1.35;
	}
	.ingredients input[type='checkbox'] {
		width: 2rem;
		height: 2rem;
		flex: none;
		accent-color: var(--accent);
	}
	li.ticked span {
		text-decoration: line-through;
		opacity: 0.5;
	}
	.opt {
		font-weight: 400;
	}
	.expand {
		min-height: 2.5rem;
		margin: 0 0 0.5rem 2.9rem;
		font-size: 1rem;
	}
	.sub {
		margin: 0 0 0.75rem 2.9rem;
		padding: 0.5rem 0.9rem;
		border-left: 3px solid var(--accent);
		font-size: 1.15rem;
	}
	.sub .expand,
	.sub .sub {
		margin-left: 0.25rem;
	}
	.sub .expand {
		display: block;
		margin-top: 0.25rem;
	}
	.subtitle {
		font-weight: 700;
		margin: 0;
	}
	.subscale {
		color: var(--accent);
		font-size: 0.95rem;
	}
	.subwhole {
		margin: 0.25rem 0 0;
		color: var(--soft);
		font-size: 1rem;
	}
	.scale-notice {
		margin: 0.5rem 0;
		color: var(--soft);
		font-size: 1rem;
		border-left: 3px solid var(--accent);
		padding-left: 0.6rem;
	}
	.now :global(.step-scaled),
	.sub :global(.step-scaled) {
		font-family: var(--sans);
		font-weight: 800;
		color: var(--accent);
		white-space: nowrap;
	}
	.start {
		margin-top: 1.5rem;
		width: 100%;
		min-height: 4rem;
		font-size: 1.5rem;
		background: var(--fg);
		color: var(--bg);
	}
	.stage {
		flex: 1;
		padding: 1rem 1.25rem;
		max-width: 52rem;
		width: 100%;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		justify-content: center;
		touch-action: pan-y;
	}
	.count {
		margin: 0 0 0.5rem;
		color: var(--accent);
		font-weight: 800;
		font-size: 1.25rem;
	}
	.ghost {
		color: var(--soft);
		opacity: 0.55;
		font-size: 1.15rem;
		margin: 0.5rem 0;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.now {
		font-family: var(--serif);
		font-size: clamp(1.75rem, 5.5vw, 2.75rem);
		line-height: 1.35;
		margin: 0.75rem 0;
		user-select: text;
	}
	.now.done {
		text-align: center;
	}
	.timer {
		font-family: var(--sans);
		font-size: 0.8em;
		min-height: 2.75rem;
		margin: 0 0.15em;
		border-color: var(--accent);
		color: var(--fg);
		vertical-align: baseline;
	}
	.step-ings {
		list-style: none;
		padding: 0.5rem 0 0.5rem 0.9rem;
		margin: 0.25rem 0 0.5rem;
		border-left: 3px solid var(--accent);
		font-size: 1.35rem;
		font-weight: 600;
	}
	.pager {
		display: flex;
		gap: 0.75rem;
		padding: 0.75rem;
		border-top: 1px solid var(--line);
		position: sticky;
		bottom: 0;
		background: var(--bg);
	}
	.pager button {
		flex: 1;
		min-height: 4rem;
		font-size: 1.3rem;
	}
	.pager .primary {
		background: var(--fg);
		color: var(--bg);
	}
	.kitchen :global(mark.mk) {
		font-size: 0.7em;
	}
</style>
