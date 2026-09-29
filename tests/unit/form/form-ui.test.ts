// The form components' pure helpers (P2 review fixes): "Autre lecture" in
// place, the draft's family label and W608 pair, Enter never saving, and a
// duration box that never shows "NaN". All content invented.

import { describe, expect, it } from 'vitest';
import { emptyForm, markedText } from '../../../src/lib/form';
import { blocksImplicitSubmit, draftDiffers, durationText, packDraft, unpackDraft, withAlternative } from '../../../src/lib/components/form/formui';

describe('withAlternative', () => {
	it('replaces only the marked span, keeping the rest of the field', () => {
		const { text, marks } = markedText('Tarte au sucre [?: sirop]');
		expect(withAlternative(text, marks[0])).toBe('Tarte au sirop');
		const c = markedText('cassonade pâle [?: foncée]');
		expect(withAlternative(c.text, c.marks[0])).toBe('cassonade foncée');
	});

	it('applies each of two identical other readings to its own span', () => {
		const { text, marks } = markedText('Ajouter 1 [?: 2] tasse de lait et 1 [?: 2] c. à thé de sel');
		const alts = marks.filter((m) => m.alternative !== undefined);
		expect(alts.map((m) => m.alternative)).toEqual(['2', '2']);
		expect(withAlternative(text, alts[0])).toBe('Ajouter 2 tasse de lait et 1 c. à thé de sel');
		expect(withAlternative(text, alts[1])).toBe('Ajouter 1 tasse de lait et 2 c. à thé de sel');
	});

	it('leaves the text alone for a mark with no other reading', () => {
		const { text, marks } = markedText('farine [?]');
		expect(withAlternative(text, marks[0])).toBe(text);
	});
});

describe('draft extras', () => {
	const pair = { slug: 'soupe-aux-pois', hash: 'abc', title: 'Soupe aux pois', variant: 'Maman' };

	it('keeps the new family label and the pair, and gives them back', () => {
		const form = emptyForm();
		const d = packDraft(form, { familyLabel: 'Pâté chinois', pair }, 1);
		const back = unpackDraft(JSON.parse(JSON.stringify(d)));
		expect(back).toEqual({ familyLabel: 'Pâté chinois', pair });
		expect(unpackDraft(packDraft(form, { familyLabel: '', pair: null }, 1))).toEqual({ familyLabel: '', pair: null });
	});

	it('a draft with only a label or a pair still differs from the opened form', () => {
		const form = emptyForm();
		expect(draftDiffers(packDraft(form, { familyLabel: '', pair: null }, 1), form)).toBe(false);
		expect(draftDiffers(packDraft(form, { familyLabel: 'Pâté chinois', pair: null }, 1), form)).toBe(true);
		expect(draftDiffers(packDraft(form, { familyLabel: '', pair }, 1), form)).toBe(true);
	});

	it('drops a malformed pair from the device', () => {
		const d = { ...packDraft(emptyForm(), { familyLabel: '', pair: null }, 1), pair: { slug: 3 } } as never;
		expect(unpackDraft(d).pair).toBeNull();
	});
});

describe('blocksImplicitSubmit', () => {
	it('stops Enter in one-line inputs only', () => {
		expect(blocksImplicitSubmit('Enter', { tagName: 'INPUT', type: 'text' })).toBe(true);
		expect(blocksImplicitSubmit('Enter', { tagName: 'INPUT', type: 'url' })).toBe(true);
		expect(blocksImplicitSubmit('Enter', { tagName: 'TEXTAREA' })).toBe(false);
		expect(blocksImplicitSubmit('Enter', { tagName: 'BUTTON', type: 'submit' })).toBe(false);
		expect(blocksImplicitSubmit('Enter', { tagName: 'INPUT', type: 'submit' })).toBe(false);
		expect(blocksImplicitSubmit('a', { tagName: 'INPUT', type: 'text' })).toBe(false);
	});
});

describe('durationText', () => {
	it('shows what she typed, never NaN', () => {
		expect(durationText(NaN, '1,5')).toBe('1,5');
		expect(durationText(NaN, undefined)).toBe('');
		expect(durationText(null, '')).toBe('');
		expect(durationText(20, '20')).toBe('20');
	});
});
