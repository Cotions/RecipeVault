<script lang="ts">
	// A cook in progress on this device, on every page but kitchen mode itself
	// (PLANNING.md, "Kitchen mode"): the timer that rings soonest (« ⏱ 39:12 »,
	// its recipe beside it on a wide screen, in its name everywhere), or the
	// step to resume. A tap goes back to kitchen mode at the timer's step. A
	// timer that rings while she reads another page turns the chip red and
	// sounds the kitchen's alarm (the tab has had a tap: she came here from
	// kitchen mode); the red pulses for 30 s, then stays still.
	//
	// In the header row, at a fixed width whatever it says: app.html takes its
	// place before the first paint (`html[data-cook]`), so the header never
	// grows or shifts once the page is up. Beside the chip, one more button:
	// « +1 » with other recipes cooking (the list of them), else × to put a
	// rung timer or a step to resume away.
	//
	// Read from localStorage (`rv-kitchen:<slug>`, lib/kitchensession.ts) in
	// the browser only. Signed out: none, and signing out clears them.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { t } from '$lib/i18n';
	import { chipId, chipShown, cookHref, cookItems, createRinger, endCook, markSeen, readCooks, timeLeft, type CookItem } from '$lib/kitchensession';
	import { ring } from '$lib/ring';
	import { clock } from '$lib/render/timers';

	let { signedIn = true }: { signedIn?: boolean } = $props();

	const HIDE_KEY = 'rv-cookchip-hidden';
	/** A rung timer's chip pulses this long, then keeps its red, still. */
	const PULSE_MS = 30_000;

	let items = $state<CookItem[]>([]);
	let now = $state(Date.now());
	/** A step-only chip she put away: `slug@at`, shown again once that session changes. */
	let hidden = $state<string | null>(null);
	let list = $state<HTMLDetailsElement>();
	const ringer = createRinger(ring);

	function read() {
		now = Date.now();
		const cooks = readCooks(now);
		items = cookItems(cooks, now);
		ringer.check(cooks, now);
	}
	function readHidden() {
		try {
			hidden = localStorage.getItem(HIDE_KEY);
		} catch {
			// not remembered
		}
	}

	// Leaving kitchen mode, the header (and this chip) is made again: read at
	// once, so the chip is there with the header. Not while the page hydrates
	// (the server's page has none): then in onMount.
	if (typeof document !== 'undefined' && 'ready' in document.documentElement.dataset) {
		readHidden();
		ringer.prime(readCooks());
		read();
	}

	onMount(() => {
		readHidden();
		// Timers seen as already rung or checked when the page opens are not sounded again.
		ringer.prime(readCooks());
		read();
		const h = setInterval(read, 1000);
		const onStorage = (e: StorageEvent) => (!e.key || e.key.startsWith('rv-kitchen:')) && read();
		const onShow = () => document.visibilityState === 'visible' && read();
		// Signing out (« Plus » › Se déconnecter): this device's cooks go with the account.
		const onSubmit = (e: SubmitEvent) => {
			const form = e.target as HTMLFormElement | null;
			if (!form?.action?.includes('logout')) return;
			try {
				for (let i = localStorage.length - 1; i >= 0; i--) {
					const k = localStorage.key(i);
					if (k?.startsWith('rv-kitchen:') || k === HIDE_KEY) localStorage.removeItem(k);
				}
			} catch {
				// no storage: nothing kept
			}
			items = [];
		};
		const onDoc = (e: Event) => list?.open && !list.contains(e.target as Node) && (list.open = false);
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && list?.open) {
				list.open = false;
				list.querySelector('summary')?.focus();
			}
		};
		window.addEventListener('storage', onStorage);
		document.addEventListener('visibilitychange', onShow);
		document.addEventListener('submit', onSubmit, true);
		document.addEventListener('click', onDoc);
		document.addEventListener('keydown', onKey);
		return () => {
			clearInterval(h);
			window.removeEventListener('storage', onStorage);
			document.removeEventListener('visibilitychange', onShow);
			document.removeEventListener('submit', onSubmit, true);
			document.removeEventListener('click', onDoc);
			document.removeEventListener('keydown', onKey);
		};
	});

	const up = $derived(items[0] ?? null);
	const shown = $derived(signedIn && chipShown(up, page.url.pathname, hidden));
	// The header's place for the chip follows what is shown (app.html set it for the first paint).
	$effect(() => {
		if (shown) document.documentElement.dataset.cook = items.length > 1 ? 'n' : '1';
		else delete document.documentElement.dataset.cook;
	});

	const titleOf = (it: CookItem) => it.cook.title ?? t.kitchen.chipCooking;
	/** What a chip says: its time (« TERMINÉ » rung), « Vérifier », or the step to resume. */
	function face(it: CookItem): { glyph: string; time: string | null; what: string } {
		const glyph = it.state === 'step' ? '↩' : it.state === 'paused' ? '⏸' : '⏱';
		const time = it.timer ? (it.state === 'ring' ? t.kitchen.finished : clock(timeLeft(it.timer, now))) : null;
		const what = it.state === 'check' ? t.kitchen.checkShort : it.state === 'step' && it.cook.step ? t.kitchen.stepShort(it.cook.step) : '';
		return { glyph, time, what };
	}
	/** Its name for a screen reader and the tooltip: the state, the time, the recipe. */
	function named(it: CookItem): string {
		const f = face(it);
		const state = it.state === 'paused' ? t.kitchen.paused : it.state === 'check' ? t.kitchen.checkShort : '';
		return t.kitchen.chipTitle([state, it.state === 'ring' ? t.kitchen.finished : f.time, it.state === 'step' ? f.what : '', titleOf(it)].filter(Boolean).join(' · '));
	}
	const f = $derived(up ? face(up) : null);
	const pulse = $derived(!!up?.timer && up.state === 'ring' && now - up.timer.end < PULSE_MS);
	/** For screen readers, said when it changes (not every second): the state and the recipe. */
	const said = $derived(
		!up || !shown ? '' : [up.state === 'ring' ? t.kitchen.finished : up.state === 'check' ? t.kitchen.checkShort : up.state === 'paused' ? t.kitchen.paused : '', titleOf(up)].filter(Boolean).join(' · ')
	);
	/** The × beside a lone chip: a rung timer (seen: not called out again) or a step to resume. */
	const canPut = $derived(!!up && (up.state === 'ring' || up.state === 'step'));

	/** « × Terminer » in the list: the session goes; the list closes once one cook is left (no list for one). */
	function end(it: CookItem) {
		endCook(it.cook.slug);
		read();
		if (items.length < 2 && list) list.open = false;
	}

	function putAway(it: CookItem) {
		if (it.state === 'ring') {
			markSeen(it.cook.slug, it.cook.timers.filter((x) => x.done || (x.left === undefined && x.end <= now)).map((x) => x.id));
		} else {
			hidden = chipId(it);
			try {
				localStorage.setItem(HIDE_KEY, hidden);
			} catch {
				// hidden for this page only
			}
		}
		read();
	}
</script>

{#if signedIn}
	<div class="cookslot no-print">
		{#if up && shown && f}
			<div class="cookchip" class:ring={up.state === 'ring'} class:pulse class:check={up.state === 'check'} class:single={items.length < 2 && !canPut} data-testid="cook-chip">
				<a href={cookHref(up)} aria-label={named(up)} title={named(up)}>
					<span class="glyph" aria-hidden="true">{f.glyph}</span>
					{#if f.time}<span class="time" role="timer">{f.time}</span>{/if}
					{#if f.what}<span class="what">{f.what}</span>{/if}
					<span class="title" aria-hidden="true">{titleOf(up)}</span>
				</a>
				{#if items.length > 1}
					<!-- Other recipes cooking too: the list of them all. -->
					<details class="others" bind:this={list}>
						<summary aria-label={t.kitchen.chipMoreTitle(items.length - 1)} title={t.kitchen.chipMoreTitle(items.length - 1)}>{t.kitchen.chipMore(items.length - 1)}</summary>
						<ul class="others-panel" aria-label={t.kitchen.chipListLabel}>
							{#each items as it (it.cook.slug)}
								{@const g = face(it)}
								<li class:ring={it.state === 'ring'} class:check={it.state === 'check'}>
									<a href={cookHref(it)} title={named(it)} onclick={() => list && (list.open = false)}>
										<span class="glyph" aria-hidden="true">{g.glyph}</span>
										{#if g.time}<span class="time">{g.time}</span>{/if}
										{#if g.what}<span class="what">{g.what}</span>{/if}
										<span class="title">{titleOf(it)}</span>
									</a>
									<!-- « × Terminer »: that cook is over (its step, ticks and timers go from this device). -->
									<button type="button" class="end" aria-label={t.kitchen.chipEndTitle(titleOf(it))} title={t.kitchen.chipEndTitle(titleOf(it))} onclick={() => end(it)}
										><span aria-hidden="true">×</span> {t.kitchen.chipEnd}</button
									>
								</li>
							{/each}
						</ul>
					</details>
				{:else if canPut}
					<button type="button" class="x" aria-label={up.state === 'ring' ? t.kitchen.chipPutAway(titleOf(up)) : t.kitchen.chipHide} title={up.state === 'ring' ? t.kitchen.chipPutAway(titleOf(up)) : t.kitchen.chipHide} onclick={() => putAway(up)}
						><span aria-hidden="true">×</span></button
					>
				{/if}
			</div>
		{/if}
	</div>
	<span class="visually-hidden" aria-live="polite">{said}</span>
{/if}

<style>
	/* The chip's place: none until a cook is on (app.html sets `data-cook` before the
	   first paint), then a fixed width, whatever the chip says. */
	.cookslot {
		display: none;
		--chip-w: 10rem;
	}
	:global(html[data-cook]) .cookslot {
		display: flex;
		flex: none;
		width: var(--chip-w);
		margin-left: auto;
	}
	/* Beside it, the account's buttons keep their place at the end of the row. */
	:global(html[data-cook]) .cookslot ~ :global(.account) {
		margin-left: 0;
	}
	/* A pill in the header's ink: the timer's own look (kitchen mode's chips), smaller. */
	.cookchip {
		position: relative;
		display: flex;
		align-items: stretch;
		width: 100%;
		min-width: 0;
		border: 1.5px solid var(--ink);
		border-radius: 999px;
		background: var(--card);
		color: var(--ink);
		font-family: var(--sans);
		font-size: var(--step--1, 0.875rem);
		line-height: 1.2;
	}
	.cookchip > a {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 2.75rem;
		padding: 0 0.5rem 0 0.75rem;
		color: inherit;
		text-decoration: none;
		border-radius: 999px 0 0 999px;
		overflow: hidden;
	}
	.cookchip.single > a {
		border-radius: 999px;
	}
	.cookchip a:hover,
	.others summary:hover,
	.x:hover {
		background: var(--hover);
	}
	.cookchip a:focus-visible,
	.x:focus-visible,
	.others summary:focus-visible {
		outline: 3px solid var(--focus);
		outline-offset: 2px;
	}
	.glyph {
		flex: none;
	}
	.time {
		flex: none;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}
	.what {
		flex: none;
		font-weight: 700;
	}
	/* The recipe's name: in the chip's name everywhere, shown on a wide screen. */
	.title {
		display: none;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		font-family: var(--serif);
		font-weight: 600;
	}
	.x,
	.others summary {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.75rem;
		min-height: 2.75rem;
		padding: 0;
		border: 0;
		border-left: 1px solid var(--line);
		border-radius: 0 999px 999px 0;
		background: transparent;
		color: inherit;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}
	.x {
		font-size: 1.3rem;
		line-height: 1;
		font-weight: 400;
	}
	/* « +1 »: the list of every recipe cooking, hanging from the chip. */
	.others {
		flex: none;
		display: flex;
	}
	.others summary {
		list-style: none;
	}
	.others summary::-webkit-details-marker {
		display: none;
	}
	.others[open] summary {
		background: var(--hover);
	}
	.others-panel {
		position: absolute;
		right: 0;
		top: calc(100% + 0.35rem);
		z-index: 40;
		width: max(100%, 17rem);
		max-width: calc(100vw - 2rem);
		margin: 0;
		padding: 0.35rem;
		list-style: none;
		background: var(--card);
		color: var(--ink);
		border: 1px solid var(--edge, var(--line));
		border-radius: var(--radius, 8px);
		box-shadow: 0 8px 24px rgb(28 42 66 / 0.18);
	}
	.others-panel li {
		display: flex;
		align-items: stretch;
		border-radius: 6px;
	}
	.others-panel li + li {
		margin-top: 0.15rem;
	}
	.others-panel a {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-height: 2.75rem;
		padding: 0 0.6rem;
		color: inherit;
		text-decoration: none;
		border-radius: 6px;
	}
	.others-panel .title {
		display: block;
	}
	.others-panel .end {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		min-height: 2.75rem;
		min-width: 2.75rem;
		padding: 0 0.6rem;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
	}
	.others-panel .end span {
		font-size: 1.15rem;
		line-height: 1;
	}
	.others-panel .end:hover {
		background: var(--hover);
	}
	.others-panel .end:focus-visible {
		outline: 3px solid var(--focus);
		outline-offset: -3px;
	}
	.others-panel li.ring {
		background: var(--danger-bg);
		color: var(--danger);
	}
	.others-panel li.check {
		background: var(--highlight);
		color: var(--highlight-ink);
	}
	/* A range at its lower bound: time to look in the oven. */
	.cookchip.check {
		background: var(--highlight);
		color: var(--highlight-ink);
		border-color: var(--highlight-ink);
	}
	/* Rung: the alert's red; a slow pulse for 30 s, then still, until it is seen, put away or stopped. */
	.cookchip.ring {
		background: var(--danger);
		border-color: var(--danger);
		color: #fff;
	}
	.cookchip.ring.pulse {
		animation: pulse 1.1s ease-in-out infinite alternate;
	}
	.cookchip.ring .x,
	.cookchip.ring .others summary {
		border-left-color: rgb(255 255 255 / 0.5);
	}
	.cookchip.ring > a:hover,
	.cookchip.ring .x:hover,
	.cookchip.ring summary:hover,
	.cookchip.check > a:hover {
		background: rgb(0 0 0 / 0.08);
	}
	.cookchip.ring .time {
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	@keyframes pulse {
		to {
			opacity: 0.72;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.cookchip.ring.pulse {
			animation: none;
		}
	}
	/* Up to a wide screen, the wordmark keeps its mark and its name moves out of
	   sight while a cook is on, so the chip fits the row (a tablet's too). */
	@media (max-width: 79.99rem) {
		:global(html[data-cook] .bar:has(> .cookslot) .wordmark > span) {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
			white-space: nowrap;
		}
	}
	/* Phone. */
	@media (max-width: 40rem) {
		/* The list: the width of the screen, under the header. */
		.others-panel {
			position: fixed;
			top: 4.25rem;
			left: 1rem;
			right: 1rem;
			width: auto;
			max-width: none;
		}
	}
	/* A wide screen: the recipe's name beside its time. */
	@media (min-width: 80rem) {
		.cookslot {
			--chip-w: 13.5rem;
		}
		.title {
			display: block;
		}
		.what + .title,
		.time + .title {
			margin-left: 0.1rem;
		}
	}
</style>
