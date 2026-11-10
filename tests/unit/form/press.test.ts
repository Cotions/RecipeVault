// `afterPress` (usability pass, round 1): what a blur changes waits until the
// press that caused it is released and its click handled, so nothing moves
// under the pointer between the press and the release.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let afterPress: (fn: () => void) => void;
const win = new EventTarget();

beforeAll(async () => {
	vi.stubGlobal('window', win);
	({ afterPress } = await import('../../../src/lib/components/form/press'));
});
afterEach(() => vi.useRealTimers());

describe('afterPress', () => {
	it('runs at once when no press is in progress (a Tab, a key)', () => {
		const fn = vi.fn();
		afterPress(fn);
		expect(fn).toHaveBeenCalledOnce();
	});

	it('waits for the release and the click, then runs once', () => {
		vi.useFakeTimers();
		const fn = vi.fn();
		win.dispatchEvent(new Event('pointerdown'));
		afterPress(fn);
		expect(fn).not.toHaveBeenCalled();
		win.dispatchEvent(new Event('pointerup'));
		expect(fn).not.toHaveBeenCalled();
		win.dispatchEvent(new Event('click'));
		vi.advanceTimersByTime(0);
		expect(fn).toHaveBeenCalledOnce();
		vi.advanceTimersByTime(500);
		expect(fn).toHaveBeenCalledOnce();
	});

	it('a release with no click (a drag, a scroll) still runs it soon', () => {
		vi.useFakeTimers();
		const fn = vi.fn();
		win.dispatchEvent(new Event('pointerdown'));
		afterPress(fn);
		win.dispatchEvent(new Event('pointercancel'));
		vi.advanceTimersByTime(249);
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(fn).toHaveBeenCalledOnce();
	});
});
