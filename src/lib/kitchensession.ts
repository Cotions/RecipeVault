// Kitchen mode's saved session (`rv-kitchen:<slug>` in localStorage, written by
// /r/<slug>/cuisine), read from elsewhere: the recipe page's « Cuisiner »
// becomes « Reprendre · étape N » while a cook is in progress on this device.
// Browser-safe; every read is guarded (no storage, a broken entry: no session).
//
// The rules are kitchen mode's own (its `load()`): the same recipe content
// (`v`, a fingerprint of the ingredient list and the steps), changed less
// than SESSION_MS ago, not finished (`step` < the number of steps).

import type { Ingredient } from './vault/types';

/** The localStorage key of a recipe's kitchen session. */
export const kitchenKey = (slug: string) => `rv-kitchen:${slug}`;

/** A session older than this is a new cook, not a resume (kitchen mode's SESSION_MS). */
export const SESSION_MS = 12 * 3600 * 1000;

/** FNV-1a, base 36: kitchen mode's fingerprint of a recipe's content. */
export function fingerprint(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(36);
}

/** Which recipe content a session belongs to: its ingredient groups and its steps' texts. */
export function kitchenVersion(ingredients: readonly { items: readonly Ingredient[] }[], stepTexts: readonly string[]): string {
	return fingerprint(JSON.stringify([ingredients, stepTexts]));
}

export interface KitchenResume {
	/** The step to resume at, 1-based; null on the phone's ingredient checklist before any step. */
	step: number | null;
	/** The session's scaling factor, when it saved one. */
	factor?: number;
	/** Timers still running or paused (not rung). */
	timers: number;
}

interface Saved {
	v?: unknown;
	at?: unknown;
	step?: unknown;
	last?: unknown;
	ticks?: unknown;
	factor?: unknown;
	timers?: unknown;
}

/**
 * The session a cook can resume, or null: none, another version of the
 * recipe, too old, finished, or opened without anything done yet (on the
 * checklist, nothing ticked, no timer).
 */
export function readKitchenSession(raw: string | null, version: string, stepCount: number, now = Date.now()): KitchenResume | null {
	if (!raw) return null;
	let s: Saved;
	try {
		s = JSON.parse(raw) as Saved;
	} catch {
		return null;
	}
	if (!s || typeof s !== 'object' || s.v !== version) return null;
	if (typeof s.at !== 'number' || now - s.at >= SESSION_MS) return null;
	const timers = Array.isArray(s.timers) ? s.timers.filter((x) => x && typeof x === 'object' && !(x as { done?: boolean }).done).length : 0;
	if (typeof s.step !== 'number') return null;
	// Finished, a timer still on (it lives in kitchen mode): resumed at the last step.
	if (s.step >= stepCount) return timers && stepCount ? { step: stepCount, timers, ...(typeof s.factor === 'number' && s.factor > 0 ? { factor: s.factor } : {}) } : null;
	const ticks = Array.isArray(s.ticks) ? s.ticks.length : 0;
	const last = typeof s.last === 'number' && s.last >= 0 && s.last < stepCount ? s.last : 0;
	const step = s.step >= 0 ? s.step + 1 : last > 0 ? last + 1 : null;
	if (step === null && !ticks && !timers) return null;
	return { step, timers, ...(typeof s.factor === 'number' && s.factor > 0 ? { factor: s.factor } : {}) };
}

/**
 * What « Reprendre » opens at (usability round 4, plan 05 "The address and a
 * resume"): when she set the amount on the recipe page herself (an explicit
 * `?portions` / `?fois`, or the stepper this visit) and it is not the
 * session's, the link carries the page's amount and the cook goes on at it
 * (step, ticks and timers kept); otherwise the session's amount stays. `named`:
 * the amount the button names, when it is not the one the page shows or the
 * cook changes amount; undefined when the label needs none.
 */
export function resumeAmount(sessionFactor: number | undefined, pageFactor: number, pageSet: boolean): { carry: boolean; named: number | undefined } {
	const same = sessionFactor !== undefined && Math.abs(sessionFactor - pageFactor) < 1e-9;
	if (same) return { carry: false, named: undefined };
	if (pageSet) return { carry: true, named: pageFactor };
	return { carry: false, named: sessionFactor };
}

/** The resumable session of a recipe on this device, from localStorage; null on the server or without storage. */
export function kitchenSession(slug: string, version: string, stepCount: number): KitchenResume | null {
	try {
		if (typeof localStorage === 'undefined') return null;
		return readKitchenSession(localStorage.getItem(kitchenKey(slug)), version, stepCount);
	} catch {
		return null;
	}
}

// --- every cook in progress on this device (the layout's CookChip) -----------
// Read without the recipe at hand, so without the content check (`v`): the
// session's own `n` (its number of steps) and `title`, written by kitchen mode.

/** A kitchen timer as kitchen mode saves it. */
export interface CookTimer {
	id: string;
	step: number;
	/** Epoch ms when it rings. */
	end: number;
	total: number;
	done?: boolean;
	/** Paused: the ms that were left. */
	left?: number;
	/** A range (« 35 à 40 minutes »): the ms left at its lower bound, when to check. */
	check?: number;
	/** Rung and seen on its recipe's kitchen mode, or put away from the cook chip: no longer called out elsewhere. */
	seen?: boolean;
}

export interface Cook {
	slug: string;
	title: string | null;
	/** Last change, epoch ms. */
	at: number;
	/** The step to resume at, 1-based; null without one (the checklist, or a session written before `n`). */
	step: number | null;
	/** Timers still on: running, paused, or rung less than {@link RUNG_MS} ago, not stopped and not seen. */
	timers: CookTimer[];
}

/** A rung timer nobody stopped stops calling for attention after this. */
export const RUNG_MS = 30 * 60_000;

/** The ms a timer has left (negative once past its end); a rung one: 0 or less. */
export const timeLeft = (x: CookTimer, now: number) => (x.left !== undefined ? x.left : x.end - now);

/** One saved session as a cook in progress, or null: too old, broken, or nothing on and nothing to resume. */
export function readCook(slug: string, raw: string | null, now = Date.now()): Cook | null {
	if (!raw) return null;
	let s: Saved & { n?: unknown; title?: unknown };
	try {
		s = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!s || typeof s !== 'object' || typeof s.at !== 'number' || now - s.at >= SESSION_MS) return null;
	const timers = (Array.isArray(s.timers) ? s.timers : []).filter(
		(x): x is CookTimer =>
			!!x && typeof x === 'object' && typeof x.end === 'number' && typeof x.step === 'number' && (!(x.done || (x.left === undefined && x.end <= now)) || (!x.seen && now - x.end < RUNG_MS))
	);
	let step: number | null = null;
	if (typeof s.n === 'number' && typeof s.step === 'number' && s.step < s.n) {
		const last = typeof s.last === 'number' && s.last >= 0 && s.last < s.n ? s.last : 0;
		const ticks = Array.isArray(s.ticks) ? s.ticks.length : 0;
		step = s.step >= 0 ? s.step + 1 : last > 0 ? last + 1 : ticks ? 1 : null;
	}
	if (!timers.length && step === null) return null;
	return { slug, title: typeof s.title === 'string' && s.title ? s.title : null, at: s.at, step, timers };
}

/** Every cook in progress in this browser's storage; none on the server or without storage. */
export function readCooks(now = Date.now()): Cook[] {
	const out: Cook[] = [];
	try {
		if (typeof localStorage === 'undefined') return out;
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (!k?.startsWith('rv-kitchen:')) continue;
			const c = readCook(k.slice('rv-kitchen:'.length), localStorage.getItem(k), now);
			if (c) out.push(c);
		}
	} catch {
		// no storage: none
	}
	return out;
}

/** What the chip shows: `ring` a timer done, `check` a range at its lower bound, `run` / `paused` a timer, `step` a step to resume. */
export interface CookItem {
	cook: Cook;
	timer: CookTimer | null;
	state: 'ring' | 'check' | 'run' | 'paused' | 'step';
}

export interface CookUp extends CookItem {
	/** How many cooks are in progress, this one included. */
	cooks: number;
}

/** A timer's state now. */
export function timerState(timer: CookTimer, now: number): Exclude<CookItem['state'], 'step'> {
	const left = timeLeft(timer, now);
	const paused = timer.left !== undefined && !timer.done;
	return timer.done || (!paused && left <= 0) ? 'ring' : paused ? 'paused' : timer.check !== undefined && left <= timer.check ? 'check' : 'run';
}

const RANK = { ring: 0, check: 1, run: 2, paused: 3, step: 4 } as const;

/**
 * Each cook in progress by the one thing to show of it, the most pressing
 * first: a rung timer, then a range due for its check, then the running timer
 * that rings soonest, a paused one, and last the most recent step to resume.
 */
export function cookItems(cooks: readonly Cook[], now = Date.now()): CookItem[] {
	type Cand = CookItem & { rank: number; key: number };
	const order = (a: Cand, b: Cand) => a.rank - b.rank || a.key - b.key;
	const best: Cand[] = [];
	for (const cook of cooks) {
		const all: Cand[] = cook.timers.map((timer) => {
			const state = timerState(timer, now);
			return { cook, timer, state, rank: RANK[state], key: state === 'ring' ? timer.end : timeLeft(timer, now) };
		});
		if (cook.step !== null) all.push({ cook, timer: null, state: 'step', rank: RANK.step, key: -cook.at });
		if (all.length) best.push(all.sort(order)[0]);
	}
	return best.sort(order).map(({ cook, timer, state }) => ({ cook, timer, state }));
}

/** The one thing to show of all cooks in progress ({@link cookItems}' first), or null when there is none. */
export function cookUp(cooks: readonly Cook[], now = Date.now()): CookUp | null {
	const top = cookItems(cooks, now)[0];
	return top ? { ...top, cooks: cooks.length } : null;
}

/** Where a cook's chip leads: its kitchen mode, at its timer's step (`?etape=`, 1-based). */
export const cookHref = (item: CookItem) => `/r/${item.cook.slug}/cuisine${item.timer ? `?etape=${item.timer.step + 1}` : ''}`;

/**
 * Rung timers no longer called out on other pages (`seen`), written into
 * their session: kitchen mode keeps them, and its own alarm, until stopped.
 */
export function markSeen(slug: string, ids: readonly string[]): void {
	try {
		const k = kitchenKey(slug);
		const s = JSON.parse(localStorage.getItem(k) ?? 'null');
		if (!s || !Array.isArray(s.timers)) return;
		s.timers = s.timers.map((x: CookTimer) => (x && ids.includes(x.id) ? { ...x, seen: true } : x));
		localStorage.setItem(k, JSON.stringify(s));
	} catch {
		// no storage: shown until stopped
	}
}

/** « × Terminer » in the header's list of cooks: that recipe's session goes (its step, ticks and timers), on this device. */
export function endCook(slug: string): void {
	try {
		localStorage.removeItem(kitchenKey(slug));
	} catch {
		// no storage: nothing kept anyway
	}
}

/** The alarm calls again this often, for {@link RING_FOR_MS} after a timer is done (kitchen mode's own rhythm). */
export const RING_AGAIN_MS = 20_000;
export const RING_FOR_MS = 3 * 60_000;

/**
 * The alarm for timers of cooks not on screen (the cook chip on other pages;
 * kitchen mode for the other recipes' timers): a timer done sounds once, then
 * again every {@link RING_AGAIN_MS} for {@link RING_FOR_MS}; a range at its
 * lower bound calls once, softly. One that rang while no page was open is
 * seen, not sounded late; `prime` takes what is already rung or checked when
 * the page opens.
 */
export function createRinger(sound: (soft?: boolean) => void) {
	const rung = new Set<string>();
	const checked = new Set<string>();
	let rangAt = 0;
	return {
		prime(cooks: readonly Cook[], now = Date.now()) {
			for (const c of cooks)
				for (const tm of c.timers) {
					const left = timeLeft(tm, now);
					if (tm.done || (tm.left === undefined && left <= 0)) {
						rung.add(tm.id);
						// Still calling: again in 20 s, not at once on opening the page.
						rangAt = now;
					}
					else if (tm.check !== undefined && left <= tm.check) checked.add(tm.id);
				}
		},
		check(cooks: readonly Cook[], now = Date.now()) {
			for (const c of cooks)
				for (const tm of c.timers) {
					const left = timeLeft(tm, now);
					const on = tm.left === undefined || tm.done;
					if (on && (tm.done || left <= 0)) {
						if (!rung.has(tm.id)) {
							rung.add(tm.id);
							if (-left < RING_FOR_MS) {
								rangAt = now;
								sound();
							}
						} else if (now - rangAt >= RING_AGAIN_MS && -left < RING_FOR_MS) {
							rangAt = now;
							sound();
						}
					} else if (tm.check !== undefined && tm.left === undefined && left <= tm.check && !checked.has(tm.id)) {
						checked.add(tm.id);
						if (tm.check - left < 60_000) sound(true);
					}
				}
		}
	};
}

/** A step-only chip put away (its × « Masquer »): `slug@at`, shown again once that session changes. */
export const chipId = (up: CookItem) => `${up.cook.slug}@${up.cook.at}`;

/**
 * Whether the cook chip shows `up` on the page at `path`: a step to resume is
 * not shown on its recipe's own page (its « Reprendre » is there) nor once put
 * away. app.html's first-paint script reads the same rule.
 */
export function chipShown(up: CookItem | null, path: string, hidden: string | null): boolean {
	return !!up && !(up.state === 'step' && (path === `/r/${up.cook.slug}` || hidden === chipId(up)));
}
