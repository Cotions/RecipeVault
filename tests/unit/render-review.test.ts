// Review fixes in the render layer: half hours in step text, French elision,
// plain text of a line with wikilinks and markers. Invented strings only.
import { describe, expect, it } from 'vitest';
import { de, ingredientText } from '../../src/lib/render/ingredient';
import { plainText } from '../../src/lib/render/markers';
import { findDurations } from '../../src/lib/render/timers';
import { parseQuantity } from '../../src/lib/vault/quantity';

const found = (s: string) => findDurations(s).map((d) => [d.text, d.seconds, d.maxSeconds]);

describe('findDurations: half hours', () => {
	it('reads « N heures 1/2 » as N h 30', () => {
		expect(found('Cuire 3 heures 1/2 à feu doux.')).toEqual([['3 heures 1/2', 12600, undefined]]);
		expect(found('Laisser reposer 1 heure 1/2.')).toEqual([['1 heure 1/2', 5400, undefined]]);
		expect(found('Cuire 2 h ½')).toEqual([['2 h ½', 9000, undefined]]);
	});
	it('reads « et demie »', () => {
		expect(found('Mijoter 1 heure et demie.')).toEqual([['1 heure et demie', 5400, undefined]]);
		expect(found('Mijoter 2 heures et demi')).toEqual([['2 heures et demi', 9000, undefined]]);
	});
	it('keeps the other forms', () => {
		expect(found('Cuire 1 h 30')).toEqual([['1 h 30', 5400, undefined]]);
		expect(found('Cuire 1 h 15 min')).toEqual([['1 h 15 min', 4500, undefined]]);
		expect(found('Cuire 3 1/2 heures')).toEqual([['3 1/2 heures', 12600, undefined]]);
		expect(found('Cuire 1 à 2 heures 1/2')).toEqual([['1 à 2 heures 1/2', 3600, 9000]]);
	});
});

describe('de: elision', () => {
	it('elides before a vowel and a mute h', () => {
		expect(de('ail')).toBe('d’');
		expect(de('œufs')).toBe('d’');
		expect(de('huile d’olive')).toBe('d’');
		expect(de('herbes salées')).toBe('d’');
	});
	it('does not elide before an aspirated h or a y', () => {
		for (const n of ['haricots', 'homard', 'hareng', 'hachis', 'houmous', 'yogourt']) expect(de(n)).toBe('de ');
	});
	it('reads naturally in a line', () => {
		const qty = { raw: 1, value: (parseQuantity(1) as { value: number }).value };
		expect(ingredientText({ qty, unit: 'cup', name: 'yogourt nature' }, { lang: 'fr' })).toBe('1 tasse de yogourt nature');
		expect(ingredientText({ qty, unit: 'can', name: 'haricots rouges' }, { lang: 'fr' })).toContain('de haricots rouges');
	});
});

describe('plainText', () => {
	it('keeps wikilinks as their label, title or slug', () => {
		expect(plainText('Foncer le moule avec la [[pate-inventee]] puis garnir')).toBe('Foncer le moule avec la pate-inventee puis garnir');
		expect(plainText('Foncer avec la [[pate-inventee]].', (s) => (s === 'pate-inventee' ? 'Pâte inventée' : undefined))).toBe(
			'Foncer avec la Pâte inventée.'
		);
		expect(plainText('Ajouter la [[sauce-test|sauce]] chaude')).toBe('Ajouter la sauce chaude');
	});
	it('removes the four markers only', () => {
		expect(plainText('Ajouter le bœuf [?] et le sel [+], puis [illisible] [?: cuire].')).toBe('Ajouter le bœuf et le sel, puis.');
		expect(plainText('Tarte [?]')).toBe('Tarte');
	});
});
