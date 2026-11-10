import { describe, expect, it } from 'vitest';
import { excerpt, hitRanges, hitSegments, queryTerms, termsIn } from '../../src/lib/render/hits';
import { provenanceLine, provenanceParts } from '../../src/lib/render/provenance';

describe('search hits', () => {
	it('folds the search like the index does', () => {
		expect(queryTerms('  Bœuf  HACHÉ, crème ')).toEqual(['boeuf', 'hache', 'creme']);
		expect(queryTerms('')).toEqual([]);
	});

	it('marks whole words that start with a term, in the text as written', () => {
		const text = 'Lasagnes à la bolognaise';
		expect(hitSegments(text, ['lasag'])).toEqual([
			{ text: 'Lasagnes', hit: true },
			{ text: ' à la bolognaise', hit: false }
		]);
		expect(hitSegments('Crème brûlée', ['brule'])).toEqual([
			{ text: 'Crème ', hit: false },
			{ text: 'brûlée', hit: true }
		]);
		// œ folds to two letters but marks one character.
		const r = hitRanges('Un bœuf haché', ['boeuf']);
		expect(r).toEqual([[3, 7]]);
		expect('Un bœuf haché'.slice(...r[0])).toBe('bœuf');
		// Only at the start of a word.
		expect(hitRanges('sirop d’érable', ['rable'])).toEqual([]);
		expect(hitSegments('rien', [])).toEqual([{ text: 'rien', hit: false }]);
	});

	it('keeps hostile text as text', () => {
		const segs = hitSegments('<img src=x onerror=alert(1)> sucre', ['sucre']);
		expect(segs.map((s) => s.text).join('')).toBe('<img src=x onerror=alert(1)> sucre');
		expect(segs.at(-1)).toEqual({ text: 'sucre', hit: true });
	});

	it('says which terms a text holds and cuts a window around the first hit', () => {
		expect([...termsIn('Pâte à tarte', ['pate', 'sucre', 'tar'])]).toEqual(['pate', 'tar']);
		const long = 'Un mot. '.repeat(20) + 'Servir avec une tourtière bien chaude. ' + 'Encore. '.repeat(30);
		const x = excerpt(long, ['tourti'])!;
		expect(x.startsWith('… ')).toBe(true);
		expect(x.endsWith(' …')).toBe(true);
		expect(x).toContain('tourtière');
		expect(x.length).toBeLessThan(160);
		expect(excerpt('court', ['court'])).toBe('court');
		expect(excerpt('court', ['rien'])).toBeUndefined();
	});
});

describe('provenance line', () => {
	it('names the person, with « de » or « d’ »', () => {
		expect(provenanceLine({ author: 'Tante Aline', source_type: 'family' })).toBe('de Tante Aline');
		expect(provenanceLine({ author: 'Aline' })).toBe('d’Aline');
	});
	it('reads a published source as « Tiré de »', () => {
		expect(provenanceLine({ source_type: 'book', source_title: 'Cuisine inventée', source_page: '12', author: 'Éditions Fictives' })).toBe(
			'Tiré de Cuisine inventée, p. 12 · Éditions Fictives'
		);
	});
	it('falls back to the site, the type, then the variant', () => {
		expect(provenanceLine({ source_type: 'website', source_url: 'https://www.example.invalid/x' })).toBe('Site web · example.invalid');
		expect(provenanceLine({ source_type: 'family' })).toBe('Recette personnelle');
		expect(provenanceLine({ variant: 'grand-mere' })).toBe('Grand mere');
		expect(provenanceLine({})).toBe('');
	});
	it('sets apart the name that tells two same titles apart: the person, else the source’s title', () => {
		expect(provenanceParts({ author: 'Tante Aline', source_type: 'family' })).toEqual({ lead: 'de ', name: 'Tante Aline', rest: '' });
		expect(provenanceParts({ source_type: 'book', source_title: 'Le Tablier inventé', source_page: '3' })).toEqual({
			lead: 'Tiré du ',
			name: 'Tablier inventé',
			rest: ', p.\u00a03'
		});
		expect(provenanceParts({ source_type: 'family' })).toEqual({ lead: '', name: '', rest: 'Recette personnelle' });
	});
});
