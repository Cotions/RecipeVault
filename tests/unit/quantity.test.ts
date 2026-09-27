import { describe, expect, it } from 'vitest';
import { parseQuantity } from '../../src/lib/vault/quantity';

describe('parseQuantity', () => {
	it.each([
		[2, 2],
		[0.5, 0.5],
		['1 1/2', 1.5],
		['2/3', 2 / 3],
		['1/8', 0.125],
		['250', 250],
		['250 [?]', 250],
		['1/2 [?: 1/4]', 0.5],
		['[+] 3', 3]
	])('%j → %d', (input, value) => {
		const r = parseQuantity(input);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toBeCloseTo(value);
	});

	it.each([['beaucoup'], [''], ['1/0'], [0], [-1], ['1 3/2'], [true], [null], [Infinity], ['2 tasses']])(
		'rejects %j',
		(input) => {
			expect(parseQuantity(input).ok).toBe(false);
		}
	);

	it.each([
		['0,5', '0.5'],
		['½', '"1/2"'],
		['1½', '"1 1/2"'],
		['1-2', '1, qty_max: 2'],
		['2 à 3', '2, qty_max: 3'],
		['1-1/2', '"1 1/2"']
	])('suggests a fix for %j', (input, suggestion) => {
		const r = parseQuantity(input);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.suggestion).toBe(suggestion);
	});

	it.each([['3-1'], ['2 à 2'], ['1-1/2 à 1']])('suggests no range whose high end is not higher: %j', (input) => {
		const r = parseQuantity(input);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.suggestion).toBeUndefined();
	});
});
