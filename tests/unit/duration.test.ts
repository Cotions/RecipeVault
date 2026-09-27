import { describe, expect, it } from 'vitest';
import { formatDuration, parseDuration, suggestDuration } from '../../src/lib/vault/duration';

describe('parseDuration', () => {
	it.each([
		['30m', 1800, undefined],
		['1h', 3600, undefined],
		['1h15m', 4500, undefined],
		['45m-50m', 2700, 3000],
		['1h-1h30m', 3600, 5400],
		['90m', 5400, undefined],
		['30m [?]', 1800, undefined]
	])('%s', (input, seconds, maxSeconds) => {
		const d = parseDuration(input);
		expect(d?.seconds).toBe(seconds);
		expect(d?.maxSeconds).toBe(maxSeconds);
		expect(d?.raw).toBe(input);
	});

	it.each([
		'2 hrs',
		'1 1/4 heure',
		'45-50 minutes',
		'2 heures de réfrigération',
		'1h 15m',
		'30 min',
		'',
		'h',
		'50m-45m',
		'1h-2h-3h',
		30
	])('rejects %j', (input) => {
		expect(parseDuration(input)).toBeUndefined();
	});
});

describe('suggestDuration', () => {
	it.each([
		['2 hrs', '2h'],
		['1 1/4 heure', '1h15m'],
		['45-50 minutes', '45m-50m'],
		['2 heures de réfrigération', '2h'],
		['1h 15m', '1h15m'],
		['1 h 30', '1h30m'],
		['30 min', '30m'],
		['1 à 2 heures', '1h-2h'],
		[30, '30m']
	])('%j → %s', (input, out) => {
		expect(suggestDuration(input)).toBe(out);
	});

	it('gives up on text it cannot read', () => {
		expect(suggestDuration('toute la nuit')).toBeUndefined();
	});
});

describe('formatDuration', () => {
	it('formats', () => {
		expect(formatDuration(4500)).toBe('1h15m');
		expect(formatDuration(3600)).toBe('1h');
		expect(formatDuration(600)).toBe('10m');
	});
});
