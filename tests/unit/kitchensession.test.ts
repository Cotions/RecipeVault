// Kitchen mode's saved session read from the recipe page (lib/kitchensession.ts):
// « Reprendre · étape N » only for a session kitchen mode itself would resume.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cookItems, cookUp, createRinger, endCook, markSeen, readCook, readCooks, readKitchenSession, resumeAmount, RING_AGAIN_MS, RING_FOR_MS, RUNG_MS, SESSION_MS } from '../../src/lib/kitchensession';

const NOW = 1_700_000_000_000;
const saved = (over: Record<string, unknown> = {}) => JSON.stringify({ v: 'abc', at: NOW - 60_000, step: 2, last: 0, ticks: [], factor: 1.5, timers: [], dark: false, ...over });

describe('readKitchenSession', () => {
	it('a session in progress: its step (1-based) and its amount', () => {
		expect(readKitchenSession(saved(), 'abc', 5, NOW)).toEqual({ step: 3, factor: 1.5, timers: 0 });
	});
	it('none for another version, an old or finished session, or broken storage', () => {
		expect(readKitchenSession(saved(), 'other', 5, NOW)).toBeNull();
		expect(readKitchenSession(saved({ at: NOW - SESSION_MS }), 'abc', 5, NOW)).toBeNull();
		expect(readKitchenSession(saved({ step: 5 }), 'abc', 5, NOW)).toBeNull();
		expect(readKitchenSession('{', 'abc', 5, NOW)).toBeNull();
		expect(readKitchenSession(null, 'abc', 5, NOW)).toBeNull();
	});
	it('the checklist with nothing done is not a cook in progress; a tick or a timer is', () => {
		expect(readKitchenSession(saved({ step: -1 }), 'abc', 5, NOW)).toBeNull();
		expect(readKitchenSession(saved({ step: -1, ticks: ['0:1'] }), 'abc', 5, NOW)).toEqual({ step: null, factor: 1.5, timers: 0 });
		expect(readKitchenSession(saved({ step: -1, last: 3 }), 'abc', 5, NOW)?.step).toBe(4);
		expect(readKitchenSession(saved({ step: -1, timers: [{ id: 't', done: false }, { id: 'u', done: true }] }), 'abc', 5, NOW)?.timers).toBe(1);
	});
});

describe('readKitchenSession, finished with a timer still on', () => {
	it('resumes at the last step while a timer runs', () => {
		expect(readKitchenSession(saved({ step: 5, timers: [{ id: 't', end: NOW + 60_000, step: 4, total: 60 }] }), 'abc', 5, NOW)).toEqual({ step: 5, factor: 1.5, timers: 1 });
	});
});

// The layout's cook chip: every session on the device, read without the recipe.
describe('readCook and cookUp', () => {
	const timer = (over: Record<string, unknown> = {}) => ({ id: 't', step: 2, end: NOW + 39 * 60_000, total: 2400, ...over });
	const cook = (over: Record<string, unknown> = {}) => saved({ n: 6, title: 'Pâté inventé', ...over });

	it('a session with a timer on, or a step to resume; none when nothing is on or it is old', () => {
		expect(readCook('pate', cook({ timers: [timer()] }), NOW)).toMatchObject({ slug: 'pate', title: 'Pâté inventé', step: 3, timers: [{ id: 't' }] });
		expect(readCook('pate', cook({ step: -1 }), NOW)).toBeNull();
		expect(readCook('pate', cook({ step: 6 }), NOW)).toBeNull();
		expect(readCook('pate', cook({ at: NOW - SESSION_MS }), NOW)).toBeNull();
		// Written before `n`: only its timers count.
		expect(readCook('pate', saved(), NOW)).toBeNull();
		// A rung timer nobody stopped calls for a while, then no more.
		expect(readCook('pate', cook({ step: 6, timers: [timer({ end: NOW - 60_000, done: true })] }), NOW)?.timers).toHaveLength(1);
		expect(readCook('pate', cook({ step: 6, timers: [timer({ end: NOW - RUNG_MS, done: true })] }), NOW)).toBeNull();
	});

	it('shows a rung timer first, then a range due for its check, then the soonest, then a step', () => {
		const a = readCook('a', cook({ timers: [timer({ id: 'a1', end: NOW + 10 * 60_000 }), timer({ id: 'a2', end: NOW + 5 * 60_000 })] }), NOW)!;
		const b = readCook('b', cook({ timers: [] }), NOW)!;
		expect(cookUp([b, a], NOW)).toMatchObject({ state: 'run', timer: { id: 'a2' }, cooks: 2 });
		const ranged = readCook('c', cook({ timers: [timer({ id: 'c1', end: NOW + 4 * 60_000, check: 5 * 60_000 })] }), NOW)!;
		expect(cookUp([a, ranged], NOW)).toMatchObject({ state: 'check', timer: { id: 'c1' } });
		const rung = readCook('d', cook({ timers: [timer({ id: 'd1', end: NOW - 1000 })] }), NOW)!;
		expect(cookUp([a, ranged, rung], NOW)).toMatchObject({ state: 'ring', timer: { id: 'd1' } });
		expect(cookUp([b], NOW)).toMatchObject({ state: 'step', timer: null });
		// Paused: after any running one.
		const paused = readCook('e', cook({ timers: [timer({ id: 'e1', left: 60_000 })] }), NOW)!;
		expect(cookUp([paused, b], NOW)).toMatchObject({ state: 'paused' });
		expect(cookUp([], NOW)).toBeNull();
	});

	it('a rung timer once seen is no longer called out; one item per cook, most pressing first', () => {
		expect(readCook('pate', cook({ step: 6, timers: [timer({ end: NOW - 60_000, done: true, seen: true })] }), NOW)).toBeNull();
		const a = readCook('a', cook({ timers: [timer({ id: 'a1', end: NOW + 9 * 60_000 }), timer({ id: 'a2', end: NOW - 1000 })] }), NOW)!;
		const b = readCook('b', cook({ timers: [timer({ id: 'b1', end: NOW + 3 * 60_000 })] }), NOW)!;
		const c = readCook('c', cook({ timers: [] }), NOW)!;
		expect(cookItems([c, b, a], NOW).map((x) => [x.cook.slug, x.state])).toEqual([
			['a', 'ring'],
			['b', 'run'],
			['c', 'step']
		]);
	});
});

describe('markSeen', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('marks only the named timers of that session', () => {
		const store = new Map<string, string>();
		vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
		store.set('rv-kitchen:pate', JSON.stringify({ at: NOW, timers: [{ id: 'x' }, { id: 'y' }] }));
		markSeen('pate', ['y']);
		expect(JSON.parse(store.get('rv-kitchen:pate')!).timers).toEqual([{ id: 'x' }, { id: 'y', seen: true }]);
		markSeen('absent', ['y']);
		expect(store.has('rv-kitchen:absent')).toBe(false);
	});
});

describe('resumeAmount (« Reprendre » and the page’s amount, usability round 4)', () => {
	it('the page at the session’s amount: nothing to carry, nothing to say', () => {
		expect(resumeAmount(1.25, 1.25, true)).toEqual({ carry: false, named: undefined });
		expect(resumeAmount(1.25, 1.25, false)).toEqual({ carry: false, named: undefined });
	});
	it('an amount she set on the page wins: carried into kitchen mode and named on the button', () => {
		expect(resumeAmount(1.25, 2, true)).toEqual({ carry: true, named: 2 });
		// Back to the card's amount by hand is a choice too.
		expect(resumeAmount(1.25, 1, true)).toEqual({ carry: true, named: 1 });
	});
	it('a page she did not touch: the session’s amount stays, and the button says it', () => {
		expect(resumeAmount(1.25, 1, false)).toEqual({ carry: false, named: 1.25 });
	});
	it('an older session without a factor: carried only when she set one', () => {
		expect(resumeAmount(undefined, 2, true)).toEqual({ carry: true, named: 2 });
		expect(resumeAmount(undefined, 1, false)).toEqual({ carry: false, named: undefined });
	});
});

describe('endCook and expiry (the header’s « Recettes en cuisine »)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('« × Terminer » removes that session only; an untouched one past SESSION_MS is not listed', () => {
		const store = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, v),
			removeItem: (k: string) => void store.delete(k),
			key: (i: number) => [...store.keys()][i] ?? null,
			get length() {
				return store.size;
			}
		});
		const s = (at: number) => JSON.stringify({ at, n: 4, step: 1, last: 0, ticks: [], timers: [], title: 'x' });
		store.set('rv-kitchen:a', s(NOW - 60_000));
		store.set('rv-kitchen:b', s(NOW - 60_000));
		store.set('rv-kitchen:old', s(NOW - SESSION_MS));
		expect(readCooks(NOW).map((c) => c.slug)).toEqual(['a', 'b']);
		endCook('a');
		expect(store.has('rv-kitchen:a')).toBe(false);
		expect(readCooks(NOW).map((c) => c.slug)).toEqual(['b']);
	});
});

describe('createRinger', () => {
	const cookWith = (timers: Record<string, unknown>[]) => readCook('a', saved({ n: 6, timers }), NOW)!;

	it('sounds a timer done once, again every 20 s for 3 min; a range’s check once, softly', () => {
		const sound = vi.fn();
		const r = createRinger(sound);
		const t = { id: 't', step: 0, end: NOW + 1000, total: 60 };
		r.prime([cookWith([t])], NOW);
		r.check([cookWith([t])], NOW);
		expect(sound).not.toHaveBeenCalled();
		r.check([cookWith([t])], NOW + 1000);
		expect(sound).toHaveBeenCalledTimes(1);
		r.check([cookWith([t])], NOW + 1000 + RING_AGAIN_MS - 1);
		expect(sound).toHaveBeenCalledTimes(1);
		r.check([cookWith([t])], NOW + 1000 + RING_AGAIN_MS);
		expect(sound).toHaveBeenCalledTimes(2);
		r.check([cookWith([t])], NOW + 1000 + RING_FOR_MS + RING_AGAIN_MS);
		expect(sound).toHaveBeenCalledTimes(2);

		const soft = vi.fn();
		const q = createRinger(soft);
		const range = { id: 'r', step: 0, end: NOW + 10 * 60_000, total: 600, check: 5 * 60_000 };
		q.check([cookWith([range])], NOW + 5 * 60_000);
		q.check([cookWith([range])], NOW + 5 * 60_000 + 500);
		expect(soft).toHaveBeenCalledTimes(1);
		expect(soft).toHaveBeenCalledWith(true);
	});

	it('a timer already rung when the page opens is not sounded late', () => {
		const sound = vi.fn();
		const r = createRinger(sound);
		const t = { id: 't', step: 0, end: NOW - 5000, total: 60 };
		r.prime([cookWith([t])], NOW);
		r.check([cookWith([t])], NOW);
		expect(sound).not.toHaveBeenCalled();
		// Still within its 3 min: it keeps calling, at its own rhythm.
		r.check([cookWith([t])], NOW + RING_AGAIN_MS);
		expect(sound).toHaveBeenCalledTimes(1);
	});
});
