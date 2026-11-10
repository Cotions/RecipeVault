// The pan at another amount (plan 05, "The pan"; usability round 3). Invented step texts only.

import { describe, expect, it } from 'vitest';
import { bakedCount, countWord, findPan, panArea, panOptions, pluralPan, scaleNote, scaledCount } from '../../src/lib/render/pans';

describe('findPan', () => {
	it('a rectangle after its word, in inches or cm', () => {
		expect(findPan(['Verser dans un plat de 9 x 13.'])).toEqual({ word: 'plat', size: { shape: 'rect', w: 9, h: 13, unit: 'in' } });
		expect(findPan(['Presser dans un moule de 23 x 33 cm beurré.'])).toEqual({ word: 'moule', size: { shape: 'rect', w: 23, h: 33, unit: 'cm' } });
		expect(findPan(['Cuire dans un moule à pain de 9 x 5 po.'])?.size?.shape).toBe('loaf');
	});
	it('a rectangle before its word (English)', () => {
		expect(findPan(['Spread in a buttered 8 x 8 pan and chill.'])).toEqual({ word: 'pan', size: { shape: 'rect', w: 8, h: 8, unit: 'in' } });
	});
	it('one size: a square says so, a pie plate or a round pan is round', () => {
		expect(findPan(['Étendre dans un moule carré de 20 cm graissé.'])?.size).toEqual({ shape: 'rect', w: 20, h: 20, unit: 'cm' });
		expect(findPan(['Foncer une assiette à tarte de 9 po.'])?.size).toEqual({ shape: 'round', w: 9, h: 9, unit: 'in' });
		expect(findPan(['Use a 9-inch pie plate.'])?.size).toEqual({ shape: 'round', w: 9, h: 9, unit: 'in' });
	});
	it('a pan without a size, and texts that name none', () => {
		expect(findPan(['Beurrer un moule à pain.'])).toEqual({ word: 'moule' });
		expect(findPan(['Mélanger.', 'Verser dans une assiette à tarte.'])).toEqual({ word: 'assiette' });
		expect(findPan(['Servir dans un plat chaud.', 'Cuire 40 minutes à 350 °F.'])).toBeUndefined();
		// Pieces cut from it are not a pan; a cookie sheet is not one either.
		expect(findPan(['Étendre sur une plaque, couper en carrés de 2 po.'])).toBeUndefined();
		expect(findPan(['Couper dans le moule en carrés de 2 po.'])).toEqual({ word: 'moule' });
		expect(findPan(['Verser dans un plat beurré.'])).toEqual({ word: 'plat' });
	});
	it('the first sized pan wins over an earlier bare one', () => {
		expect(findPan(['Beurrer le moule.', 'Verser dans le moule de 8 x 8.'])?.size?.w).toBe(8);
	});
});

describe('panOptions', () => {
	const rect = (w: number, h: number) => ({ shape: 'rect' as const, w, h, unit: 'in' as const });
	it('× 2 of a 9 x 13: two of the same first', () => {
		expect(panOptions(rect(9, 13), 2)[0]).toEqual({ count: 2, size: rect(9, 13) });
	});
	it('× 1 ½ of a 9 x 13: two 9 x 9 or one 10 x 15', () => {
		expect(panOptions(rect(9, 13), 1.5)).toEqual([
			{ count: 2, size: rect(9, 9) },
			{ count: 1, size: rect(10, 15) }
		]);
	});
	it('× ½ of a 9 x 13: an 8 x 8', () => {
		expect(panOptions(rect(9, 13), 0.5)[0]).toEqual({ count: 1, size: rect(8, 8) });
	});
	it('every option within the tolerance of the scaled area; none when nothing fits', () => {
		for (const f of [0.5, 1.25, 1.5, 2, 3]) {
			for (const o of panOptions(rect(9, 13), f)) expect(Math.abs((o.count * panArea(o.size)) / (117 * f) - 1)).toBeLessThanOrEqual(0.17);
		}
		expect(panOptions({ shape: 'loaf', w: 9, h: 5, unit: 'in' }, 4)).toEqual([]);
	});
	it('round pans by their diameter', () => {
		expect(panOptions({ shape: 'round', w: 9, h: 9, unit: 'in' }, 2)[0]).toEqual({ count: 2, size: { shape: 'round', w: 9, h: 9, unit: 'in' } });
	});
});

describe('whole baked things (usability round 4)', () => {
	const recipe = (y: unknown, notes: string[] = []) => ({ yield: y as string, ingredients: [{ items: notes.map((note) => ({ note })) }] });
	it('reads a count from the yield, else from a note « pour 2 tartes »', () => {
		expect(bakedCount(recipe('2 tourtières'))).toEqual({ count: 2, word: 'tourtières', pie: true });
		expect(bakedCount(recipe({ qty: { value: 3 }, unit: 'piece', note: 'pains de 9 x 5 po' }))).toEqual({ count: 3, word: 'pains', pie: false });
		expect(bakedCount(recipe(undefined, ['froide', 'pour deux tartes de 9 po']))).toEqual({ count: 2, word: 'tartes', pie: true });
		expect(bakedCount(recipe('24 biscuits', ['pour 2 personnes']))).toBeUndefined();
		expect(bakedCount(recipe('2 à 3 douzaines'))).toBeUndefined();
	});
	it('a count at a factor, whole or rounded and marked', () => {
		expect(scaledCount(2, 2)).toEqual({ n: 4, approx: false });
		expect(scaledCount(2, 1.375)).toEqual({ n: 3, approx: true });
		expect(scaledCount(1, 0.25)).toEqual({ n: 1, approx: true });
	});
	it('words for one or several, and a pan’s words', () => {
		expect([countWord('tartes', 1, 'fr'), countWord('tarte', 2, 'fr'), countWord('gâteaux', 1, 'fr'), countWord('gâteau', 3, 'fr')]).toEqual(['tarte', 'tartes', 'gâteau', 'gâteaux']);
		expect([countWord('loaf', 2, 'en'), countWord('pies', 1, 'en')]).toEqual(['loaves', 'pie']);
		expect(pluralPan('assiette à tarte', 4, 'fr')).toBe('assiettes à tarte');
		expect(pluralPan('pie plate', 2, 'en')).toBe('pie plates');
		expect(pluralPan('moule', 1, 'fr')).toBe('moule');
	});
	it('a note « pour N … » scales; any other note stays', () => {
		expect(scaleNote('pour 2 tartes', 2, 'fr')).toBe('pour 4 tartes');
		expect(scaleNote('pour une tarte de 9 po', 2, 'fr')).toBe('pour 2 tartes de 9 po');
		expect(scaleNote('pour 2 tartes', 0.5, 'fr')).toBe('pour 1 tarte');
		expect(scaleNote('for 2 pies', 1.375, 'en')).toBe('for ≈ 3 pies');
		expect(scaleNote('boîte de 796 ml', 2, 'fr')).toBe('boîte de 796 ml');
		expect(scaleNote('pour 2 tartes', 1, 'fr')).toBe('pour 2 tartes');
	});
});
