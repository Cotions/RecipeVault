import { describe, expect, it } from 'vitest';
import { parseGives, splitAmount, yieldNoun } from '../../../src/lib/form/gives';

describe('« Donne » as one field', () => {
	it('reads a bare number, a range, a word for portions as servings', () => {
		expect(parseGives('8')).toEqual({ servings: '8', servingsMax: '', yieldText: '' });
		expect(parseGives('6 à 8 portions')).toEqual({ servings: '6', servingsMax: '8', yieldText: '' });
		expect(parseGives('6-8')).toEqual({ servings: '6', servingsMax: '8', yieldText: '' });
		expect(parseGives('pour 4 personnes')).toEqual({ servings: '4', servingsMax: '', yieldText: '' });
		expect(parseGives('1 portion')).toEqual({ servings: '1', servingsMax: '', yieldText: '' });
		expect(parseGives('serves 6')).toEqual({ servings: '6', servingsMax: '', yieldText: '' });
		// Not whole: still portions, so the form says « en nombre entier » rather than filing it as a yield.
		expect(parseGives('2,5 portions').servings).toBe('2,5');
	});

	it('keeps anything else as a yield in words, as typed', () => {
		expect(parseGives('2 tourtières')).toEqual({ servings: '', servingsMax: '', yieldText: '2 tourtières' });
		expect(parseGives(' 3  douzaines ')).toEqual({ servings: '', servingsMax: '', yieldText: '3 douzaines' });
		expect(parseGives('environ 4 litres').yieldText).toBe('environ 4 litres');
		expect(parseGives('1 moule de 8 x 8').yieldText).toBe('1 moule de 8 x 8');
		expect(parseGives('')).toEqual({ servings: '', servingsMax: '', yieldText: '' });
	});

	it('finds the noun of a yield and the amount she typed', () => {
		expect(yieldNoun('2 tourtières')).toBe('tourtières');
		expect(yieldNoun('4 pots de 500 ml')).toBe('pots de 500 ml');
		expect(yieldNoun('environ 4 litres')).toBeNull();
		expect(yieldNoun('12')).toBeNull();
		expect(splitAmount('2 tou')).toEqual({ amount: '2', rest: 'tou' });
		expect(splitAmount('6 à 8')).toEqual({ amount: '6 à 8', rest: '' });
		expect(splitAmount('tou')).toEqual({ amount: '', rest: 'tou' });
	});
});
