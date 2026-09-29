import { describe, expect, it } from 'vitest';
import { editDistance, fold, normalizeText, stripAccents, withinDistance } from '../../src/lib/vault/normalize';

describe('normalizeText', () => {
	it('makes precomposed and combining é equal', () => {
		expect('cre\u0301me').not.toBe('cr\u00e9me');
		expect(normalizeText('cre\u0301me')).toBe(normalizeText('cr\u00e9me'));
	});

	it('strips a BOM and converts line endings', () => {
		expect(normalizeText('\uFEFFa\r\nb\rc\n')).toBe('a\nb\nc\n');
	});
});

describe('stripAccents / fold', () => {
	it('drops accents and ligatures', () => {
		expect(stripAccents('Bœuf à la crème, Æ')).toBe('Boeuf a la creme, AE');
	});

	it('folds case, accents and spacing', () => {
		expect(fold('  Préparation   Rapide ')).toBe('preparation rapide');
	});
});

describe('editDistance', () => {
	it('counts edits', () => {
		expect(editDistance('lasagna', 'lasagne')).toBe(1);
		expect(editDistance('lasagna', 'lasagnes')).toBe(2);
		expect(editDistance('', 'abc')).toBe(3);
		expect(editDistance('abc', 'abc')).toBe(0);
	});
});

describe('withinDistance', () => {
	it('answers editDistance(a, b) <= max, for every pair of short strings', () => {
		const words = [''];
		for (let len = 1; len <= 4; len++) for (const w of words.filter((x) => x.length === len - 1)) for (const c of 'abc') words.push(w + c);
		for (const a of words)
			for (const b of words) for (let max = 0; max <= 3; max++) if (withinDistance(a, b, max) !== editDistance(a, b) <= max) throw new Error(`${a} / ${b} / ${max}`);
	});

	it('near titles', () => {
		expect(withinDistance('tarte au sucre', 'tartes au sucre', 2)).toBe(true);
		expect(withinDistance('tarte au sucre', 'tarte aux sucres', 2)).toBe(true);
		expect(withinDistance('tarte au sucre', 'tarte au sirop', 2)).toBe(false);
		expect(withinDistance('pouding', 'pouding chomeur', 2)).toBe(false);
	});
});
