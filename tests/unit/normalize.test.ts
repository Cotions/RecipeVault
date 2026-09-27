import { describe, expect, it } from 'vitest';
import { editDistance, fold, normalizeText, stripAccents } from '../../src/lib/vault/normalize';

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
