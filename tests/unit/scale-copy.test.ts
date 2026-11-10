// The recipe page's one note at another amount (usability round 6): what stays
// the card's, the pan, ≈; and the keeper's « Coût : 7 prix manquants › ».

import { describe, expect, it } from 'vitest';
import { en } from '../../src/lib/i18n/en';
import { fr } from '../../src/lib/i18n/fr';

describe('scaling.kept', () => {
	it('names what stays the card’s, in one short phrase', () => {
		expect(fr.scaling.kept({ steps: false, oven: true, pan: true })).toBe('Temps, four et moule inchangés');
		expect(fr.scaling.kept({ steps: false, oven: true, pan: false })).toBe('Temps et four inchangés');
		expect(fr.scaling.kept({ steps: true, oven: true, pan: true })).toBe('Étapes, temps, four et moule inchangés');
		expect(fr.scaling.kept({ steps: false, oven: false, pan: false })).toBe('Temps inchangés');
		expect(en.scaling.kept({ steps: true, oven: false, pan: false })).toBe('Steps and times unchanged');
		expect(en.scaling.kept({ steps: false, oven: true, pan: true })).toBe('Times, oven and pan unchanged');
	});
	it('the pan, short', () => {
		expect(fr.scaling.panBakedShort(false, '4', 'assiettes à tarte', '9 po')).toBe('prévoir 4 assiettes à tarte de 9 po');
		expect(fr.scaling.panAreaShort('1 ½')).toBe('moule : × 1 ½ la surface');
		expect(fr.scaling.panShort(['2 moules de 8 po', '1 plat de 9 x 13'])).toBe('moule : 2 moules de 8 po ou 1 plat de 9 x 13');
		expect(en.scaling.panBakedShort(true, '3', 'pie plates', '9-inch')).toBe('get ≈ 3 9-inch pie plates');
	});
});

describe('cost.missing', () => {
	it('agrees with its count', () => {
		expect(fr.cost.missing(1)).toBe('1 prix manquant ›');
		expect(fr.cost.missing(7)).toBe('7 prix manquants ›');
		expect(en.cost.missing(2)).toBe('2 missing prices ›');
	});
});
