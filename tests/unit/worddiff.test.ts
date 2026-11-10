// The history's word-by-word view of a changed line (usability round 4).

import { describe, expect, it } from 'vitest';
import { wordDiff } from '../../src/lib/render/worddiff';

const show = (a: string, b: string) => wordDiff(a, b).map((p) => (p.op === 'same' ? p.text : p.op === 'del' ? `[-${p.text}]` : `[+${p.text}]`)).join('');

describe('wordDiff', () => {
	it('marks only the words that changed, and joins back to both texts', () => {
		expect(show('1 ½ lb de bœuf haché', '2 lb de bœuf haché')).toBe('[-1 ½ ][+2 ]lb de bœuf haché');
		const parts = wordDiff('Cuire 10 min à 350 °F.', 'Cuire 12 min à 350 °F.');
		expect(parts.filter((p) => p.op !== 'ins').map((p) => p.text).join('')).toBe('Cuire 10 min à 350 °F.');
		expect(parts.filter((p) => p.op !== 'del').map((p) => p.text).join('')).toBe('Cuire 12 min à 350 °F.');
	});
	it('the same text is one plain part; an empty side is all one kind', () => {
		expect(wordDiff('Servir.', 'Servir.')).toEqual([{ op: 'same', text: 'Servir.' }]);
		expect(wordDiff('', 'Servir chaud.')).toEqual([{ op: 'ins', text: 'Servir chaud.' }]);
		expect(wordDiff('Servir chaud.', '')).toEqual([{ op: 'del', text: 'Servir chaud. ' }]);
	});
	it('two texts with little in common show whole: the old struck, then the new', () => {
		expect(wordDiff('Mélanger la farine et le sucre.', 'Cuire au four 20 minutes.')).toEqual([
			{ op: 'del', text: 'Mélanger la farine et le sucre. ' },
			{ op: 'ins', text: 'Cuire au four 20 minutes.' }
		]);
	});
});
