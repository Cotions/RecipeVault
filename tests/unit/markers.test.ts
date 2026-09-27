import { describe, expect, it } from 'vitest';
import { findBadMarkers, findMarkers, stripMarkers } from '../../src/lib/vault/markers';

describe('findMarkers', () => {
	it('finds all four kinds', () => {
		const m = findMarkers('boeuf [?] ou porc [?: veau], sel [illisible], étape [+]', 'x');
		expect(m.map((x) => x.kind)).toEqual(['uncertain', 'uncertain-alt', 'illegible', 'added']);
		expect(m[1].alternative).toBe('veau');
		expect(m.every((x) => x.path === 'x')).toBe(true);
	});

	it('finds none in plain text', () => {
		expect(findMarkers('boeuf haché', 'x')).toEqual([]);
	});
});

describe('stripMarkers', () => {
	it.each([
		['boeuf [?]', 'boeuf'],
		['250 [?]', '250'],
		['Bouchées au canard [+]', 'Bouchées au canard'],
		['sel [illisible], poivre', 'sel, poivre'],
		['Jeanne Tremblay [?: Tremblé]', 'Jeanne Tremblay']
	])('%s → %s', (a, b) => expect(stripMarkers(a)).toBe(b));
});

describe('findBadMarkers', () => {
	it.each([
		['farine [sic]', 'bracket'],
		['farine [illegible]', 'bracket'],
		['farine [Illisible]', 'bracket'],
		['farine [?:]', 'bracket'],
		['farine (lecture incertaine)', 'prose'],
		['nom incertain', 'prose'],
		['mot illisible ici', 'prose'],
		['2 tasses (?)', 'prose'],
		['3?) plus tard', 'prose']
	])('%s → %s', (s, kind) => {
		expect(findBadMarkers(s).map((b) => b.kind)).toContain(kind);
	});

	it.each([
		'boeuf [?] haché [?: moulu]',
		'[illisible] et [+]',
		'voir [[pate-brisee]]',
		'voir [la recette](https://example.com)',
		'- [ ] acheter du beurre',
		'une incertitude',
		'Pourquoi pas?'
	])('accepts %s', (s) => {
		expect(findBadMarkers(s)).toEqual([]);
	});
});
