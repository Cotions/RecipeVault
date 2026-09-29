// Field-level conversions of the form model: quantity input (Q7 A),
// durations, method rows (Q5 A), marker text (Q15 A).

import { describe, expect, it } from 'vitest';
import { durationToForm, formToDuration } from '../../../src/lib/form/duration';
import { confirmValue, hideMarkers, markedText, reapplyAdded } from '../../../src/lib/form/markers';
import { parseQuantityInput, showQuantity } from '../../../src/lib/form/quantity';
import { rowsFromText, textFromRows } from '../../../src/lib/form/steps';
import { parseBody } from '../../../src/lib/vault/body';
import { parseDuration } from '../../../src/lib/vault/duration';

describe('quantity input', () => {
	it.each([
		['2', 2],
		['1.5', 1.5],
		['0,5', 0.5],
		[',5', 0.5],
		['1/2', '1/2'],
		['1 1/2', '1 1/2'],
		['  1   1/2 ', '1 1/2'],
		['½', '1/2'],
		['1½', '1 1/2'],
		['1 ½', '1 1/2'],
		['2⅔', '2 2/3'],
		['1⁄4', '1/4'],
		['3/2', '3/2']
	])('%s → %j', (input, raw) => {
		const q = parseQuantityInput(input);
		expect(q.ok && q.raw).toStrictEqual(raw);
	});

	it.each([
		['', 'empty'],
		['0', 'zero'],
		['0/4', 'zero'],
		['1 3/2', 'fraction'],
		['1/0', 'format'],
		['deux', 'format'],
		['1-2', 'format'],
		['1,5,2', 'format'],
		['-1', 'format']
	])('%j refused (%s)', (input, reason) => {
		expect(parseQuantityInput(input)).toEqual({ ok: false, reason });
	});

	it.each([
		[0.5, 'fr', '0,5'],
		[0.5, 'en', '0.5'],
		[250, 'fr', '250'],
		['1 1/2', 'fr', '1 ½'],
		['2/3', 'fr', '⅔'],
		['3/16', 'fr', '3/16'],
		['250 [?]', 'fr', '250'],
		['1/4 [?: 1/2]', 'fr', '¼']
	] as const)('shows %j as %j', (raw, lang, shown) => {
		expect(showQuantity(raw, lang)).toBe(shown);
	});

	it('what it shows reads back as the same value', () => {
		for (const raw of [2, 0.5, 1.25, '1/2', '1 1/2', '2/3', '3/16', '7/8']) {
			const q = parseQuantityInput(showQuantity(raw, 'fr'));
			expect(q.ok && q.raw).toStrictEqual(raw);
		}
	});
});

describe('durations', () => {
	it.each([
		[{ hours: null, minutes: 30, maxHours: null, maxMinutes: null }, '30m'],
		[{ hours: 1, minutes: null, maxHours: null, maxMinutes: null }, '1h'],
		[{ hours: 1, minutes: 15, maxHours: null, maxMinutes: null }, '1h15m'],
		[{ hours: null, minutes: 90, maxHours: null, maxMinutes: null }, '1h30m'],
		[{ hours: null, minutes: 45, maxHours: null, maxMinutes: 50 }, '45m-50m'],
		[{ hours: 2, minutes: null, maxHours: 3, maxMinutes: null }, '2h-3h'],
		[{ hours: null, minutes: null, maxHours: null, maxMinutes: null }, undefined]
	])('%j → %s', (f, raw) => {
		expect(formToDuration(f)).toEqual({ ok: true, raw });
		if (raw) expect(durationToForm(parseDuration(raw))).toEqual({ ...f, ...(raw === '1h30m' ? { hours: 1, minutes: 30 } : {}) });
	});

	it.each([
		[{ hours: null, minutes: 50, maxHours: null, maxMinutes: 45 }, 'range'],
		[{ hours: null, minutes: 50, maxHours: null, maxMinutes: 50 }, 'range'],
		[{ hours: null, minutes: 1.5, maxHours: null, maxMinutes: null }, 'format'],
		[{ hours: -1, minutes: null, maxHours: null, maxMinutes: null }, 'format'],
		[{ hours: null, minutes: null, maxHours: 1, maxMinutes: null }, 'format']
	])('%j refused (%s)', (f, reason) => {
		expect(formToDuration(f)).toEqual({ ok: false, reason });
	});
});

const METHOD = `1. Préchauffer le four.
- Beurrer le moule,
  bien partout.
2) Garniture :
   - pommes
   - sucre
     et cannelle
   1. sous-point

### Pâte

1. Mélanger.

Laisser reposer si on a le temps.
Ou pas.

Une autre ligne de prose.

---

* Abaisser.`;

describe('method rows', () => {
	const rows = rowsFromText(METHOD);

	it('steps, sub-headings, prose and a break as rows, nested lists kept as lines', () => {
		expect(rows).toEqual([
			{ type: 'step', text: 'Préchauffer le four.' },
			{ type: 'step', text: 'Beurrer le moule, bien partout.' },
			{ type: 'step', text: 'Garniture :\n- pommes\n- sucre et cannelle\n1. sous-point' },
			{ type: 'heading', text: 'Pâte', level: 3 },
			{ type: 'step', text: 'Mélanger.' },
			{ type: 'text', text: 'Laisser reposer si on a le temps.\nOu pas.\n\nUne autre ligne de prose.\n\n---' },
			{ type: 'step', text: 'Abaisser.' }
		]);
	});

	it('the steps are the checker’s steps', () => {
		const steps = parseBody(`## Préparation\n\n${METHOD}`).body.steps.map((s) => s.text);
		expect(rows.filter((r) => r.type === 'step').map((r) => r.text.replace(/\n/g, ' '))).toEqual(steps);
	});

	it('written canonically, and read back as the same rows', () => {
		const text = textFromRows(rows);
		expect(text).toBe(`1. Préchauffer le four.
2. Beurrer le moule, bien partout.
3. Garniture :
   - pommes
   - sucre et cannelle
   1. sous-point

### Pâte

4. Mélanger.

Laisser reposer si on a le temps.
Ou pas.

Une autre ligne de prose.

---

5. Abaisser.`);
		expect(rowsFromText(text)).toEqual(rows);
	});

	it('prose that looks like a step or a heading stays prose; empty rows are dropped', () => {
		const text = textFromRows([
			{ type: 'step', text: 'Un.' },
			{ type: 'text', text: '- pas une étape\n# pas un titre\n2. non plus' },
			{ type: 'step', text: '  ' },
			{ type: 'heading', text: '', level: 3 },
			{ type: 'step', text: '\nDeux.\n' }
		]);
		expect(text).toBe('1. Un.\n\n\\- pas une étape\n\\# pas un titre\n2\\. non plus\n\n2. Deux.');
		expect(rowsFromText(text).map((r) => r.type)).toEqual(['step', 'text', 'step']);
	});

	it('a step numbered 10 and more keeps its nested lines in it', () => {
		const rows10 = Array.from({ length: 10 }, (_, i) => ({ type: 'step' as const, text: `Étape ${i + 1}` }));
		rows10[9].text = 'Dernière :\n- a\n- b';
		const text = textFromRows(rows10);
		expect(text.split('\n').slice(-3)).toEqual(['10. Dernière :', '    - a', '    - b']);
		expect(parseBody(`## Préparation\n\n${text}`).body.steps).toHaveLength(10);
	});
});

describe('marker text', () => {
	it.each([
		['farine [?]', 'farine'],
		['[?] farine', 'farine'],
		['30 minutes [+] en brassant', '30 minutes en brassant'],
		['un moule [illisible].', 'un moule.'],
		['sucre [?: sel] [+] fin', 'sucre fin'],
		['Mélanger. [+]\nCuire [?].', 'Mélanger.\nCuire.'],
		['  - indenté [?]', '  - indenté'],
		['[[pate-brisee]] et [lien](x)', '[[pate-brisee]] et [lien](x)']
	])('%j shows as %j', (raw, shown) => {
		expect(hideMarkers(raw)).toBe(shown);
	});

	it('marks point at the text they apply to', () => {
		const m = markedText('Ajouter le curcuma [?: cumin]. Brasser. [+]');
		expect(m.text).toBe('Ajouter le curcuma. Brasser.');
		expect(m.marks.map((k) => [k.kind, m.text.slice(k.start, k.end), k.alternative])).toEqual([
			['uncertain-alt', 'curcuma', 'cumin'],
			['added', 'Brasser.', undefined]
		]);
	});

	it.each([
		['farine [?]', 'farine'],
		['250 [?]', '250'],
		['farine [?] [+]', 'farine [+]'],
		['Cuire [illisible] longtemps. [+]', 'Cuire longtemps. [+]'],
		['sans marqueur', 'sans marqueur']
	])('confirm %j → %j', (raw, out) => {
		expect(confirmValue(raw)).toBe(out);
	});

	it.each([
		['Brasser. [+]', 'Brasser. Servir.', 'Brasser. [+] Servir.'],
		['Brasser. [+]', 'Brasser doucement.', 'Brasser doucement.'],
		['Cuire. Brasser. [+]', 'Cuire vite. Brasser.', 'Cuire vite. Brasser. [+]'],
		['sel [?] et poivre [+]', 'sel et poivre noir', 'sel et poivre [+] noir'],
		['soda crackers [+].', 'soda crackers.', 'soda crackers [+].']
	])('edit of %j to %j writes %j', (raw, text, out) => {
		expect(reapplyAdded(text, raw)).toBe(out);
	});
});
