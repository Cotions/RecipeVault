// The family picker (plan 04, Phase 5.1): "Nouvelle famille" only when no
// family is within the W502 distance; the variant pre-fill.

import { describe, expect, it } from 'vitest';
import { compareForms, emptyForm, familyChoices, familyNameFromTitles, fromLabel, variantFrom, variantPrefill, variantShown, type FamilyOption } from '../../../src/lib/form';

const FAMILIES: FamilyOption[] = [
	{ slug: 'pouding-chomeur', label: 'Pouding chômeur', count: 3 },
	{ slug: 'lasagne', label: null, count: 2 },
	{ slug: 'tarte-au-sucre', label: 'Tarte au sucre', count: 5 }
];

describe('familyChoices', () => {
	it('an empty query lists the families, biggest first; nothing new offered', () => {
		const c = familyChoices(FAMILIES, '');
		expect(c.matches.map((m) => m.slug)).toEqual(['tarte-au-sucre', 'pouding-chomeur', 'lasagne']);
		expect(c.offerNew).toBeNull();
	});

	it('an exact name, by label or slug, accents and case aside', () => {
		expect(familyChoices(FAMILIES, 'pouding CHOMEUR').exact?.slug).toBe('pouding-chomeur');
		expect(familyChoices(FAMILIES, 'Lasagne').exact?.slug).toBe('lasagne');
		expect(familyChoices(FAMILIES, 'Lasagne').offerNew).toBeNull();
	});

	it('never offers a new family within two edits of one', () => {
		for (const q of ['Lasagnes', 'lasagna', 'Tarte au sucr', 'Pouding chomeurs']) {
			const c = familyChoices(FAMILIES, q);
			expect(c.offerNew, q).toBeNull();
			expect(c.matches.length, q).toBeGreaterThan(0);
		}
	});

	it('offers a new family, with its label as typed, when nothing is close', () => {
		const c = familyChoices(FAMILIES, 'Pâté chinois');
		expect(c.offerNew).toEqual({ slug: 'pate-chinois', label: 'Pâté chinois' });
		expect(c.matches).toEqual([]);
	});

	it('a part of a name finds it', () => {
		expect(familyChoices(FAMILIES, 'sucre').matches.map((m) => m.slug)).toContain('tarte-au-sucre');
	});
});

describe('variantFrom', () => {
	it('keeps the title words the family name lacks', () => {
		expect(variantFrom('Lasagne aux épinards', 'Lasagne')).toBe('aux épinards');
		expect(variantFrom('Pouding chômeur de grand-maman', 'Pouding chomeur')).toBe('de grand-maman');
		expect(variantFrom('Lasagne', 'Lasagne')).toBe('');
	});
});

describe('compareForms (Q18 A)', () => {
	it('lists only what differs, field by field', () => {
		const a = emptyForm();
		a.title = 'Soupe';
		Object.assign(a.groups[0].items[0], { qty: '1', unit: 'l', name: 'bouillon' });
		const b = structuredClone(a);
		expect(compareForms(a, b)).toEqual([]);
		b.title = 'Soupe du jour';
		b.groups[0].items[0].qty = '2';
		const rows = compareForms(a, b);
		expect(rows.map((r) => r.key)).toEqual(['title', 'ingredient']);
		expect(rows[1]).toMatchObject({ n: 1 });
		expect(rows[1].mine).toMatch(/^1 .*bouillon$/);
		expect(rows[1].theirs).toContain('2');
	});
});

describe('a family with no label is named from its titles', () => {
	it('takes the words of a title that make the slug, accents kept', () => {
		expect(familyNameFromTitles('pate-a-crepes', ['Ma pâte à crêpes, la meilleure', 'Autre'])).toBe('Pâte à crêpes');
		expect(familyNameFromTitles('galette', ['« galette » des rois'])).toBe('Galette');
	});
	it('null when no title holds it', () => {
		expect(familyNameFromTitles('chaudree', ['Soupe de poisson'])).toBeNull();
		expect(familyNameFromTitles('chaudree', [])).toBeNull();
	});
});

describe('variantShown / variantPrefill / fromLabel', () => {
	it('a variant written as the slug of who it is from (or part of the name) reads « de » + her name, capitals kept', () => {
		expect(variantShown('zoe-b', 'Zoé B.')).toBe('de Zoé B.');
		expect(variantShown('zoe', 'Zoé')).toBe('de Zoé');
		expect(variantShown('ines', 'Inès')).toBe('d’Inès');
		expect(variantShown('zoe', 'Tante Zoé')).toBe('de Tante Zoé');
		expect(variantShown('madame-inventee-d-a-cote', "Madame Inventée d'à côté")).toBe("de Madame Inventée d'à côté");
	});
	it('a typed variant as written; a slug as the kind of source, the title’s words, else its words', () => {
		expect(variantShown('aux épinards', 'Zoé B.')).toBe('aux épinards');
		expect(variantShown('avec aneth', { author: 'Tante Zoé' })).toBe('avec aneth');
		expect(variantShown('revue', { source_type: 'magazine' })).toBe('de la revue');
		expect(variantShown('livre', { source_type: 'book', source_title: 'Le Livre inventé' })).toBe('du livre');
		expect(variantShown('sirop-d-erable', { title: 'Fèves inventées au sirop d’érable' })).toBe('sirop d’érable');
		expect(variantShown('poires-amandes', { title: 'Tarte inventée poires et amandes' })).toBe('poires et amandes');
		expect(variantShown('zoe-b', null)).toBe('zoe b');
		expect(variantShown('zoe-b', 'Quelqu’un d’autre')).toBe('zoe b');
	});
	it('fromLabel: the author, else a published source’s title (article contracted), else the kind of source', () => {
		expect(fromLabel('Tante Zoé')).toBe('de Tante Zoé');
		expect(fromLabel('de Tante Zoé')).toBe('de Tante Zoé');
		expect(fromLabel({ source_type: 'book', source_title: 'Le Tablier inventé' })).toBe('du Tablier inventé');
		expect(fromLabel({ source_type: 'magazine', source_title: 'Les Recettes inventées' })).toBe('des Recettes inventées');
		expect(fromLabel({ source_type: 'magazine' })).toBe('de la revue');
		expect(fromLabel({ source_type: 'family' })).toBe('');
		expect(fromLabel(undefined)).toBe('');
	});
	it('where it is from when that tells it apart, else empty — never a fragment of the title', () => {
		expect(variantPrefill('Tante Zoé', ['Oncle Inventé', null])).toBe('de Tante Zoé');
		expect(variantPrefill('Tante Zoé', ['tante zoe'])).toBe('');
		expect(variantPrefill('de Tante Zoé', ['Tante Zoé'])).toBe('');
		expect(variantPrefill({ source_type: 'magazine' }, [{ author: 'Tante Zoé' }])).toBe('de la revue');
		expect(variantPrefill('', ['Oncle Inventé'])).toBe('');
		expect(variantPrefill(undefined)).toBe('');
	});
});
