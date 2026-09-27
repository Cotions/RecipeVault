import { describe, expect, it } from 'vitest';
import { isSlug, slugify } from '../../src/lib/vault/slug';

describe('slugify', () => {
	it.each([
		['Pâté chinois', 'pate-chinois'],
		['Bœuf aux légumes', 'boeuf-aux-legumes'],
		['Crème brûlée', 'creme-brulee'],
		["Pâte d'amande", 'pate-d-amande'],
		['Pâte d’amande', 'pate-d-amande'],
		['Bouchées au canard [+]', 'bouchees-au-canard'],
		['Tarte [?: Tourte] aux pommes', 'tarte-aux-pommes'],
		['  Galettes -- à la  mélasse!  ', 'galettes-a-la-melasse'],
		['Æbleskiver', 'aebleskiver'],
		['[illisible]', '']
	])('%s → %s', (title, slug) => {
		expect(slugify(title)).toBe(slug);
	});

	it('treats precomposed and combining accents alike', () => {
		expect(slugify('Cre\u0301me')).toBe(slugify('Cr\u00e9me'));
	});
});

describe('isSlug', () => {
	it.each(['pate-chinois', 'a', 'tarte-2'])('accepts %s', (s) => expect(isSlug(s)).toBe(true));
	it.each(['Pate', 'pâte', 'pate_chinois', '-pate', 'pate-', 'pate--chinois', '', 3])('rejects %j', (s) =>
		expect(isSlug(s)).toBe(false)
	);
});
