<script lang="ts">
	// Kitchen mode (PLANNING.md, "Kitchen mode"): a phone or tablet against the
	// backsplash, wet hands, a glance from a metre away. Screen kept on, big
	// type, ingredients as a checklist, one step at a time with large tap
	// zones, timers that survive reloads, everything resumable and offline.
	// A phone shows the checklist, then the steps (two tabs at the top); a wide
	// screen (a tablet across, a laptop) shows both side by side from the start,
	// the checklist foldable to a rail. A step's running timer sits under its text;
	// the other steps' timers in a strip at the bottom.
	import { onDestroy, onMount, tick as settle, untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto, replaceState } from '$app/navigation';
	import { t } from '$lib/i18n';
	import { locale, prefs } from '$lib/prefs';
	import IngredientLine from '$lib/components/IngredientLine.svelte';
	import Marked from '$lib/components/Marked.svelte';
	import { parseBody } from '$lib/vault/body';
	import { formatNumber } from '$lib/render/fraction';
	import { formatSeconds } from '$lib/render/duration';
	import { formatAmount, ingredientText } from '$lib/render/ingredient';
	import { renderInline } from '$lib/render/markdown';
	import { amountQuery, canOpenSub, capFactor, MULTIPLIERS, paramFactor, servingsStep, subRecipeScale } from '$lib/render/scale';
	import type { Ingredient, Recipe } from '$lib/vault/types';
	import { matchSteps } from '$lib/render/steps';
	import { createRinger, fingerprint, kitchenKey, readCooks, SESSION_MS, timerState, type Cook, type CookTimer } from '$lib/kitchensession';
	import { ring, unlockAudio } from '$lib/ring';
	import { plainText } from '$lib/render/markers';
	import { formatOven } from '$lib/render/temperature';
	import { findPan, panOptions, type PanSize } from '$lib/render/pans';
	import { stepTakesScaleNote } from '$lib/render/stepnote';
	import { clock, findDurations, timerLength } from '$lib/render/timers';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const recipe = $derived(data.recipe);
	const lang = $derived(recipe.lang);
	const steps = $derived(parseBody(data.body).body.steps);
	const subs = $derived(Object.fromEntries(data.subs.map((s) => [s.slug, s])));
	const oven = $derived(recipe.oven ? formatOven(recipe.oven) : null);
	const itemCount = $derived(recipe.ingredients.reduce((n, g) => n + g.items.length, 0));

	interface Timer {
		id: string;
		label: string;
		step: number;
		/** Epoch ms when it rings: stored, not a countdown, so reloads and sleeping tabs stay right. */
		end: number;
		total: number;
		done?: boolean;
		/** Paused: the ms that were left; `end` is set again on « Reprendre ». */
		left?: number;
		/** What the strip's fill measures against, ms: `total` plus each « +1 min ». */
		span?: number;
		/** A range (« 35 à 40 minutes »): its lower bound, s, and the ms left there, when a soft call says to check. */
		lo?: number;
		check?: number;
		/** That call made. */
		checked?: boolean;
		/** Rung while kitchen mode was on screen: the cook chip on other pages does not call it out again. */
		seen?: boolean;
	}

	interface Saved {
		/** Which recipe content the session belongs to: ticks are by position. */
		v: string;
		/** Last change, epoch ms: an old session is not resumed. */
		at: number;
		step: number;
		/** The step left for the checklist (phone): where « Étapes » takes her back. */
		last?: number;
		ticks: string[];
		/** The scaling factor (plan 05). Older sessions stored `servings` or `multiplier`. */
		factor: number;
		servings?: number;
		multiplier?: number;
		timers: Timer[];
		dark: boolean;
		/** For the cook chip on other pages (lib/kitchensession.ts `readCook`): the number of steps and the title, read without the recipe. */
		n: number;
		title: string;
	}

	// svelte-ignore state_referenced_locally -- one recipe per page instance
	const key = kitchenKey(data.recipe.slug);
	// -1: the ingredient checklist (phone); 0…n-1: steps; n: done.
	let step = $state(-1);
	let last = $state(0);
	let ticks = $state<Set<string>>(new Set());
	let factor = $state(1);
	let timers = $state<Timer[]>([]);
	let dark = $state(false);
	let now = $state(Date.now());
	let open = $state<Record<string, boolean>>({});
	/** Wide screen: checklist and steps side by side, no « Commencer » gate. */
	let wide = $state(false);
	/** Wide screen: the checklist folded to a narrow rail, so the step gets the width. Per device. */
	let railed = $state(false);
	const RAIL_KEY = 'rv-kitchen-rail';
	let restored = false;

	/** The step on screen: on a wide screen there is always one, even before the first tap. */
	const view = $derived(step >= 0 ? step : wide && steps.length ? Math.min(last, steps.length - 1) : -1);

	/**
	 * A session resumed (a reload, a return): one small line under the step
	 * header says where she is and at what amount (« Repris à l’étape 2 ·
	 * 12 portions · Recommencer »), in the flow — nothing over the step. It
	 * fades after a few seconds (its room kept until the next step, so the
	 * step text does not move) and goes at her first move. `step`: 1-based,
	 * null on the checklist before any step; `before`: the session's own
	 * factor when the recipe page's amount replaced it (« 16 portions
	 * (avant : 10) », usability round 4).
	 */
	let resumed = $state<{ step: number | null; before?: number } | null>(null);
	/** Faded: still there (its room kept), not seen and not in the way. */
	let resumedFaded = $state(false);
	const RESUMED_MS = 5_000;
	let resumedHandle: ReturnType<typeof setTimeout> | undefined;

	/** FNV-1a of the ingredient list and steps (lib/kitchensession.ts, shared with the recipe page's « Reprendre »): a replaced recipe file starts a fresh session. */
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
			// Resume only the same recipe content, recently, and not a finished cook —
			// unless a timer is still on (it lives here): then at the last step.
			const fresh = s.v === version && typeof s.at === 'number' && Date.now() - s.at < SESSION_MS && typeof s.step === 'number';
			const live = Array.isArray(s.timers) && s.timers.some((x) => !x.done);
			const resume = fresh && (s.step! < steps.length || (live && steps.length > 0));
			if (resume) {
				step = Math.max(-1, Math.min(s.step!, steps.length - 1));
				if (typeof s.last === 'number' && s.last >= 0 && s.last < steps.length) last = s.last;
				if (s.ticks) ticks = new Set(s.ticks);
				const saved =
					typeof s.factor === 'number' ? s.factor : recipe.servings && typeof s.servings === 'number' ? s.servings / recipe.servings : typeof s.multiplier === 'number' ? s.multiplier : undefined;
				const f = saved === undefined ? undefined : capFactor(saved, data.scaling);
				if (f !== undefined) factor = f;
				// A timer that rang while she was away is seen now (the cook chip elsewhere
				// stops calling it out), and said as such: « Minuteur terminé il y a 12 min »,
				// with « Relancer » / « Effacer », not an alarm she never started.
				if (s.timers) {
					const at = Date.now();
					const rang = (x: Timer) => !!x.done || (x.left === undefined && x.end <= at);
					timers = s.timers.map((x) => (rang(x) ? { ...x, done: true, checked: true, seen: true } : x));
					away = new Set(s.timers.filter(rang).map((x) => x.id));
				}
				// Say where she is and at what amount, with the way out: a resume is otherwise silent.
				if (step >= 0 || last > 0 || ticks.size || timers.length) resumed = { step: step >= 0 ? step + 1 : last > 0 ? last + 1 : null };
				wasOn = true;
			}
		} catch {
			// a broken entry: start fresh
		}
		// The amount chosen on the recipe page wins over the session. It is then
		// dropped from the address, so a reload resumes what was set here.
		const asked = paramFactor(url, recipe, data.scaling);
		if (asked !== undefined) {
			// A resume at another amount (« Reprendre » from a page she rescaled): said, with the session's.
			if (resumed && Math.abs(asked - factor) > 1e-9) resumed = { ...resumed, before: factor };
			factor = asked;
		}
		// The cook chip on another page: back at its timer's step (`?etape=3`, 1-based).
		const at = Number(url.get('etape'));
		if (Number.isInteger(at) && at >= 1 && at <= steps.length) {
			step = at - 1;
			resumed = null;
		}
		if (url.has('portions') || url.has('fois') || url.has('etape')) {
			// On a first load the router starts just after this: once more, a moment later.
			const drop = () => replaceState(page.url.pathname, page.state);
			try {
				drop();
			} catch {
				setTimeout(() => {
					try {
						drop();
					} catch {
						// still not ready: the parameter stays, harmless
					}
				}, 0);
			}
		}
		restored = true;
	}

	/** « Recommencer » with a timer on: one line under the header asks first (it would stop them). */
	let confirming = $state(false);
	const liveTimers = $derived(timers.filter((x) => !x.done).length);
	function askRestart() {
		if (liveTimers) confirming = true;
		else restart();
	}
	/** « Cuisine recommencée »: what « Recommencer » did, said for a moment where the resumed line was. */
	let restarted = $state(false);
	let restartedHandle: ReturnType<typeof setTimeout> | undefined;
	const RESTARTED_MS = 4_000;
	/** Idempotent: a second tap (or a tap on a line already gone) leaves the same fresh cook. */
	function restart() {
		confirming = false;
		stay();
		clearTimeout(resumedHandle);
		resumed = null;
		step = -1;
		last = 0;
		ticks = new Set();
		timers = [];
		away = new Set();
		restarted = true;
		clearTimeout(restartedHandle);
		restartedHandle = setTimeout(() => (restarted = false), RESTARTED_MS);
	}
	/** The resumed line stays while she points at it or has focus in it: it never fades from under a tap. */
	function holdResumed(hold: boolean) {
		clearTimeout(resumedHandle);
		if (!hold && resumed && !resumedFaded) resumedHandle = setTimeout(() => (resumedFaded = true), RESUMED_MS);
	}

	$effect(() => {
		const snapshot: Saved = { v: version, at: Date.now(), step, last, ticks: [...ticks], factor, timers, dark, n: steps.length, title: plainText(recipe.title) };
		if (restored) localStorage.setItem(key, JSON.stringify(snapshot));
	});

	// --- screen stays on ------------------------------------------------------

	/**
	 * Unknown until the browser answers; `paused` when she turned it off herself;
	 * `off` when it cannot be kept on (plain HTTP, a refusal): then no toggle but
	 * a crossed-out sun in the header, the reason behind it.
	 */
	let awake = $state<'pending' | 'on' | 'paused' | 'off'>('pending');
	/** Still asking after a moment (the browser waits for a tap): the header says the screen may sleep, and offers to keep it on. */
	let waited = $state(false);
	const WAIT_MS = 1500;
	/** Why not: no Wake Lock on this address (plain http), or the browser said no. */
	let offWhy = $state<'insecure' | 'refused'>('refused');
	let want = true;
	let lock: WakeLockSentinel | null = null;
	/** A request in flight: taps meanwhile do not ask again. */
	let asking = false;
	/** Refusals so far: the first one is asked again on her first tap before anything is said. */
	let refusals = 0;
	/** Left kitchen mode: a wake lock granted after that is released at once, or the screen stays on elsewhere in the app. */
	let gone = false;
	/** Kept on before (granted on this page, or a resumed cook): when it is not now, the header offers « Réactiver ». */
	let wasOn = $state(false);
	async function keepAwake() {
		if (!want || asking || document.visibilityState !== 'visible' || (lock && !lock.released)) return;
		if (!('wakeLock' in navigator)) {
			offerWhy('insecure');
			return;
		}
		asking = true;
		try {
			const got = await navigator.wakeLock.request('screen');
			if (gone || !want) {
				got.release().catch(() => {});
				return;
			}
			lock = got;
			wasOn = true;
			afterTap(() => (awake = 'on'));
			// The system can drop it (battery saver): the sun is crossed out, her next tap asks again.
			got.addEventListener('release', () => {
				if (lock === got) lock = null;
				if (!gone && want && document.visibilityState === 'visible') offerWhy('refused');
			});
		} catch {
			if (!want || gone) return;
			// Some browsers want a tap first: the first refusal waits for it.
			if (++refusals > 1) afterTap(() => want && !gone && !lock && offerWhy('refused'));
		} finally {
			asking = false;
		}
	}
	/** Any tap while the screen is not kept on asks again (a tap is what some browsers wait for). */
	function retryWake() {
		if (want && awake !== 'on' && offWhy !== 'insecure') keepAwake();
	}
	/**
	 * A tap under way (finger down, its click not yet sent). The browser's answer
	 * to the request that tap made comes back before the click: shown at once, the
	 * note or the crossed-out sun would appear under the finger and take the click
	 * (« + », « Voir la recette »). What it changes on the page waits for the click.
	 */
	let tapping = false;
	let held: (() => void) | null = null;
	let tapEnd: ReturnType<typeof setTimeout> | undefined;
	function afterTap(fn: () => void) {
		if (tapping) held = fn;
		else fn();
	}
	function endTap(delay: number) {
		clearTimeout(tapEnd);
		tapEnd = setTimeout(() => {
			tapping = false;
			const fn = held;
			held = null;
			fn?.();
		}, delay);
	}
	function tapDown() {
		tapping = true;
		clearTimeout(tapEnd);
		retryWake();
	}
	function toggleAwake() {
		if (awake === 'on') {
			want = false;
			awake = 'paused';
			lock?.release().catch(() => {});
			lock = null;
		} else {
			want = true;
			keepAwake();
		}
	}

	/**
	 * The screen cannot be kept on: the header's crossed-out sun says so
	 * (« L’écran peut s’éteindre · Réactiver »), and only it — a second note
	 * near the bottom said the same thing again (usability pass, T3).
	 */
	function offerWhy(why: 'insecure' | 'refused') {
		awake = 'off';
		offWhy = why;
	}

	// --- the step text's size (⋯ menu), per device ----------------------------

	const SIZES = [0.85, 1, 1.15, 1.3, 1.5] as const;
	const SIZE_KEY = 'rv-kitchen-text';
	let size = $state(1);
	function setSize(i: number) {
		size = Math.max(0, Math.min(SIZES.length - 1, i));
		try {
			localStorage.setItem(SIZE_KEY, String(SIZES[size]));
		} catch {
			// not remembered
		}
	}
	const sizePercent = $derived(`${Math.round(SIZES[size] * 100)}\u202f%`);

	// --- the timer tip ----------------------------------------------------------
	// A small caption under a step that has a duration, until she has started a
	// timer once on this device (then never again), and at most on two visits.

	const TIP_KEY = 'rv-kitchen-timer-tip';
	const TIP_VISITS = 2;
	let tipOn = $state(true);
	let tipCounted = false;
	/** A timer was started on this device: the tip never shows again, even after its two visits. */
	let tipRetired = false;
	function tipDone() {
		tipOn = false;
		tipRetired = true;
		try {
			localStorage.setItem(TIP_KEY, 'done');
		} catch {
			// not remembered
		}
	}

	// --- the ⋯ menu ----------------------------------------------------------------
	// <details>, so they open without JavaScript; closed on a click outside or Escape.

	function closePops(except?: Node | null, focus = false) {
		for (const d of document.querySelectorAll<HTMLDetailsElement>('.kitchen details.pop[open]')) {
			if (except && d.contains(except)) continue;
			d.open = false;
			if (focus) d.querySelector('summary')?.focus();
		}
	}

	// --- timers ---------------------------------------------------------------

	// The alarm (lib/ring.ts), shared with the cook chip on other pages.
	/** When the alarm last sounded: a finished timer nobody stopped rings again, for a while. */
	let rangAt = 0;
	const RING_AGAIN_MS = 20_000;
	const RING_FOR_MS = 3 * 60_000;
	function alarm() {
		rangAt = Date.now();
		ring();
	}
	/**
	 * A timer runs `seconds`; a range (« 35 à 40 minutes », `lo` its lower
	 * bound) runs to its upper bound, and a soft call at the lower one says to
	 * check (« 35 min : vérifier la cuisson »).
	 */
	function startTimer(seconds: number, label: string, stepIndex: number, lo?: number) {
		unlockAudio();
		if (!tipRetired) tipDone();
		const range = lo !== undefined && lo > 0 && lo < seconds ? { lo, check: (seconds - lo) * 1000 } : {};
		timers = [...timers, { id: `${Date.now()}-${Math.random()}`, label, step: stepIndex, end: Date.now() + seconds * 1000, total: seconds, ...range }];
	}
	function stopTimer(id: string) {
		timers = timers.filter((x) => x.id !== id);
		if (away.has(id)) away = new Set([...away].filter((x) => x !== id));
	}
	/**
	 * Timers that finished before this visit (a reload, a return): said as
	 * « Minuteur terminé il y a 12 min », with « Relancer » and « Effacer »;
	 * never pulsing nor ringing as if they had just gone off. Not saved: any
	 * timer done when the page opens is one.
	 */
	let away = $state<Set<string>>(new Set());
	/** « Relancer »: the same timer again, its whole length from now. */
	function relaunch(id: string) {
		unlockAudio();
		const at = Date.now();
		timers = timers.map((x) => {
			if (x.id !== id) return x;
			const { span: _span, left: _left, ...rest } = x;
			return { ...rest, done: false, checked: false, seen: false, end: at + x.total * 1000 };
		});
		away = new Set([...away].filter((x) => x !== id));
	}
	/** How long ago a timer finished: « à l’instant », « il y a 12 min », « il y a 1 h 05 ». */
	function agoText(end: number): string {
		const m = Math.max(0, Math.floor((now - end) / 60_000));
		return m < 1 ? t.kitchen.agoNow : m < 60 ? t.kitchen.agoMin(m) : t.kitchen.agoHours(Math.floor(m / 60), m % 60);
	}
	/** A timer's step, from its chip: back to the step it belongs to. */
	function jumpTo(stepIndex: number) {
		stay();
		resumed = null;
		if (stepIndex >= 0 && stepIndex < steps.length) step = stepIndex;
	}
	const remaining = (x: Timer) => x.left ?? x.end - now;
	const spanOf = (x: Timer) => x.span ?? x.total * 1000;
	/** How much of the timer is left, 0…1: the strip's fill. */
	const share = (x: Timer) => (x.done ? 0 : Math.max(0, Math.min(1, remaining(x) / spanOf(x))));
	function pauseTimer(id: string) {
		const at = Date.now();
		timers = timers.map((x) => {
			if (x.id !== id || x.done) return x;
			if (x.left === undefined) return { ...x, left: Math.max(0, x.end - at) };
			const { left, ...rest } = x;
			return { ...rest, end: at + left };
		});
	}
	/** « +1 min »: on a running or paused timer, a minute more; on a finished one, a new minute. */
	function addMinute(id: string) {
		unlockAudio();
		if (away.has(id)) away = new Set([...away].filter((x) => x !== id));
		const at = Date.now();
		timers = timers.map((x) => {
			if (x.id !== id) return x;
			if (x.done) return { ...x, done: false, checked: true, end: at + 60_000, span: 60_000 };
			if (x.left !== undefined) return { ...x, left: x.left + 60_000, span: spanOf(x) + 60_000 };
			return { ...x, end: x.end + 60_000, span: spanOf(x) + 60_000 };
		});
	}

	/**
	 * Other recipes cooking on this device (two dishes at once): their timers
	 * in this strip too, compact (« Tourtière 38:55 ↗ »), a tap opens that
	 * recipe's kitchen mode; one that rings sounds the alarm here.
	 */
	let others = $state<Cook[]>([]);
	const otherRinger = createRinger(ring);
	function readOthers() {
		const cooks = readCooks(now).filter((c) => c.slug !== recipe.slug && c.timers.length);
		otherRinger.check(cooks, now);
		// Reassigned only when something shown changes (the clocks read `now`).
		const sig = (cs: Cook[]) => JSON.stringify(cs.map((c) => [c.slug, c.title, c.timers]));
		if (sig(cooks) !== sig(others)) others = cooks;
	}
	const otherTimers = $derived(others.flatMap((cook) => cook.timers.map((timer) => ({ cook, timer, state: timerState(timer, now) }))));
	const otherLeft = (x: CookTimer) => (x.left !== undefined ? x.left : x.end - now);

	let tickHandle: ReturnType<typeof setInterval> | undefined;
	function tick() {
		now = Date.now();
		readOthers();
		// A rung timer on screen is seen: the cook chip on other pages stops calling it out.
		if (document.visibilityState === 'visible' && timers.some((x) => x.done && !x.seen)) timers = timers.map((x) => (x.done ? { ...x, seen: true } : x));
		// Only a timer that rings changes the list: reassigning it on every tick
		// would rewrite the saved session (localStorage) twice a second.
		const rings = (x: Timer) => !x.done && x.left === undefined && x.end <= now;
		const checks = (x: Timer) => x.check !== undefined && !x.checked && !x.done && x.left === undefined && x.end - now <= x.check;
		if (timers.some(rings)) {
			const seen = document.visibilityState === 'visible';
			timers = timers.map((x) => (rings(x) ? { ...x, done: true, checked: true, seen } : x));
			alarm();
		} else if (timers.some(checks)) {
			// A range at its lower bound: one soft call, its timer says to check.
			timers = timers.map((x) => (checks(x) ? { ...x, checked: true } : x));
			ring(true);
		} else if (now - rangAt >= RING_AGAIN_MS && timers.some((x) => x.done && !away.has(x.id) && now - x.end < RING_FOR_MS)) {
			alarm();
		}
	}
	/** A timer already running for this step and length: its chip says so. */
	const running = (seconds: number, stepIndex: number) => timers.some((x) => !x.done && x.step === stepIndex && x.total === seconds);

	// --- navigation -----------------------------------------------------------

	function go(delta: number) {
		stay();
		resumed = null;
		restarted = false;
		const to = Math.max(wide ? 0 : -1, Math.min(steps.length, view + delta));
		if (to === -1) last = 0;
		step = to;
	}

	/**
	 * « Terminé ✓ » on the last step: « Bon appétit », then back to the recipe
	 * by itself — unless a timer is still on (it lives here), or she stays
	 * (« Recommencer », a tap, an arrow). The finished session is not resumed.
	 */
	let leaving = $state(false);
	let leaveHandle: ReturnType<typeof setTimeout> | undefined;
	const LEAVE_MS = 3000;
	function finish() {
		step = steps.length;
		// « Bon appétit » has its own « Recommencer »: not two.
		resumed = null;
		if (timers.length) return;
		leaving = true;
		leaveHandle = setTimeout(() => {
			if (leaving && !gone) goto(backHref);
		}, LEAVE_MS);
	}
	function stay() {
		leaving = false;
		clearTimeout(leaveHandle);
	}

	/** Wide screen: fold the checklist to a rail or open it, remembered on this device; focus follows. */
	let railButton = $state<HTMLButtonElement>();
	let foldButton = $state<HTMLButtonElement>();
	async function setRail(v: boolean) {
		railed = v;
		try {
			localStorage.setItem(RAIL_KEY, v ? '1' : '0');
		} catch {
			// not remembered
		}
		await settle();
		(v ? railButton : foldButton)?.focus();
	}
	/**
	 * The recipe's photo (often the card itself): a small thumbnail over the
	 * checklist; tapped, it opens full screen, fitted. A tap on it zooms in to
	 * two and a half times that, around the spot tapped (then it pans by
	 * scrolling); a second tap fits it again. Pinch zoom works as anywhere.
	 */
	let photoDialog = $state<HTMLDialogElement>();
	let photoFrame = $state<HTMLElement>();
	let zoomed = $state(false);
	/** The zoomed width, px: the fitted width × 2.5. */
	let zoomWidth = $state(0);
	const ZOOM = 2.5;
	function openPhoto() {
		zoomed = false;
		photoDialog?.showModal();
	}
	async function toggleZoom(e: MouseEvent) {
		if (zoomed) {
			zoomed = false;
			return;
		}
		const img = (e.currentTarget as HTMLElement).querySelector('img');
		if (!img) return;
		const r = img.getBoundingClientRect();
		// From the keyboard (no pointer: detail 0), the middle.
		const fx = e.detail && r.width ? (e.clientX - r.left) / r.width : 0.5;
		const fy = e.detail && r.height ? (e.clientY - r.top) / r.height : 0.5;
		zoomWidth = Math.round(r.width * ZOOM);
		zoomed = true;
		await settle();
		if (!photoFrame) return;
		// Keep the tapped spot under the finger, as near as the edges allow.
		photoFrame.scrollLeft = fx * photoFrame.scrollWidth - photoFrame.clientWidth / 2;
		photoFrame.scrollTop = fy * photoFrame.scrollHeight - photoFrame.clientHeight / 2;
	}

	/** Phone: to the checklist, remembering the step for « Étapes ». */
	function showIngredients() {
		if (step >= 0) last = Math.min(step, Math.max(0, steps.length - 1));
		step = -1;
	}
	/** « Tous les ingrédients » under a partial match: the phone's checklist, or the wide screen's list unfolded. */
	function allIngredients() {
		if (wide) setRail(false);
		else showIngredients();
	}
	function showSteps() {
		resumed = null;
		if (step < 0 && steps.length) step = Math.min(last, steps.length - 1);
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
		if ((e.target as HTMLElement).closest('button, a, input, label, summary, dialog, .resumed')) return;
		if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) return go(dx < 0 ? 1 : -1);
		if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
			const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
			go(e.clientX - rect.left < rect.width / 2 ? -1 : 1);
		}
	}
	function onKey(e: KeyboardEvent) {
		const target = e.target as HTMLElement;
		// The photo open full screen: its own keys (Escape closes it), the steps stay put behind it.
		if (photoDialog?.open || target.closest('dialog')) return;
		if (e.key === 'Escape') return closePops(null, true);
		// Not a browser shortcut (Alt+← is Back), not typing, not Space on a focused button (a timer, the servings).
		if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
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
		if (f === 1) return prefs().system === 'written' ? undefined : { factor: f, lang: stepLang, rules: data.scaling, title: t.scaling.stepSystemTitle };
		return { factor: f, lang: stepLang, rules: data.scaling, title: t.scaling.stepAmountTitle(formatNumber(f, locale())) };
	}

	const length = (seconds: number) => timerLength(seconds, (s) => formatSeconds(s, lang));
	/** A range's two ends, short: « 35–40 min » (whole minutes under an hour), else each in words. */
	function rangeText(lo: number, hi: number, unit = true): string {
		if (lo % 60 === 0 && hi % 60 === 0 && hi < 3600) return `${t.kitchen.timerRange(String(lo / 60), String(hi / 60))}${unit ? ' min' : ''}`;
		return t.kitchen.timerRange(length(lo), length(hi));
	}
	type Piece = { html: string } | { seconds: number; lo?: number; text: string };
	function pieces(text: string): Piece[] {
		const out: Piece[] = [];
		let last = 0;
		// The timers read the original text; the amounts are marked inside the text between them.
		const opts = { resolve: (s: string) => data.titles[s], scale: stepScale(factor, lang) };
		for (const d of findDurations(text)) {
			if (d.start > last) out.push({ html: renderInline(text.slice(last, d.start), opts) });
			out.push(d.maxSeconds ? { seconds: d.maxSeconds, lo: d.seconds, text: d.text } : { seconds: d.seconds, text: d.text });
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
		const mq = matchMedia('(min-width: 64rem)');
		wide = mq.matches;
		try {
			railed = localStorage.getItem(RAIL_KEY) === '1';
			const sized = SIZES.indexOf(Number(localStorage.getItem(SIZE_KEY)) as (typeof SIZES)[number]);
			if (sized >= 0) size = sized;
			const tip = localStorage.getItem(TIP_KEY);
			tipRetired = tip === 'done';
			tipOn = !tipRetired && (Number(tip) || 0) < TIP_VISITS;
		} catch {
			// the defaults: list open, normal size, the tip shown
		}
		const resize = () => (wide = mq.matches);
		mq.addEventListener('change', resize);
		load();
		if (resumed) resumedHandle = setTimeout(() => (resumedFaded = true), RESUMED_MS);
		otherRinger.prime(readCooks().filter((c) => c.slug !== recipe.slug));
		keepAwake();
		const waitHandle = setTimeout(() => (waited = true), WAIT_MS);
		tick();
		tickHandle = setInterval(tick, 500);
		const vis = () => {
			if (document.visibilityState === 'visible') {
				keepAwake();
				tick();
			}
		};
		document.addEventListener('visibilitychange', vis);
		return () => {
			clearTimeout(waitHandle);
			document.removeEventListener('visibilitychange', vis);
			mq.removeEventListener('change', resize);
		};
	});
	onDestroy(() => {
		gone = true;
		clearInterval(tickHandle);
		clearTimeout(leaveHandle);
		clearTimeout(resumedHandle);
		clearTimeout(restartedHandle);
		clearTimeout(tapEnd);
		lock?.release().catch(() => {});
	});

	const current = $derived(view >= 0 && view < steps.length ? steps[view] : null);
	/** What each step uses (« Pour cette étape »), read in order: a later « la viande » is the filling made before. */
	const matches = $derived(matchSteps(steps.map((x) => x.text), recipe.ingredients, data.plural, lang, data.lineNames));
	const stepMatch = $derived((current && matches[view]) || { lines: [], groups: [], sure: true });
	/** A line's position across groups (how the index numbers it), for its name's forms. */
	const firstPos = $derived(recipe.ingredients.reduce<number[]>((acc, g, gi) => [...acc, gi ? acc[gi - 1] + recipe.ingredients[gi - 1].items.length : 0], []));
	const formsOf = (gi: number, ii: number) => data.lineForms[firstPos[gi] + ii];
	/** The chips: a line each, or one for a whole long group the step names (« la garniture »). */
	const chips = $derived.by(() => {
		const out: { key: string; text: string; group?: boolean }[] = [];
		for (const s of stepMatch.lines) {
			if (stepMatch.groups.includes(s.group)) {
				if (!out.some((c) => c.key === `g${s.group}`))
					out.push({ key: `g${s.group}`, text: t.kitchen.wholeGroup(plainText(recipe.ingredients[s.group].group ?? '')), group: true });
				continue;
			}
			const f = formsOf(s.group, s.item);
			out.push({ key: `${s.group}:${s.item}`, text: ingredientText(s.ingredient, { factor, lang, rules: data.scaling, forms: f?.forms, gramsPerUnit: f?.weights?.[s.ingredient.unit ?? 'piece'] }) });
		}
		return out;
	});
	const currentPieces = $derived(current ? pieces(current.text) : []);
	const backHref = $derived(`/r/${recipe.slug}${amountQuery(recipe, factor)}`);
	/** Wide, checklist open: the step's ingredients are marked in it, the rest dimmed; no « Pour cette étape » box. */
	const listBeside = $derived(wide && !railed);
	const nowKeys = $derived(new Set(stepMatch.lines.map((s) => tickKey(s.group, s.item))));
	/** Only a sure match is marked in the list: a partial one, with the rest dimmed, would mislead. */
	const highlight = $derived(listBeside && stepMatch.sure && nowKeys.size > 0);
	/** The step on screen's own timers: large under the step, with their controls — and only there. */
	const stepTimers = $derived(current !== null && (wide || step >= 0) ? timers.filter((x) => x.step === view) : []);
	/** The strip: the timers of the other steps (and other recipes), each its row with pause and stop. Never the step's own: one place each. */
	const dockTimers = $derived(timers.filter((x) => !stepTimers.includes(x)));
	const dock = $derived(dockTimers.length > 0 || otherTimers.length > 0);
	/**
	 * Wide screen: the space over the step gives way to a step too long to fit
	 * (`.stage::before`). A step's own timer appearing or going must not move
	 * the step text: that space is held at its height until the next step.
	 */
	let lead = $state<string | null>(null);
	let leadView = -2;
	let leadTimed = false;
	$effect.pre(() => {
		const v = view;
		const timed = stepTimers.length > 0;
		untrack(() => {
			if (v !== leadView) {
				leadView = v;
				leadTimed = timed;
				lead = null;
			} else if (timed !== leadTimed) {
				leadTimed = timed;
				if (lead === null && stageEl && wide) lead = getComputedStyle(stageEl, '::before').height;
			}
		});
	});
	/**
	 * What the resumed line says of the amount: the servings, or the factor; and
	 * the session's own when the recipe page's replaced it (« 16 portions (avant : 10) »).
	 */
	const resumedAmount = $derived.by(() => {
		const before = resumed?.before;
		if (recipe.servings) {
			const shown = t.kitchen.resumedServings(formatNumber(servingsNow, lang));
			return before === undefined ? shown : t.kitchen.resumedBefore(shown, formatNumber(recipe.servings * before, lang));
		}
		if (before !== undefined) return t.kitchen.resumedBefore(`× ${formatNumber(factor, lang)}`, `× ${formatNumber(before, lang)}`);
		return factor !== 1 ? `× ${formatNumber(factor, lang)}` : null;
	});
	/** The pan a step (or a text yield) names, read once per recipe (plan 05, "The pan"; the recipe page's rule). */
	const pan = $derived(findPan([...steps.map((s) => s.text), ...(typeof recipe.yield === 'string' ? [recipe.yield] : [])]));
	/** At another amount, what to bake it in (same depth, same times), as on the recipe page. */
	const panLine = $derived.by(() => {
		if (factor === 1 || !pan) return '';
		const f = formatNumber(factor, locale());
		if (!pan.size) return t.scaling.panArea(f);
		const opts = panOptions(pan.size, factor);
		if (!opts.length) return t.scaling.panArea(f);
		const word = locale() === lang ? pan.word : locale() === 'en' ? 'pan' : 'moule';
		const dims = (z: PanSize) => t.scaling.panSize(formatNumber(z.w, locale()), formatNumber(z.h, locale()), z.shape === 'round', z.unit === 'cm');
		return t.scaling.pan(f, opts.map((o) => t.scaling.panCount(o.count, word, dims(o.size))), t.scaling.panWritten(word, dims(pan.size)));
	});
	/**
	 * Phone, more than two timers (here and in other recipes): one line
	 * « ⏱ 3 minuteurs · 12:30 » that opens the list, so the strip never takes
	 * more than two rows unasked. Two or fewer: each its chip, two rows at most.
	 */
	const chipCount = $derived(dockTimers.length + otherTimers.length);
	const collapsed = $derived(!wide && chipCount > 2);
	let dockOpen = $state(false);
	$effect(() => {
		if (!collapsed) dockOpen = false;
	});
	/** The collapsed line's time: a rung one first, else the one that rings soonest. */
	const soonest = $derived.by(() => {
		if (dockTimers.some((x) => x.done) || otherTimers.some((o) => o.state === 'ring')) return t.kitchen.finished;
		const left = [...dockTimers.map((x) => remaining(x)), ...otherTimers.map((o) => otherLeft(o.timer))];
		return left.length ? clock(Math.min(...left)) : '';
	});
	/** The « Étapes » tab's count, always out of the total (« 0/4 », never a bare « 4 »). */
	const stepTally = $derived(`${step >= 0 ? Math.min(step + 1, steps.length) : last > 0 ? last + 1 : 0}/${steps.length}`);
	/**
	 * Where the timer strip goes: over the pager in the steps
	 * (so neither the pager nor the step text moves), over « Commencer » on the
	 * phone's checklist, or at the very bottom when there is neither.
	 */
	const bottomAt = $derived((step >= 0 || wide) && steps.length ? 'steps' : !wide && step === -1 ? 'go' : 'shell');
	const onStep = $derived(current !== null && (wide || step >= 0));
	/** At another amount, « × 2 · temps et four inchangés »: on step 1 and on a step with a time, a temperature or a pan. */
	const showNotice = $derived(factor !== 1 && current !== null && stepTakesScaleNote(current.text, view, lang));
	/** What to bake the new amount in: on the step that names the pan. */
	const panHere = $derived(!!panLine && current !== null && findPan([current.text]) !== undefined);

	// On a new step the instruction itself comes into sight, not the recap and
	// chips over it; and it stays in sight when the timer strip grows under it.
	let stageEl = $state<HTMLElement>();
	let nowEl = $state<HTMLElement>();
	function showInstruction(top: boolean) {
		if (!stageEl || !nowEl) return;
		if (top) stageEl.scrollTop = 0;
		const s = stageEl.getBoundingClientRect();
		const n = nowEl.getBoundingClientRect();
		const gap = 12;
		if (n.bottom <= s.bottom - gap) return;
		// As little as needed for all of it, never past its first line.
		const by = Math.min(n.top - s.top - gap, n.bottom - s.bottom + gap);
		if (by > 0) stageEl.scrollTop += by;
	}
	$effect(() => {
		void view;
		if (!stageEl || !nowEl) return;
		settle().then(() => showInstruction(true));
	});
	/**
	 * A step's own timer just started: its readout and « Arrêter » come into
	 * sight. The timer strip appears under the pane in the same moment and
	 * shortens it, so on a phone the new row would sit cut off at the strip's
	 * edge (usability round 5). As little scroll as needed.
	 */
	function showReadout() {
		if (!stageEl) return;
		const rows = stageEl.querySelectorAll<HTMLElement>('.steptimer');
		const last = rows[rows.length - 1];
		if (!last) return;
		const by = last.getBoundingClientRect().bottom - (stageEl.getBoundingClientRect().bottom - 12);
		if (by > 0) stageEl.scrollTop += by;
	}
	let readoutView = -2;
	let readouts = 0;
	$effect(() => {
		const v = view;
		const n = stepTimers.length;
		untrack(() => {
			const grew = v === readoutView && n > readouts;
			readoutView = v;
			readouts = n;
			// Once laid out, and again once the strip under the pane has its height.
			if (grew) settle().then(() => (showReadout(), requestAnimationFrame(() => requestAnimationFrame(showReadout))));
		});
	});
	$effect(() => {
		if (!stageEl || typeof ResizeObserver === 'undefined') return;
		let h = stageEl.clientHeight;
		const ro = new ResizeObserver(() => {
			const now = stageEl?.clientHeight ?? 0;
			if (now < h) showInstruction(false);
			h = now;
		});
		ro.observe(stageEl);
		return () => ro.disconnect();
	});
	const showTip = $derived(tipOn && onStep && currentPieces.some((p) => 'seconds' in p));
	// A visit counts once the tip has been on screen.
	$effect(() => {
		if (!showTip || tipCounted) return;
		tipCounted = true;
		try {
			localStorage.setItem(TIP_KEY, String((Number(localStorage.getItem(TIP_KEY)) || 0) + 1));
		} catch {
			// not counted: shown again next visit
		}
	});

	// The checklist follows the step: its first marked line scrolls into sight.
	let ingList = $state<HTMLElement>();
	$effect(() => {
		void view;
		if (!highlight || !ingList) return;
		const first = ingList.querySelector<HTMLElement>('li.here');
		first?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
	});
</script>

<svelte:head>
	<title>{plainText(recipe.title)} — {t.recipe.cookMode}</title>
	<meta name="theme-color" content={dark ? '#0f1520' : '#fffdf7'} />
</svelte:head>

<!-- A press that sends no click (a swipe, a long press) lets the held answer through a moment later. -->
<svelte:window
	onkeydown={onKey}
	onclick={(e) => (closePops(e.target as Node), endTap(0))}
	onpointerdown={tapDown}
	onpointerup={() => endTap(600)}
	onpointercancel={() => endTap(0)}
/>

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
				<p class="subtitle"><Marked text={sub.recipe.title} />{#if sv.scaled}{' '}<span class="subscale">{t.scaling.subScaled(formatNumber(sv.factor, locale()))}</span>{/if}</p>
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

<!-- Resumed: where she is and at what amount, the way to start over. One small line
     under the step header (or the checklist's head), in the flow: it fades after a
     few seconds, its room kept until the next step, so the step text never moves. -->
{#snippet resumedLine()}
	{#if resumed}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -- pointing at it only holds it on screen -->
		<p
			class="resumed"
			class:faded={resumedFaded}
			role="status"
			onpointerenter={() => holdResumed(true)}
			onpointerdown={() => holdResumed(true)}
			onpointerleave={() => holdResumed(false)}
			onfocusin={() => holdResumed(true)}
			onfocusout={() => holdResumed(false)}
		>
			<span>{t.kitchen.resumedAt(resumed.step, resumedAmount)}</span>
			<span class="sep" aria-hidden="true">·</span>
			<button type="button" class="resumed-restart" onclick={askRestart}>{t.kitchen.restart}</button>
		</p>
	{:else if restarted}
		<p class="restarted" role="status">{t.kitchen.restarted}</p>
	{/if}
{/snippet}

{#snippet stopIcon()}
	<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" /></svg>
{/snippet}
{#snippet pauseIcon(paused: boolean)}
	<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
		{#if paused}<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />{:else}<path d="M7.5 5h3v14h-3zM13.5 5h3v14h-3z" fill="currentColor" />{/if}
	</svg>
{/snippet}

<!-- Near the bottom, over the pager (or « Commencer »): the timers of the other
     steps (a step's own timer is under its text, never twice) and of other
     recipes. One row each: « Étape 1 · 59:45 » in large digits — a tap goes back
     to that step — with pause and stop beside it, 44 px targets. A finished one
     turns red, with « +1 min » and stop, and stays until stopped. -->
{#snippet bottom()}
	{#if dock}
		<div class="dock">
			<!-- A phone with more than two timers: one line that opens them all (two rows at most unasked). -->
			{#if collapsed}
				<button type="button" class="tsum" class:done={soonest === t.kitchen.finished} aria-expanded={dockOpen} aria-controls="k-timers" onclick={() => (dockOpen = !dockOpen)}>
					<span class="glyph" aria-hidden="true">⏱</span>
					<span class="tsum-n">{t.kitchen.timersCount(chipCount)}</span>
					<span class="clock">{soonest}</span>
					<span class="tback" aria-hidden="true">{dockOpen ? '▾' : '▴'}</span>
				</button>
			{/if}
			{#if !collapsed || dockOpen}
				<ul class="timers" id="k-timers" aria-label={t.kitchen.timers}>
					{#each dockTimers as tm (tm.id)}
						{@const paused = tm.left !== undefined}
						{@const checking = !!tm.lo && !!tm.checked && !tm.done}
						{@const gone = away.has(tm.id)}
						{@const time = gone ? t.kitchen.finishedAgoShort(agoText(tm.end)) : tm.done ? t.kitchen.finished : clock(remaining(tm))}
						{@const stepName = t.kitchen.stepShort(tm.step + 1)}
						{@const state = paused ? t.kitchen.paused : checking ? t.kitchen.checkShort : ''}
						<li class="tm" class:done={tm.done} class:away={gone} class:paused class:check={checking}>
							<!-- What is left: a thin line across the top that drains. -->
							<span class="drain" aria-hidden="true" style:transform="scaleX({share(tm)})"></span>
							<button type="button" class="tjump" aria-label={`${t.kitchen.timerGoTo(tm.step + 1)} — ${time}`} title={t.kitchen.timerGoTo(tm.step + 1)} onclick={() => jumpTo(tm.step)}>
								<span class="tlabel">{stepName}{#if state}{` · ${state}`}{/if}</span>
								<span class="sep" aria-hidden="true">·</span>
								<span class="clock" role="timer">{time}</span>
							</button>
							{#if gone}
								<button type="button" class="tbtn stop" aria-label={`${t.kitchen.clearTimer} · ${stepName}`} title={t.kitchen.clearTimer} onclick={() => stopTimer(tm.id)}>{@render stopIcon()}</button>
							{:else}
								{#if tm.done}
									<button type="button" class="tbtn plus" aria-label={`${t.kitchen.addMinute} · ${stepName}`} title={t.kitchen.addMinuteTitle} onclick={() => addMinute(tm.id)}>{t.kitchen.addMinute}</button>
								{:else}
									<button type="button" class="tbtn" aria-label={`${paused ? t.kitchen.play : t.kitchen.pause} · ${stepName}`} title={paused ? t.kitchen.play : t.kitchen.pause} onclick={() => pauseTimer(tm.id)}
										>{@render pauseIcon(paused)}</button
									>
								{/if}
								<button type="button" class="tbtn stop" aria-label={`${t.kitchen.stop} · ${stepName}`} title={t.kitchen.stop} onclick={() => stopTimer(tm.id)}>{@render stopIcon()}</button>
							{/if}
						</li>
					{/each}
					<!-- Another recipe cooking: its timer, compact; a tap opens its kitchen mode (a fresh page: one recipe per page). -->
					{#each otherTimers as o (o.timer.id)}
						{@const name = o.cook.title ?? t.kitchen.chipCooking}
						{@const time = o.state === 'ring' ? t.kitchen.finished : clock(otherLeft(o.timer))}
						<li class="tm other" class:done={o.state === 'ring'} class:paused={o.state === 'paused'} class:check={o.state === 'check'}>
							<a
								class="tother"
								href={`/r/${o.cook.slug}/cuisine?etape=${o.timer.step + 1}`}
								data-sveltekit-reload
								aria-label={`${t.kitchen.otherTimer(name, o.timer.step + 1)} — ${time}`}
								title={t.kitchen.otherTimer(name, o.timer.step + 1)}
								><span class="oname">{name}</span><span class="clock">{time}</span><span class="tback" aria-hidden="true">↗</span></a
							>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
{/snippet}

<div class="kitchen" class:dark style:--text={SIZES[size]}>
	<div class="bar">
		<header class="top">
			<!-- Back to the recipe at the amount cooked here (plan 05, Q1 A: the amount lives in the address). -->
			<a class="quit" href={backHref} title={t.kitchen.back}><span aria-hidden="true">←</span><span class="label">{t.kitchen.back}</span></a>
			<!-- The title: here on a wide screen; on a phone it heads the checklist and the step instead. -->
			<p class="name"><Marked text={recipe.title} /></p>
			<!-- The screen, always said (« ☀ Écran allumé », or « L’écran peut s’éteindre — Garder
			     allumé »): a toggle while it can be kept on; when it cannot, a crossed-out sun whose
			     tap asks again (any tap does) and opens the reason. The phone shows the short words.
			     Before the amount, so a change of state (a refusal can land between a tap's touch
			     and its click) grows into the free space: the amount and ⋯ never move. -->
			{#snippet sun(crossed: boolean)}
				<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
					<circle cx="12" cy="12" r="4" fill={crossed ? 'none' : 'currentColor'} stroke="currentColor" stroke-width="1.8" />
					<path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
					{#if crossed}
						<path d="M3.5 3.5l17 17" stroke="var(--bg)" stroke-width="4.5" stroke-linecap="round" />
						<path d="M3.5 3.5l17 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
					{/if}
				</svg>
			{/snippet}
			{#if awake === 'on' || awake === 'paused' || (awake === 'pending' && waited)}
				<button
					class="wake"
					type="button"
					aria-label={t.kitchen.wakeKeep}
					aria-pressed={awake === 'on'}
					title={awake === 'on' ? t.kitchen.wakeOnTitle : t.kitchen.wakePausedTitle}
					onclick={toggleAwake}
				>
					{@render sun(awake !== 'on')}
					{#if awake === 'on'}
						<span class="wake-text"><span class="wake-long">{t.kitchen.wakeOnLong}</span><span class="wake-short">{t.kitchen.wakeOn}</span></span>
					{:else}
						<span class="wake-text"
							><span class="wake-state">{`${t.kitchen.wakeMaySleep} · `}</span><span class="wake-act">{awake === 'paused' || !wasOn ? t.kitchen.wakeKeepShort : t.kitchen.wakeReactivate}</span></span
						>
					{/if}
				</button>
			{:else if awake === 'off'}
				<!-- Cannot be kept on: named for what a tap does (it asks again, like any tap),
				     with a tooltip on hover or focus; the reason behind it. -->
				{@const wakeLabel = offWhy === 'insecure' ? t.kitchen.wakeOffInsecure : t.kitchen.wakeOffRetry}
				<details class="pop wake-off">
					<summary aria-label={wakeLabel} data-tip={wakeLabel}>
						{@render sun(true)}
						<span class="wake-text" aria-hidden="true"
							>{#if offWhy === 'insecure'}{t.kitchen.wakeMaySleep}{:else}<span class="wake-state">{`${t.kitchen.wakeMaySleep} · `}</span><span class="wake-act">{t.kitchen.wakeReactivate}</span>{/if}</span
						>
					</summary>
					<div class="panel why-panel">
						<p class="why-title">{t.kitchen.wakeOff}</p>
						<p class="why">{offWhy === 'insecure' ? t.kitchen.wakeOffWhy : t.kitchen.wakeRefusedWhy}</p>
						{#if offWhy === 'refused'}<button type="button" onclick={() => (keepAwake(), closePops())}>{t.kitchen.wakeRetry}</button>{/if}
					</div>
				</details>
			{:else}
				<!-- Asking (a granting browser answers at once): the place is kept, so nothing moves under the finger. -->
				<span class="wake-slot" aria-hidden="true"></span>
			{/if}
			{#if recipe.servings}
				<div class="scaler scale-ctl">
					<button type="button" aria-label={t.recipe.decrease} disabled={!servingsStep(servingsNow, recipe.servings, -1, data.scaling)} onclick={() => stepServings(-1)}>−</button>
					<output aria-live="polite">{formatNumber(servingsNow, lang)} <span class="unit">{t.recipe.scale.toLowerCase()}</span></output>
					<button type="button" aria-label={t.recipe.increase} disabled={!servingsStep(servingsNow, recipe.servings, 1, data.scaling)} onclick={() => stepServings(1)}>+</button>
				</div>
			{:else}
				<select class="scale-ctl" aria-label={t.recipe.scaleFactor} bind:value={factor} >
					{#each multipliers as m (m)}<option value={m}>× {formatNumber(m, lang)}</option>{/each}
				</select>
			{/if}
			<details class="pop more">
				<summary aria-label={t.kitchen.more} title={t.kitchen.more}>⋯</summary>
				<div class="panel menu">
					<!-- Stays open while she taps, so the step text grows or shrinks behind it. -->
					<div class="sizer" role="group" aria-label={t.kitchen.textSize}>
						<span class="sizer-label" aria-hidden="true">{t.kitchen.textSize}</span>
						<button type="button" aria-label={t.kitchen.smaller} title={t.kitchen.smaller} disabled={size === 0} onclick={() => setSize(size - 1)}>A−</button>
						<output aria-live="polite">{sizePercent}</output>
						<button type="button" aria-label={t.kitchen.larger} title={t.kitchen.larger} disabled={size === SIZES.length - 1} onclick={() => setSize(size + 1)}
							><span class="big">A+</span></button
						>
					</div>
					<button type="button" aria-pressed={dark} onclick={() => ((dark = !dark), closePops())}>{t.kitchen.dark}</button>
					<button type="button" onclick={() => (askRestart(), closePops())}>{t.kitchen.restart}</button>
				</div>
			</details>
		</header>

		{#if confirming}
			<!-- In the flow under the header, whatever the view: the timers would stop. -->
			<p class="confirm" role="alert">
				<span>{t.kitchen.restartAsk(liveTimers)}</span>
				<button type="button" class="confirm-yes" onclick={restart}>{t.kitchen.restartYes}</button>
				<button type="button" onclick={() => (confirming = false)}>{t.kitchen.restartNo}</button>
			</p>
		{/if}

		<!-- Phone: which half she is on, and the way to the other one. -->
		<div class="tabs">
			<div role="tablist" aria-label={t.kitchen.view}>
				<button type="button" role="tab" id="k-tab-ing" aria-controls="k-ing" aria-selected={step === -1} onclick={showIngredients}>
					{t.kitchen.ingredients} <span class="tally">{ticks.size}/{itemCount}</span>
				</button>
				<button type="button" role="tab" id="k-tab-steps" aria-controls="k-steps" aria-selected={step >= 0} disabled={!steps.length} onclick={showSteps}>
					{t.kitchen.steps} <span class="tally">{stepTally}</span>
				</button>
			</div>
		</div>

	</div>

	<div class="panes">
		{#if wide && railed}
			<button class="rail" type="button" aria-expanded="false" bind:this={railButton} onclick={() => setRail(false)}>
				<span class="rail-arrow" aria-hidden="true">»</span>
				<span class="rail-text">{t.kitchen.showList(itemCount)}</span>
				<span class="tally">{ticks.size}/{itemCount}</span>
			</button>
		{:else if step === -1 || wide}
			<section class="ingredients" id="k-ing" aria-labelledby="k-ing-h" bind:this={ingList}>
				<!-- Phone: the recipe's name heads the list (the tab above already says « Ingrédients »,
				     so the heading is for screen readers only); a wide screen: the heading. The photo,
				     often the card itself, as a small thumbnail beside: tapped, it opens full screen. -->
				<div class="ing-head">
					<p class="dish"><Marked text={recipe.title} /></p>
					<h1 id="k-ing-h">{t.kitchen.ingredients}</h1>
					{#if data.photo?.src}
						<button class="see-photo" type="button" aria-haspopup="dialog" onclick={openPhoto}>
							<!-- The display copy, not the thumbnail: it is the one the service worker keeps
							     for offline kitchen mode, and the full-screen view opens at once. -->
							<img src={data.photo.src} alt="" decoding="async" />
							<span>{t.kitchen.seePhoto}</span>
						</button>
					{/if}
					{#if wide}
						<button class="fold" type="button" aria-expanded="true" aria-controls="k-ing" aria-label={t.kitchen.hideList} title={t.kitchen.hideList} bind:this={foldButton} onclick={() => setRail(true)}
							><span aria-hidden="true">«</span></button
						>
					{/if}
				</div>
				<!-- The phone's checklist: a resume that lands here says so under its head. -->
				{#if !onStep}{@render resumedLine()}{/if}
				{#if oven}<p class="oven">{t.recipe.oven} : <strong>{oven.written}</strong> · {oven.converted}</p>{/if}
				{#each recipe.ingredients as g, gi (gi)}
					{#if g.group || g.optional}<h2>{#if g.group}<Marked text={g.group} />{/if}{#if g.optional} <span class="opt">({t.recipe.optionalGroup})</span>{/if}</h2>{/if}
					<ul>
						{#each g.items as item, ii (ii)}
							{@const k = tickKey(gi, ii)}
							<li class:ticked={ticks.has(k)} class:here={highlight && nowKeys.has(k)} class:dim={highlight && !nowKeys.has(k)}>
								<label>
									<input type="checkbox" checked={ticks.has(k)} onchange={() => toggleTick(k)} />
									<span><IngredientLine {item} {factor} {lang} titles={{}} rules={data.scaling} link={formsOf(gi, ii)} /></span>
								</label>
								{@render subRecipe(item, factor, [recipe.slug], k)}
							</li>
						{/each}
					</ul>
				{/each}
				{#if !steps.length}<p class="nosteps">{t.kitchen.noSteps}</p>{/if}
				<div class="go">
					{#if bottomAt === 'go'}{@render bottom()}{/if}
					<button class="start" type="button" onclick={showSteps} disabled={!steps.length}>{last > 0 ? t.kitchen.resume(last + 1) : t.kitchen.start} →</button>
				</div>
			</section>
		{/if}

		{#if (step >= 0 || wide) && steps.length}
			<div class="steps" id="k-steps">
				<!-- Left half goes back, right half goes forward; swipe works too. The
				     pager buttons and arrow keys do the same for keyboards and screen readers. -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<section class="stage" class:held={lead !== null} style:--lead={lead} aria-live="polite" bind:this={stageEl} onpointerdown={onPointerDown} onpointerup={onPointerUp}>
					{#if current}
						<p class="dish"><Marked text={recipe.title} /></p>
						<div class="count-row">
							<p class="count">
								{t.kitchen.step(view + 1, steps.length)}{#if current.subheading}{` · ${current.subheading}`}{/if}
							</p>
						</div>
						<div class="progress" aria-hidden="true"><span style:width="{((view + 1) / steps.length) * 100}%"></span></div>
						{@render resumedLine()}
						<!-- The pan named in a step: what to bake the new amount in (src/lib/render/pans.ts, as on the recipe page). -->
						{#if showNotice}<p class="scale-notice" role="note">{t.scaling.stepNotice(formatNumber(factor, locale()))}{#if panHere}<span class="pan-line">{panLine}</span>{/if}</p>{/if}
						{#if view > 0}<p class="ghost prev"><span class="ctx">{t.kitchen.before}</span> {plainText(steps[view - 1].text, (s) => data.titles[s])}</p>{/if}
						<!-- What the step uses, as chips over it: no tab to flip to. On a wide
						     screen with the list beside, the list marks them instead. A list
						     that may be partial says so (« Mentionnés ») and offers the whole one. -->
						{#if !listBeside && (chips.length || !stepMatch.sure)}
							<div class="for-step">
								{#if chips.length}
									<p class="for-label">{stepMatch.sure ? t.kitchen.forStep : t.kitchen.forStepMaybe}</p>
									<ul class="step-ings">
										{#each chips as c (c.key)}
											<li class:group={c.group}>{c.text}</li>
										{/each}
									</ul>
								{/if}
								{#if !stepMatch.sure}
									<button type="button" class="all-ings" onclick={allIngredients}>{t.kitchen.allIngredients} →</button>
								{/if}
							</div>
						{/if}
						<p class="now" bind:this={nowEl}>
							{#each currentPieces as p, i (i)}
								<!-- A duration is a button: ▶ to start (a ring around it while the tip shows), ⏱ while its timer runs. -->
								{#if 'html' in p}{@html p.html}{:else}{@const on = running(p.seconds, view)}<button
										class="timer"
										class:running={on}
										class:hint={showTip && !on}
										type="button"
										title={t.kitchen.startTimer(p.lo ? `${rangeText(p.lo, p.seconds)} · ${t.kitchen.timerCheck(length(p.lo))}` : length(p.seconds))}
										onclick={() => startTimer(p.seconds, `${t.kitchen.stepShort(view + 1)} · ${p.lo ? rangeText(p.lo, p.seconds) : length(p.seconds)}`, view, p.lo)}
										>{#if on}<span class="glyph" aria-hidden="true">⏱</span>{:else}<svg class="glyph play" viewBox="0 0 24 24" aria-hidden="true" focusable="false"
												><circle cx="12" cy="12" r="11" fill="currentColor" /><path d="M9.5 7.2v9.6l7.6-4.8z" fill="var(--chip)" /></svg
											>{/if}{p.text}</button
									>{/if}
							{/each}
						</p>
						<!-- This step's own timer, large, with its controls — only here, not in the strip too: read from across the kitchen. -->
						{#each stepTimers as tm (tm.id)}
							{#if away.has(tm.id)}
								<!-- Finished before this visit: said as such, with the way to run it again or clear it. -->
								<div class="steptimer away" role="group" aria-label={t.kitchen.stepTimer(tm.label)}>
									<p class="awaytext">{t.kitchen.finishedAgo(agoText(tm.end))}</p>
									<button type="button" class="bigstop relaunch" onclick={() => relaunch(tm.id)}>{t.kitchen.relaunch}</button>
									<button type="button" class="bigstop" onclick={() => stopTimer(tm.id)}>
										<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" /></svg>
										<span>{t.kitchen.clearTimer}</span>
									</button>
								</div>
							{:else}
								{@const paused = tm.left !== undefined}
								{@const checking = !!tm.lo && !!tm.checked && !tm.done}
								{@const state = paused ? t.kitchen.paused : tm.lo && !tm.done && !checking ? rangeText(tm.lo, tm.total) : ''}
								<div class="steptimer" class:done={tm.done} class:paused class:check={checking} role="group" aria-label={t.kitchen.stepTimer(tm.label)}>
									<p class="bigclock">
										<span class="glyph" aria-hidden="true">{paused ? '⏸' : '⏱'}</span><span role="timer">{tm.done ? t.kitchen.finished : clock(remaining(tm))}</span>{#if state}<span class="tlabel">{state}</span>{/if}
									</p>
									{#if checking}<p class="tcheck">{t.kitchen.timerCheck(length(tm.lo!))}</p>{/if}
									<div class="bigbtns">
										{#if !tm.done}
											<button type="button" class="bigbtn bigpause" onclick={() => pauseTimer(tm.id)}>{@render pauseIcon(paused)}<span>{paused ? t.kitchen.play : t.kitchen.pause}</span></button>
										{/if}
										<button type="button" class="bigbtn" title={t.kitchen.addMinuteTitle} onclick={() => addMinute(tm.id)}>{t.kitchen.addMinute}</button>
										<button type="button" class="bigstop" onclick={() => stopTimer(tm.id)}>{@render stopIcon()}<span>{t.kitchen.stop}</span></button>
									</div>
								</div>
							{/if}
						{/each}
						{#if showTip}<p class="tip"><span aria-hidden="true">↑</span> {t.kitchen.timerTip}</p>{/if}
						{#if view < steps.length - 1}<p class="ghost next"><span class="ctx">{t.kitchen.after}</span> {plainText(steps[view + 1].text, (s) => data.titles[s])}</p>{/if}
					{:else}
						<div class="finish">
							<p class="now done">{t.kitchen.done}</p>
							{#if leaving}<p class="leaving" role="status">{t.kitchen.leaving}</p>{/if}
							<a class="start back" href={backHref}>{t.kitchen.backToRecipe}</a>
							<button class="restart" type="button" onclick={askRestart}>{t.kitchen.restart}</button>
						</div>
					{/if}
				</section>
				{#if bottomAt === 'steps'}{@render bottom()}{/if}
				<nav class="pager">
					<!-- Step 1: nothing before it on a wide screen, so « Étape suivante » takes the row. -->
					{#if !wide && view <= 0}
						<button type="button" onclick={() => go(-1)}>← {t.kitchen.list}</button>
					{:else if view > 0}
						<!-- Phone: the arrow over a short word; a wide screen: the whole label on one line. -->
						<button type="button" class="prev" aria-label={`← ${t.kitchen.prev}`} onclick={() => go(-1)}
							><span class="arrow" aria-hidden="true">←</span><span class="label" aria-hidden="true">{t.kitchen.prev}</span><span class="short" aria-hidden="true">{t.kitchen.prevShort}</span></button
						>
					{/if}
					{#if view < steps.length - 1}
						<button type="button" class="primary" onclick={() => go(1)}>{t.kitchen.next} →</button>
					{:else if view === steps.length - 1}
						<button type="button" class="primary" onclick={finish}>{t.kitchen.finishCook}</button>
					{/if}
				</nav>
			</div>
		{/if}
	</div>

	{#if bottomAt === 'shell'}<div class="shell-bottom">{@render bottom()}</div>{/if}

	{#if data.photo?.src}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -- a click on the backdrop closes; Escape and « Fermer » do the same from the keyboard -->
		<dialog class="photo-view" bind:this={photoDialog} aria-label={t.recipe.photo} onclick={(e) => e.target === photoDialog && photoDialog?.close()}>
			<div class="photo-frame" class:zoomed bind:this={photoFrame}>
				<button class="photo-zoom" type="button" aria-pressed={zoomed} aria-label={zoomed ? t.kitchen.photoFit : t.kitchen.photoZoom} onclick={toggleZoom}>
					<img src={data.photo.src} alt={t.recipe.photo} style:width={zoomed ? `${zoomWidth}px` : null} />
				</button>
			</div>
			<form method="dialog" class="photo-bar">
				<span class="photo-hint" aria-hidden="true">{zoomed ? t.kitchen.photoFit : t.kitchen.photoZoom}</span>
				<button type="submit" class="photo-close"><span aria-hidden="true">×</span> {t.app.close}</button>
			</form>
		</dialog>
	{/if}
</div>

<style>
	.kitchen {
		/* The recipe card, made for a glance from a metre away. Global tokens
		   with fallbacks; dark mode below has its own. */
		--bg: var(--card, #fffdf7);
		--fg: var(--ink, #1c2a42);
		--soft: var(--ink-soft, #4b5567);
		--line: var(--rule-blue, #cfdcec);
		--accent: var(--rule-red, #b3302c);
		--btn: #eef2f7;
		--side: var(--paper, #f1eee6);
		--chip: #f4ead8;
		/* The screen-on dot: the global « ok » green (local fallback). */
		--awake: var(--ok, #2f6b4f);
		/* An app shell: header on top, the timer strip at the bottom, the
		   checklist and the steps scroll between them. Nothing moves when a
		   timer starts. */
		height: 100dvh;
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
		--soft: #a7b2c5;
		--line: #2a3548;
		--accent: #ff8a80;
		--btn: #1d2738;
		--side: #141c2a;
		--chip: #2a2a22;
		--awake: #6fcf97;
		/* What the shared components (IngredientLine, Marked) read. */
		--ink: #f3f5f8;
		--ink-soft: #a7b2c5;
		--pencil: #a7b2c5;
		--link: #9cc3ff;
		--rule-red: #ff8a80;
		color-scheme: dark;
	}

	/* --- the top: one header row, and the phone's tabs ---------------------- */
	.bar {
		flex: none;
		position: relative;
		z-index: 5;
		background: var(--bg);
	}
	.top {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-height: 3.5rem;
		padding: 0.25rem 0.4rem;
		border-bottom: 3px solid var(--accent);
	}
	.quit {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		min-width: 2.75rem;
		min-height: 2.75rem;
		padding: 0 0.3rem;
		color: var(--fg);
		font-weight: 600;
		text-decoration: none;
		border-radius: 6px;
	}
	.quit > span[aria-hidden] {
		font-size: 1.4rem;
	}
	/* A narrow phone: the arrow alone (named « Quitter » for screen readers and
	   in its title), so the screen's state keeps its words at 14 px beside the
	   amount and ⋯, with nothing past the screen's edge (usability round 4). */
	@media (max-width: 24.99rem) {
		.quit .label {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
			white-space: nowrap;
		}
	}
	/* Phone: the header is ← Quitter · amount · screen · ⋯; the title heads the content. */
	.name {
		display: none;
		margin: 0;
		flex: 1;
		min-width: 0;
		font-family: var(--serif);
		font-weight: 700;
		font-size: 1.3rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.scale-ctl {
		flex: none;
	}
	/* The right-hand group starts at the screen indicator: it alone moves when it changes. */
	.wake,
	details.wake-off,
	.wake-slot {
		margin-inline-start: auto;
	}
	.scaler {
		display: flex;
		align-items: center;
		gap: 0.15rem;
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
	select,
	summary {
		min-height: 2.75rem;
		min-width: 2.75rem;
		border: 2px solid var(--fg);
		background: var(--btn);
		color: var(--fg);
		border-radius: 6px;
		font: inherit;
		font-size: 1.1rem;
		font-weight: 600;
		cursor: pointer;
		padding: 0 0.6rem;
	}
	button:disabled {
		opacity: 0.35;
		cursor: default;
	}
	/* The amount select: the kitchen's buttons, not the app's cream select
	   (app.css), so it reads in dark mode too; a light chevron there. */
	.kitchen select.scale-ctl {
		background-color: var(--btn);
		border-color: var(--fg);
		color: var(--fg);
	}
	.kitchen.dark select.scale-ctl {
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%23f3f5f8' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
	}
	:focus-visible {
		outline: 3px solid var(--accent);
		outline-offset: 2px;
	}
	.icon {
		width: 1.4rem;
		height: 1.4rem;
		flex: none;
	}

	/* The screen, always said: the sun in green and « Écran allumé » while it is
	   kept on; a crossed-out sun and « Garder allumé » when it may sleep. Quiet,
	   in the header's ink; the short words on a phone (two lines at most). */
	.wake-slot {
		flex: none;
		width: 2.75rem;
		height: 2.75rem;
	}
	.wake,
	details.wake-off summary {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0 0.2rem;
		border-color: transparent;
		background: transparent;
		flex: none;
		color: var(--soft);
		/* 14 px at least: read from a metre away (usability round 4). */
		font-size: 0.875rem;
		font-weight: 600;
		line-height: 1.1;
		text-align: left;
	}
	.wake-text {
		max-width: 4.6rem;
		white-space: normal;
	}
	/* The state in words, beside the action, where there is room. */
	.wake-state {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
	/* « Écran gardé allumé » in full from 64rem; « Écran allumé » on a phone. */
	.wake-long {
		display: none;
	}
	.wake-act {
		color: var(--fg);
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	@media (hover: hover) {
		.wake:hover {
			border-color: var(--line);
		}
	}
	.wake[aria-pressed='true'] {
		color: var(--fg);
	}
	.wake[aria-pressed='true'] .icon {
		color: var(--awake);
	}

	/* The ⋯ menu. */
	.pop {
		position: relative;
		flex: none;
	}
	.pop summary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		list-style: none;
		font-size: 1.4rem;
		line-height: 1;
	}
	.pop summary::-webkit-details-marker {
		display: none;
	}
	.panel {
		background: var(--bg);
		color: var(--fg);
		border: 1px solid var(--line);
		border-top: 3px solid var(--accent);
		border-radius: 6px;
		box-shadow: 0 8px 28px rgb(15 21 32 / 0.22);
		font-size: 1.05rem;
		line-height: 1.45;
		user-select: text;
	}
	.panel {
		position: absolute;
		right: 0;
		top: calc(100% + 0.35rem);
		z-index: 10;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.5rem;
		min-width: 13rem;
	}
	.panel button {
		text-align: left;
		border-width: 0;
		background: transparent;
	}
	.panel button:hover,
	.panel button[aria-pressed='true'] {
		background: var(--btn);
	}
	.panel button[aria-pressed='true']::after {
		content: ' ✓';
	}
	/* The text size: A− 100 % A+, in the menu. */
	.sizer {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0 0 0.4rem 0.6rem;
		border-bottom: 1px solid var(--line);
	}
	.sizer-label {
		flex: 1;
		font-weight: 600;
		white-space: nowrap;
	}
	.sizer output {
		min-width: 4ch;
		text-align: center;
		font-size: 0.95rem;
		font-variant-numeric: tabular-nums;
		color: var(--soft);
	}
	.panel .sizer button {
		border: 2px solid var(--fg);
		background: var(--btn);
		font-family: var(--serif);
		font-size: 1rem;
		padding: 0 0.5rem;
	}
	.sizer .big {
		font-size: 1.3rem;
	}

	/* Cannot keep the screen on: a crossed-out sun, quiet, the reason in its popover. */
	@media (hover: hover) {
		.wake-off summary:hover {
			border-color: var(--line);
		}
	}
	/* Its name, shown on hover or keyboard focus (a tap opens the reason instead). */
	.wake-off:not([open]) summary:hover::after,
	.wake-off:not([open]) summary:focus-visible::after {
		content: attr(data-tip);
		position: absolute;
		right: 0;
		top: calc(100% + 0.35rem);
		z-index: 10;
		padding: 0.35rem 0.6rem;
		border-radius: 6px;
		background: var(--fg);
		color: var(--bg);
		font-size: 0.95rem;
		font-weight: 600;
		line-height: 1.3;
		white-space: nowrap;
		pointer-events: none;
	}
	/* The reason and the tooltip hang from the header's right edge, not from the sun
	   (left of the amount, a panel under it would run off a phone's left edge). */
	details.wake-off,
	details.wake-off summary {
		position: static;
	}
	.why-panel {
		right: 0.4rem;
		width: min(20rem, calc(100vw - 2rem));
		padding: 0.75rem;
		font-size: 1rem;
	}
	.why-panel p {
		margin: 0;
	}
	.why-title {
		font-weight: 700;
	}
	.why {
		color: var(--soft);
		font-size: 0.95rem;
	}
	.why-panel button {
		align-self: flex-start;
		border: 2px solid var(--fg);
		background: var(--btn);
	}

	/* Phone tabs: Ingrédients | Étapes, with how far along each is. */
	.tabs {
		padding: 0.5rem;
		border-bottom: 1px solid var(--line);
	}
	.tabs [role='tablist'] {
		display: flex;
		border: 2px solid var(--fg);
		border-radius: 8px;
		overflow: hidden;
	}
	.tabs [role='tab'] {
		flex: 1;
		border: 0;
		border-radius: 0;
		background: transparent;
		font-size: 1.05rem;
		padding: 0 0.4rem;
		white-space: nowrap;
	}
	.tabs [role='tab'] + [role='tab'] {
		border-left: 2px solid var(--fg);
	}
	.tabs [role='tab'][aria-selected='true'] {
		background: var(--fg);
		color: var(--bg);
	}
	.tally {
		font-weight: 500;
		font-size: 0.9rem;
		opacity: 0.8;
		font-variant-numeric: tabular-nums;
	}
	/* Visually hidden on a phone; shown on a wide screen. */
	.scaler .unit {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	/* --- the checklist ------------------------------------------------------ */
	.panes {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.ingredients {
		--pad: max(1rem, (100vw - 42rem) / 2);
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 1rem var(--pad) 0;
	}
	/* The recipe's name over the checklist and the step (the header has it on a wide screen). */
	.dish {
		margin: 0 0 0.25rem;
		font-family: var(--serif);
		font-weight: 700;
		font-size: 1.15rem;
		line-height: 1.3;
		color: var(--soft);
	}
	.ingredients .dish {
		flex: 1;
		min-width: 0;
		margin: 0;
		padding-bottom: 0.4rem;
		font-size: 1.4rem;
		color: var(--fg);
	}
	.ing-head {
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
		margin: 0 0 0.5rem;
		border-bottom: 2px solid var(--accent);
	}
	/* Phone: the tab above says « Ingrédients »; the heading stays for screen readers. */
	h1 {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		font-family: var(--serif);
		font-size: 2rem;
		margin: 0;
		padding-bottom: 0.3rem;
	}
	/* The photo, small: a thumbnail and its word, a button like the others. */
	.see-photo {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.4rem;
		padding: 0.2rem 0.6rem 0.2rem 0.2rem;
		border-width: 1px;
		border-color: var(--line);
		background: var(--bg);
		font-size: 0.95rem;
	}
	.see-photo:hover {
		border-color: var(--fg);
	}
	.see-photo img {
		display: block;
		width: 2.5rem;
		height: 2.5rem;
		object-fit: cover;
		border-radius: 4px;
		box-shadow: 0 1px 3px rgb(15 21 32 / 0.25);
	}
	.fold {
		margin-bottom: 0.35rem;
		background: transparent;
		border-color: var(--line);
		font-size: 1.3rem;
	}
	.fold:hover {
		border-color: var(--fg);
	}
	/* The photo full screen: fitted to the window; a tap zooms to twice that and it pans. */
	.photo-view {
		width: 100vw;
		height: 100dvh;
		max-width: none;
		max-height: none;
		margin: 0;
		padding: 0;
		border: 0;
		background: #11161f;
		color: #f3f5f8;
		display: none;
		flex-direction: column;
	}
	.photo-view[open] {
		display: flex;
	}
	.photo-view::backdrop {
		background: rgb(17 22 31 / 0.85);
	}
	/* Auto margins centre the picture and, once it is larger, let it scroll both ways. */
	.photo-frame {
		flex: 1;
		min-height: 0;
		overflow: auto;
		display: flex;
		touch-action: pan-x pan-y pinch-zoom;
	}
	.photo-zoom {
		flex: none;
		display: block;
		margin: auto;
		padding: 0;
		border: 0;
		border-radius: 0;
		background: transparent;
		cursor: zoom-in;
	}
	.photo-zoom img {
		display: block;
		max-width: 100vw;
		max-height: calc(100dvh - 4.5rem - env(safe-area-inset-bottom));
		height: auto;
	}
	.zoomed .photo-zoom {
		cursor: zoom-out;
	}
	.zoomed .photo-zoom img {
		max-width: none;
		max-height: none;
	}
	.photo-bar {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem calc(0.5rem + env(safe-area-inset-bottom));
		background: #11161f;
		border-top: 3px solid var(--accent);
	}
	.photo-hint {
		flex: 1;
		font-size: 1rem;
		color: #c3cad6;
	}
	.photo-close {
		min-height: 3rem;
		padding: 0 1.1rem;
		border-color: #f3f5f8;
		background: #f3f5f8;
		color: #11161f;
	}
	.photo-close span {
		font-size: 1.5rem;
		line-height: 1;
		margin-right: 0.15rem;
	}
	/* A group of the checklist (« Garniture »): its name as written, sentence case. */
	h2 {
		font-family: var(--sans);
		font-size: 0.9375rem;
		font-weight: 600;
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
	}
	/* The whole row ticks: at least 48 px tall, its padding inside the tap target, no dead strip between rows. */
	.ingredients label {
		display: flex;
		gap: 0.9rem;
		align-items: flex-start;
		min-height: 3rem;
		padding: 0.85rem 0;
		cursor: pointer;
		font-size: 1.45rem;
		line-height: 1.35;
		-webkit-tap-highlight-color: transparent;
	}
	.ingredients label:active {
		background: var(--side);
	}
	.ingredients label:has(input:focus-visible) {
		outline: 3px solid var(--fg);
		outline-offset: 2px;
	}
	/* The box itself is a thumb's size too (48 px, overlapping the row's padding,
	   so the row keeps its height); what shows is a 28 px square inside it. */
	.ingredients input[type='checkbox'] {
		appearance: none;
		flex: none;
		width: 3rem;
		height: 3rem;
		margin: -0.5rem -0.5rem -0.5rem -0.5rem;
		border: 0;
		border-radius: 6px;
		background: transparent;
		cursor: pointer;
		/* The visible box: an outline drawn 10 px inside the target. */
		outline: 2.5px solid var(--fg);
		outline-offset: -0.625rem;
	}
	.ingredients input[type='checkbox']:checked {
		outline-color: var(--accent);
		background:
			url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M5 12.5l4.5 4.5L19 7.5' fill='none' stroke='white' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
				center / 1.4rem no-repeat,
			linear-gradient(var(--accent), var(--accent)) center / 1.75rem 1.75rem no-repeat;
	}
	.ingredients input[type='checkbox']:focus-visible {
		outline-color: var(--fg);
	}
	li.ticked span {
		text-decoration: line-through;
		opacity: 0.5;
	}
	/* Wide, checklist open: what this step uses stands out (a red bar, bold, on
	   the card's cream), the rest steps well back, so the column does not pull
	   the eye from the step. Only on a sure match (see `highlight`). A pointer
	   or the keyboard on a dimmed line brings it back. */
	.ingredients > ul > li.here {
		margin-left: -0.75rem;
		padding-left: calc(0.75rem - 4px);
		padding-right: 0.5rem;
		border-left: 4px solid var(--accent);
		border-radius: 0 6px 6px 0;
		background: var(--bg);
		font-weight: 700;
	}
	/* Stepped back, still readable from the counter: softer ink, not a fade
	   (a faded line and its box read as disabled). */
	.ingredients > ul > li.dim:not(.ticked) {
		color: var(--soft);
		font-weight: 400;
	}
	.ingredients > ul > li.dim:hover,
	.ingredients > ul > li.dim:focus-within {
		color: inherit;
	}
	.opt {
		font-weight: 400;
		text-transform: none;
		letter-spacing: 0;
	}
	.nosteps {
		color: var(--soft);
	}
	.expand {
		min-height: 2.75rem;
		margin: 0 0 0.5rem 2.9rem;
		font-size: 1rem;
	}
	.sub {
		margin: 0 0 0.75rem 2.9rem;
		padding: 0.5rem 0.9rem;
		border-left: 3px solid var(--line);
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
	/* The big way on, at the bottom of the phone's checklist. */
	.go {
		position: sticky;
		bottom: 0;
		margin: 1.25rem calc(-1 * var(--pad)) 0;
		padding: 0.75rem var(--pad) calc(0.75rem + env(safe-area-inset-bottom));
		background: var(--bg);
		border-top: 1px solid var(--line);
	}
	.start {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		min-height: 4rem;
		font-size: 1.5rem;
		background: var(--fg);
		color: var(--bg);
	}

	/* --- the steps ---------------------------------------------------------- */
	.steps {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.stage {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 1rem max(1.25rem, (100% - 50rem) / 2);
		display: flex;
		flex-direction: column;
		touch-action: pan-y;
	}
	/* The pane scrolls; its lines keep their height (a clipped one would shrink to nothing). */
	.stage > :global(*) {
		flex-shrink: 0;
	}
	.count-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		min-height: 2.75rem;
	}
	/* « Recommencer » with a timer on: one line, the way on and the way back. */
	.confirm {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.6rem;
		margin: 0;
		padding: 0.4rem 0.75rem;
		background: var(--side);
		border-bottom: 1px solid var(--line);
		font-size: 1rem;
		font-weight: 600;
	}
	.confirm span {
		flex: 1 1 auto;
	}
	.confirm button {
		font-size: 1rem;
	}
	.confirm .confirm-yes {
		border-color: var(--accent);
		color: var(--accent);
	}
	.count {
		margin: 0;
		color: var(--accent);
		font-weight: 800;
		font-size: 1.2rem;
		letter-spacing: 0.02em;
	}
	.progress {
		flex: none;
		height: 4px;
		margin: 0.4rem 0 0.75rem;
		background: var(--line);
		border-radius: 2px;
		overflow: hidden;
	}
	.progress span {
		display: block;
		height: 100%;
		background: var(--accent);
	}
	/* « × 2 · temps et four inchangés »: one quiet line. */
	.scale-notice {
		margin: 0 0 0.4rem;
		color: var(--soft);
		font-size: 0.9375rem;
		font-weight: 600;
	}
	.pan-line {
		display: block;
		margin-top: 0.2rem;
		color: var(--fg);
	}
	/* The steps around this one: body ink at reading size (18 px), two lines at most;
	   the size alone sets them back from the step. Their labels in small capitals. */
	.ghost {
		color: var(--fg);
		font-family: var(--serif);
		font-size: 1.125rem;
		line-height: 1.45;
		margin: 0.5rem 0;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	/* « Avant : », « Ensuite : » — sentence case, 15 px semibold: read at a glance, not spelled out. */
	.ctx {
		color: var(--soft);
		font-family: var(--sans);
		font-size: 0.9375rem;
		font-weight: 600;
		margin-right: 0.25em;
	}
	.now {
		font-family: var(--serif);
		/* × the size chosen in the ⋯ menu (--text, per device). */
		font-size: calc(clamp(1.75rem, 1.1rem + 2.6vw, 2.75rem) * var(--text, 1));
		line-height: 1.4;
		margin: 0.75rem 0;
		user-select: text;
	}
	.now :global(.step-scaled),
	.sub :global(.step-scaled) {
		font-family: var(--sans);
		font-weight: 800;
		color: var(--accent);
		white-space: nowrap;
	}
	/* A duration in the step is a button that starts a timer: big, clearly pressable. */
	.timer {
		font-family: var(--sans);
		font-size: 0.85em;
		font-weight: 700;
		min-height: 3rem;
		margin: 0.1em 0.15em;
		padding: 0 0.55em;
		border: 2px solid var(--fg);
		border-radius: 999px;
		background: var(--chip);
		box-shadow: 0 2px 0 var(--fg);
		vertical-align: baseline;
		white-space: nowrap;
	}
	.timer:active {
		transform: translateY(2px);
		box-shadow: none;
	}
	.timer.running {
		background: var(--fg);
		color: var(--bg);
	}
	/* ▶ in a disc: « press to start »; ⏱ while its timer runs. */
	.timer .glyph {
		display: inline-block;
		margin-right: 0.3em;
	}
	.timer .play {
		width: 1em;
		height: 1em;
		vertical-align: -0.12em;
	}
	/* While the tip shows: a ring goes out from it, three times. */
	.timer.hint {
		animation: beckon 1.6s ease-out 0.6s 3;
	}
	@keyframes beckon {
		from {
			box-shadow:
				0 2px 0 var(--fg),
				0 0 0 0 color-mix(in srgb, var(--accent) 55%, transparent);
		}
		to {
			box-shadow:
				0 2px 0 var(--fg),
				0 0 0 0.6rem color-mix(in srgb, var(--accent) 0%, transparent);
		}
	}
	/* The step's ingredients: chips over the step, read in one glance. */
	.for-step {
		margin: 0.5rem 0 0;
		font-size: calc(1.1rem * (1 + (var(--text, 1) - 1) / 2));
	}
	.for-label {
		margin: 0 0 0.3rem;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--soft);
	}
	.step-ings {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	/* A whole group (« Garniture (tout) »): the group's heading face. */
	.step-ings li.group {
		font-style: italic;
	}
	/* Under a list that may be partial: the whole checklist, one tap away. */
	.all-ings {
		margin-top: 0.4rem;
		min-height: 2.75rem;
		border-color: var(--line);
		background: transparent;
		font-size: 1rem;
	}
	.step-ings li {
		padding: 0.2rem 0.65rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--side);
		font-weight: 600;
		line-height: 1.35;
	}
	/* Until her first timer on this device: under the step, where the duration is. */
	.tip {
		margin: -0.25rem 0 0.5rem;
		color: var(--soft);
		font-size: 1rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* « Bon appétit » — and back to the recipe. */
	.finish {
		margin: auto 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		text-align: center;
	}
	.now.done {
		font-size: clamp(2.5rem, 2rem + 3vw, 4rem);
		margin: 0;
		padding-bottom: 0.4rem;
		border-bottom: 3px solid var(--accent);
	}
	.leaving {
		margin: 0;
		color: var(--soft);
		font-size: 1.05rem;
	}
	.finish .back,
	.restart {
		width: min(100%, 24rem);
	}
	.finish .back {
		margin-top: 0.75rem;
		border-radius: 6px;
		font-weight: 600;
		text-decoration: none;
	}
	.restart {
		min-height: 3.25rem;
		background: transparent;
	}
	.pager {
		flex: none;
		display: flex;
		gap: 0.75rem;
		padding: 0.75rem 0.75rem calc(0.75rem + env(safe-area-inset-bottom));
		border-top: 1px solid var(--line);
		background: var(--bg);
	}
	.pager button {
		flex: 1;
		min-height: 4rem;
		font-size: 1.3rem;
		/* Outlined: plainly a button, not a disabled one. */
		background: transparent;
	}
	.pager .primary {
		background: var(--fg);
		color: var(--bg);
		white-space: nowrap;
	}
	/* Phone: « précédente » as an arrow and « Ingrédients » at its width, so
	   « Étape suivante » fits on one line. */
	.pager button:not(.primary) {
		flex: 0 1 auto;
		padding: 0 0.9rem;
	}
	/* Phone: the arrow over a short word, so « Étape suivante » keeps its line. */
	.pager .prev {
		flex: 0 0 auto;
		min-width: 5.5rem;
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.1rem;
		padding: 0 0.6rem;
		line-height: 1;
	}
	.prev .arrow {
		font-size: 1.35rem;
	}
	.prev .short {
		font-size: 0.85rem;
	}
	.prev .label {
		display: none;
	}
	.kitchen :global(mark.mk) {
		font-size: 0.7em;
	}

	/* --- the timer strip ----------------------------------------------------- */
	/* Over the pager in the steps, over « Commencer » on the checklist, in the
	   flow: the step pane ends above it, so the step text scrolls clear of it.
	   One row of chips, about 48 px; a chip's controls open over the row. */
	.dock {
		flex: none;
		padding: 0.2rem 0.5rem;
		background: var(--side);
		border-top: 1px solid var(--line);
	}
	.go .dock {
		margin: 0 calc(-1 * var(--pad)) 0.75rem;
		padding: 0.2rem var(--pad);
	}
	.shell-bottom {
		flex: none;
		padding-bottom: env(safe-area-inset-bottom);
	}
	/* A phone: the chips wrap (two rows at most; more collapse to « ⏱ 3 minuteurs »),
	   never past the screen's edge. A wide screen: one row that scrolls sideways. */
	.timers {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.4rem;
	}
	.tsum {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		min-height: 2.75rem;
		margin: 0.1rem 0;
		background: var(--bg);
		font-size: 1rem;
	}
	.tsum[aria-expanded='true'] {
		margin-bottom: 0.3rem;
	}
	.tsum .clock {
		margin-inline-start: auto;
	}
	.tsum.done {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
	}
	.dark .tsum.done {
		color: #1a0d0c;
	}
	/* A chip: the time and its step; another step's chip has « Étape 1 ↩ » apart, a way back. */
	.tm {
		position: relative;
		flex: 0 1 auto;
		min-width: 0;
		max-width: 100%;
		display: flex;
		align-items: stretch;
		border: 2px solid var(--fg);
		border-radius: 8px;
		background: var(--bg);
		overflow: hidden;
	}
	/* What is left: a thin line across the top, draining to the left. */
	.drain {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		background: var(--fg);
		transform-origin: left;
		transition: transform 0.5s linear;
		pointer-events: none;
	}
	/* 44 px inside a 2 px border: every button of a row is a 44 px target. */
	.tm button {
		min-height: 2.75rem;
		min-width: 0;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: inherit;
		display: inline-flex;
		align-items: center;
		white-space: nowrap;
	}
	/* « Étape 1 · 59:45 »: the step, then the time large; all of it the way back to that step. */
	.tjump {
		flex: 1;
		min-width: 0;
		gap: 0.4rem;
		padding: 0 0.6rem;
		overflow: hidden;
	}
	.tjump .tlabel {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--fg);
		text-decoration: underline;
		text-decoration-color: color-mix(in srgb, currentColor 45%, transparent);
		text-underline-offset: 0.2em;
	}
	.tjump .sep {
		color: var(--soft);
	}
	/* Pause and stop beside it: 44 px squares, the icon plain. */
	.tm .tbtn {
		flex: none;
		justify-content: center;
		min-width: 2.75rem;
		min-height: 2.75rem;
		padding: 0 0.4rem;
		border-left: 1px solid var(--line);
		font-size: 1rem;
		font-weight: 700;
	}
	.tm .tbtn .icon {
		width: 1.35rem;
		height: 1.35rem;
	}
	.tm .tbtn.stop {
		color: var(--soft);
	}
	.tm.done .tbtn,
	.tm.done .tbtn.stop {
		color: inherit;
		border-left-color: currentColor;
	}
	/* Finished before this visit: still, not the alarm's pulse; its time is a sentence. */
	.tm.done.away {
		animation: none;
		background: var(--bg);
		color: var(--accent);
	}
	.dark .tm.done.away {
		color: var(--accent);
	}
	.tm.done.away .clock {
		font-size: 1rem;
		letter-spacing: 0;
	}
	/* The digits: read from across the kitchen (26 px on a phone, 30 px on a wide screen). */
	.clock {
		font-size: 1.625rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.01em;
		line-height: 1;
	}
	.tm.paused .clock {
		color: var(--soft);
	}
	.tlabel {
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--soft);
	}
	.tback {
		text-decoration: none;
		font-size: 1.05rem;
	}
	@media (hover: hover) {
		.tm button:hover {
			background: var(--btn);
		}
	}
	.tm button:focus-visible {
		outline: 3px solid var(--fg);
		outline-offset: -5px;
	}
	/* A range at its lower bound: time to look (« Vérifier »), not yet the alarm. */
	.tm.check {
		background: var(--chip);
		border-color: var(--accent);
	}
	.tm.check .tlabel,
	.tcheck {
		color: var(--accent);
		font-weight: 800;
	}
	/* Done: the card's red, a slow pulse, there until she stops it. */
	.tm.done {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
		animation: pulse 1.1s ease-in-out infinite alternate;
	}
	.dark .tm.done {
		color: #1a0d0c;
	}
	.tm.done .drain {
		display: none;
	}
	.tm.done .tlabel {
		color: inherit;
	}
	.tm.done .clock {
		font-size: 1.35rem;
		letter-spacing: 0;
	}
	.tm.done .tjump .tlabel,
	.tm.done .tjump .sep {
		color: inherit;
	}
	/* Another recipe's timer: its name, its time, ↗ (a tap opens its kitchen mode). Quieter than this recipe's own. */
	.tm.other {
		border-style: dashed;
		border-width: 1.5px;
	}
	.tother {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 2.5rem;
		padding: 0 0.55rem;
		color: inherit;
		text-decoration: none;
		white-space: nowrap;
	}
	.tother .clock {
		font-size: 1.1rem;
	}
	.oname {
		max-width: 7rem;
		overflow: hidden;
		text-overflow: ellipsis;
		font-family: var(--serif);
		font-size: 0.95rem;
		font-weight: 600;
	}
	@media (hover: hover) {
		.tother:hover {
			background: var(--btn);
		}
	}
	.tother:focus-visible {
		outline: 3px solid var(--fg);
		outline-offset: -5px;
	}
	/* The step's own timer under it, in the flow: the time large, then Pause, « +1 min », « Arrêter ». */
	.steptimer {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		margin: 0 0 0.75rem;
	}
	.bigclock {
		display: inline-flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 0;
		font-size: calc(2.75rem * (1 + (var(--text, 1) - 1) / 2));
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.01em;
		line-height: 1;
	}
	.bigclock .glyph {
		font-size: 0.5em;
	}
	.steptimer.paused .bigclock {
		color: var(--soft);
	}
	.steptimer.done .bigclock {
		color: var(--accent);
		font-size: calc(2.25rem * (1 + (var(--text, 1) - 1) / 2));
	}
	/* « En pause », « 35–40 min » beside the digits; « 35 min : vérifier la cuisson » on its own line. */
	.bigclock .tlabel {
		font-size: 1rem;
		letter-spacing: 0;
	}
	.steptimer .tcheck {
		flex-basis: 100%;
		margin: 0;
		font-size: 1.1rem;
	}
	.steptimer.check .bigclock {
		color: var(--accent);
	}
	.bigbtns {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.bigbtn,
	.bigstop {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		min-height: 3rem;
		padding: 0 0.7rem;
		background: transparent;
		font-size: 1.05rem;
	}
	.bigbtn .icon,
	.bigstop .icon {
		width: 1.2rem;
		height: 1.2rem;
	}
	/* Pause: the timer's own face (the duration's chip), the one she reaches for. */
	.bigpause {
		background: var(--chip);
		box-shadow: 0 2px 0 var(--fg);
		font-weight: 800;
	}
	.bigpause:active {
		transform: translateY(2px);
		box-shadow: none;
	}
	/* « Arrêter »: quieter, apart — until it rings. */
	.steptimer:not(.done):not(.away) .bigstop {
		border-color: var(--line);
		color: var(--soft);
	}
	.steptimer.done .bigstop {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
	}
	.dark .steptimer.done .bigstop {
		color: #1a0d0c;
	}
	/* Finished before this visit: a sentence, not the red alarm; « Relancer » first. */
	.awaytext {
		flex-basis: 100%;
		margin: 0;
		font-size: calc(1.35rem * (1 + (var(--text, 1) - 1) / 2));
		font-weight: 700;
		color: var(--accent);
	}
	.steptimer .relaunch {
		background: var(--chip);
		box-shadow: 0 2px 0 var(--fg);
		font-weight: 800;
	}
	@keyframes pulse {
		from {
			box-shadow: inset 0 0 0 0 rgb(255 255 255 / 0);
		}
		to {
			box-shadow: inset 0 0 0 0.35rem rgb(255 255 255 / 0.28);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.tm.done,
		.timer.hint {
			animation: none;
		}
		.drain {
			transition: none;
		}
	}

	/* Resumed (or « Cuisine recommencée »): one small line under the step header, in the flow. */
	.resumed,
	.restarted {
		display: flex;
		align-items: center;
		gap: 0 0.35rem;
		margin: 0 0 0.25rem;
		color: var(--soft);
		font-family: var(--sans);
		font-size: 0.875rem;
		font-weight: 600;
		white-space: nowrap;
		transition:
			opacity 0.6s ease,
			visibility 0s linear 0.6s;
	}
	.restarted {
		min-height: 2.75rem;
	}
	/* Faded after a few seconds: its room kept until the next step, so the step text does not move. */
	.resumed.faded {
		opacity: 0;
		visibility: hidden;
	}
	/* One line: the words give way (…) before « Recommencer » does. */
	.resumed > span:first-child {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.resumed .sep {
		flex: none;
	}
	.resumed-restart {
		flex: none;
		min-height: 2.75rem;
		padding: 0 0.25rem;
		border: 0;
		background: transparent;
		color: var(--fg);
		font-size: inherit;
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 0.2em;
	}
	@media (prefers-reduced-motion: reduce) {
		.resumed,
		.restarted {
			transition: none;
		}
	}

	/* --- a tablet across or a laptop: checklist left, steps right --------- */
	@media (min-width: 64rem) {
		.top {
			gap: 0.75rem;
			padding: 0.25rem 1rem;
		}
		.wake,
		details.wake-off summary {
			font-size: 0.95rem;
			white-space: nowrap;
		}
		.wake-text {
			max-width: none;
		}
		.wake-state {
			position: static;
			width: auto;
			height: auto;
			overflow: visible;
			clip: auto;
		}
		.name {
			display: block;
		}
		.dish {
			display: none;
		}
		.scaler .unit {
			position: static;
			width: auto;
			height: auto;
			overflow: visible;
			clip: auto;
		}
		.tabs,
		.go {
			display: none;
		}
		.panes {
			flex-direction: row;
		}
		.ingredients {
			flex: 0 0 clamp(19rem, 30%, 28rem);
			padding: 1.25rem 1.5rem 2rem;
			background: var(--side);
			border-right: 1px solid var(--line);
		}
		.ingredients label {
			font-size: 1.2rem;
		}
		h1 {
			position: static;
			width: auto;
			height: auto;
			overflow: visible;
			clip: auto;
			flex: 1;
			font-size: 1.75rem;
		}
		/* Folded: a rail with the count, the whole width to the step. */
		.rail {
			flex: 0 0 4.5rem;
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 0.9rem;
			padding: 1.25rem 0;
			border: 0;
			border-right: 1px solid var(--line);
			border-radius: 0;
			background: var(--side);
		}
		.rail:hover {
			background: var(--btn);
		}
		.rail-arrow {
			font-size: 1.4rem;
		}
		.rail-text {
			writing-mode: vertical-rl;
			transform: rotate(180deg);
			font-size: 1.2rem;
			white-space: nowrap;
		}
		.steps {
			flex: 1 1 auto;
			min-width: 0;
		}
		.stage {
			padding: 2rem max(2.5rem, (100% - 60rem) / 2) 1.5rem;
		}
		/* The step, its chips and the steps around it sit in the upper part of
		   the pane, a little lower than the top (dead centre left a band of
		   empty paper above the step that read as missing). The space above is measured on the window, not on the pane,
		   so a timer strip or the screen note appearing below moves nothing; it
		   gives way only to a step too long to fit under it (then that one sits
		   higher, and a longer one still scrolls). */
		.stage::before {
			content: '';
			flex: 0 1 auto;
			height: max(0px, (100dvh - 34rem) / 4);
		}
		/* About 49 px at 1366 px wide, 60 px at most. */
		.now {
			font-size: calc(clamp(2.5rem, 3.6vw, 3.75rem) * var(--text, 1));
			line-height: 1.3;
		}
		.for-step {
			font-size: calc(1.2rem * (1 + (var(--text, 1) - 1) / 2));
		}
		.pager {
			padding: 0.75rem max(2.5rem, (100% - 60rem) / 2) 1rem;
		}
		.pager .prev,
		.pager button:not(.primary) {
			flex: 1;
		}
		.pager .prev {
			flex-direction: row;
			gap: 0.4rem;
			font-size: 1.3rem;
		}
		.prev .arrow {
			font-size: inherit;
		}
		.prev .label {
			display: inline;
		}
		.prev .short {
			display: none;
		}
		/* In the steps column, aligned with the pager: the checklist beside it is never covered. */
		.dock {
			padding: 0.3rem max(2.5rem, (100% - 60rem) / 2);
		}
		/* Read from across the kitchen: bigger digits. */
		.clock {
			font-size: 1.9rem;
		}
		.tm button {
			min-height: 3.25rem;
			padding: 0 0.8rem;
		}
		.tm .tbtn {
			min-width: 3.25rem;
			padding: 0;
		}
		/* The step's own timer, larger still. */
		.bigclock {
			font-size: calc(4rem * (1 + (var(--text, 1) - 1) / 2));
		}
		/* Held while the step's own timer comes or goes: the step text stays put. */
		.stage.held::before {
			height: var(--lead);
			flex-shrink: 0;
		}
		.wake-long {
			display: inline;
		}
		.wake-short {
			display: none;
		}
		.oname {
			max-width: 12rem;
		}
		.tlabel {
			font-size: 1.05rem;
		}
		.timers {
			flex-wrap: nowrap;
			overflow-x: auto;
			scrollbar-width: none;
		}
		.tm {
			flex: none;
		}
	}
</style>
