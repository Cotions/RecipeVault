// The family picker (plan 04, Phase 5.1): "Nouvelle famille" only when no
// family is within the W502 distance; the variant pre-fill.

import { describe, expect, it } from 'vitest';
import { compareForms, emptyForm, familyChoices, variantFrom, type FamilyOption } from '../../../src/lib/form';

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
