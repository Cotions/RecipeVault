// The draft note's time: « Brouillon gardé à 1 h 40 » (no leading zero, no-break spaces).

import { describe, expect, it } from 'vitest';
import { draftClock } from '../../../src/lib/form/draft';

const at = (h: number, m: number) => new Date(2026, 0, 15, h, m).getTime();

describe('draftClock', () => {
	it('French: hours with no leading zero, minutes on two digits', () => {
		expect(draftClock(at(1, 40), 'fr')).toBe('1\u00a0h\u00a040');
		expect(draftClock(at(13, 5), 'fr')).toBe('13\u00a0h\u00a005');
		expect(draftClock(at(0, 0), 'fr')).toBe('0\u00a0h\u00a000');
	});
	it('English: the short time, never split', () => {
		const s = draftClock(at(13, 40), 'en');
		expect(s).toMatch(/1:40/);
		expect(s).not.toMatch(/[ \t]/);
	});
});
