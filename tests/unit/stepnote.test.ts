// Kitchen mode's scaling note: on step 1 and on steps with a time, a temperature or a pan. Invented step texts only.

import { describe, expect, it } from 'vitest';
import { stepTakesScaleNote } from '../../src/lib/render/stepnote';

describe('stepTakesScaleNote', () => {
	it('always on step 1', () => {
		expect(stepTakesScaleNote('Battre les œufs.', 0, 'fr')).toBe(true);
	});
	it('a step with a time', () => {
		expect(stepTakesScaleNote('Laisser mijoter 20 min.', 3, 'fr')).toBe(true);
		expect(stepTakesScaleNote('Simmer for 1 hour.', 3, 'en')).toBe(true);
	});
	it('a step with a temperature or the oven', () => {
		expect(stepTakesScaleNote('Préchauffer à 350 °F.', 2, 'fr')).toBe(true);
		expect(stepTakesScaleNote('Mettre au four jusqu’à doré.', 2, 'fr')).toBe(true);
		expect(stepTakesScaleNote('Heat to 180 degrees.', 2, 'en')).toBe(true);
		expect(stepTakesScaleNote('Put it in the oven.', 2, 'en')).toBe(true);
	});
	it('a step with a pan', () => {
		expect(stepTakesScaleNote('Verser dans un plat de 9 x 13.', 4, 'fr')).toBe(true);
	});
	it('not a plain step, and not « four » counted in English', () => {
		expect(stepTakesScaleNote('Ajouter le sel et le poivre.', 1, 'fr')).toBe(false);
		expect(stepTakesScaleNote('Add four eggs, one at a time.', 1, 'en')).toBe(false);
	});
});
