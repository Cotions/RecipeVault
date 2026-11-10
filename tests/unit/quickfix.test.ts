import { describe, expect, it } from 'vitest';
import { checkFile } from '../../src/lib/vault/check';
import { durationFix, entryFix, isPlainLine, methodFix, nameQtyFix, prepFix, resemblesSlugs, schemaFix, sourceTypeFixes, splitAll, splitQtyFix, stepsFix, titleFix, titleGuess, yamlTrouble } from '../../src/lib/vault/quickfix';
import { parseWordList } from '../../src/lib/vault/words';
import { resolutionDiagnostics } from '../../src/lib/ingredients/resolve';

// Invented fixtures.
const file = (fm: string, body = '## Préparation\n\n1. Mélanger.\n') => `---\n${fm}---\n\n${body}`;
const codes = (t: string) => checkFile(t).diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);

const ITEMS = `schema: 3
title: Galette inventée
ingredients:
  - items:
      - { qty: 1, unit: cup, name: farine }
XX- { qty: 2, unit: tbsp, name: sucre }
      - { qty: 3, unit: tsp, name: sel }
`;

describe('yamlTrouble (E002)', () => {
	it('is null when the frontmatter reads', () => {
		expect(yamlTrouble(file('schema: 3\ntitle: Pain\n'))).toBeNull();
	});

	it('points at the list item one space too far, and realigns it', () => {
		const t = file(ITEMS.replace('XX', '       '));
		expect(codes(t)).toEqual(['E002']);
		const tr = yamlTrouble(t)!;
		expect(tr.line).toBe(6);
		expect(tr.text.trim()).toBe('- { qty: 2, unit: tbsp, name: sucre }');
		expect(tr.before?.trim()).toBe('- { qty: 1, unit: cup, name: farine }');
		expect(t.slice(tr.span.start, tr.span.end)).toBe('- { qty: 2, unit: tbsp, name: sucre }');
		expect(tr.realign).toMatchObject({ line: 6, from: 7, to: 6 });
		expect(codes(tr.realign!.fix.result)).toEqual([]);
	});

	it('realigns a list item one space short', () => {
		const t = file(ITEMS.replace('XX', '     '));
		const tr = yamlTrouble(t)!;
		expect(tr.realign).toMatchObject({ line: 6, from: 5, to: 6 });
		expect(codes(tr.realign!.fix.result)).toEqual([]);
	});

	it('realigns a key under its siblings, even when the parser points at the line before', () => {
		const t = file(`schema: 3
title: Galette inventée
ingredients:
  - items:
      - qty: 1
        unit: cup
         name: farine
`);
		const tr = yamlTrouble(t)!;
		expect(tr.realign).toMatchObject({ line: 7, from: 9, to: 8 });
		expect(tr.text.trim()).toBe('name: farine');
		expect(codes(tr.realign!.fix.result)).toEqual([]);
	});

	it('offers no realignment for a quoting mistake', () => {
		const t = file('schema: 3\ntitle: Pain\nnote: "ouvert\nservings: 4\n');
		const tr = yamlTrouble(t);
		expect(tr).not.toBeNull();
		expect(tr!.realign).toBeUndefined();
	});
});

describe('schemaFix (E110)', () => {
	it('adds the version as the first line', () => {
		const t = file('title: Pain\ningredients:\n  - items:\n      - { name: sel }\n');
		expect(codes(t)).toContain('E110');
		const fix = schemaFix(t)!;
		expect(fix.result.startsWith('---\nschema: 3\ntitle: Pain\n')).toBe(true);
		expect(codes(fix.result)).not.toContain('E110');
	});

	it('never replaces a version it does not know', () => {
		expect(schemaFix(file('schema: 2\ntitle: Pain\ningredients:\n  - items:\n      - { name: sel }\n'))).toBeNull();
	});
});

describe('titleFix (E101)', () => {
	const t = file('schema: 3\ningredients:\n  - items:\n      - { name: sel }\n', '# Pain de ménage\n\n## Préparation\n\n1. Cuire.\n');

	it('writes the title after schema, quoted when needed', () => {
		const fix = titleFix(t, 'Pain: le vrai')!;
		expect(fix.result).toContain('schema: 3\ntitle: "Pain: le vrai"\n');
		expect(codes(fix.result)).not.toContain('E101');
	});

	it('fills an empty title line', () => {
		const fix = titleFix(t.replace('schema: 3\n', 'schema: 3\ntitle:\n'), 'Pain')!;
		expect(fix.result).toContain('schema: 3\ntitle: Pain\ningredients');
	});

	it('guesses from the first heading that is not a section', () => {
		expect(titleGuess(t)).toBe('Pain de ménage');
		expect(titleGuess(file('schema: 3\n', '## Préparation\n\n1. Cuire.\n'))).toBe('');
	});

	it('writes nothing empty', () => {
		expect(titleFix(t, '  ')).toBeNull();
	});
});

describe('nameQtyFix (E210) and splitAll', () => {
	const fm = (item: string) => file(`schema: 3\ntitle: Pain\ningredients:\n  - items:\n${item}`);

	it('takes the amount out of a flow entry name', () => {
		const t = fm('      - { name: 500 ml de lait }\n');
		expect(codes(t)).toContain('E210');
		const r = nameQtyFix(t, 'ingredients[0].items[0].name', 'fr')!;
		expect(r).toMatchObject({ qty: '500', unit: 'ml', name: 'lait' });
		expect(r.fix.result).toContain('{ qty: 500, unit: ml, name: lait }');
		expect(codes(r.fix.result)).toEqual([]);
	});

	it('takes it out of a block entry, and keeps a review marker', () => {
		const t = fm('      - name: "beurre : 2 c. à table [?]"\n');
		const r = nameQtyFix(t, 'ingredients[0].items[0].name', 'fr')!;
		expect(r.unit).toBe('tbsp');
		expect(r.fix.result).toMatch(/qty: 2\n\s+unit: tbsp\n\s+name: "?beurre \[\?\]"?/);
	});

	it('leaves a name with an amount already beside it, or none in it', () => {
		expect(nameQtyFix(fm('      - { qty: 1, unit: cup, name: farine }\n'), 'ingredients[0].items[0].name', 'fr')).toBeNull();
		expect(nameQtyFix(fm('      - { qty: 1, name: oignon }\n'), 'ingredients[0].items[0].name', 'fr')).toBeNull();
	});

	it('splitAll settles every E204 and E210 it can, and nothing else', () => {
		const t = fm('      - { name: 500 ml de lait }\n      - { qty: 1 1/2 tasse, name: farine }\n      - { qty: 1, unit: cup, name: sucre }\n');
		const out = splitAll(t, 'fr');
		expect(codes(out)).toEqual([]);
		expect(out).toContain('{ qty: 1, unit: cup, name: sucre }');
	});
});

describe('splitQtyFix (E204)', () => {
	const fm = (item: string) => file(`schema: 3\ntitle: Pain\ningredients:\n  - items:\n${item}`);

	it('splits a flow entry', () => {
		const t = fm('      - { qty: 1 1/2 tasse, name: farine }\n');
		const r = splitQtyFix(t, 'ingredients[0].items[0].qty', 'fr')!;
		expect(r).toMatchObject({ qty: '"1 1/2"', unit: 'cup' });
		expect(r.fix.result).toContain('{ qty: "1 1/2", unit: cup, name: farine }');
		expect(codes(r.fix.result)).toEqual([]);
	});

	it('splits a block entry, the unit under the qty', () => {
		const t = fm('      - qty: 2 c. à thé\n        name: sel\n');
		const r = splitQtyFix(t, 'ingredients[0].items[0].qty', 'fr')!;
		expect(r.unit).toBe('tsp');
		expect(r.fix.result).toContain('      - qty: 2\n        unit: tsp\n        name: sel\n');
		expect(codes(r.fix.result)).toEqual([]);
	});

	it('leaves a line with another unit, or words that are no unit', () => {
		expect(splitQtyFix(fm('      - { qty: 1 1/2 tasse, unit: tbsp, name: farine }\n'), 'ingredients[0].items[0].qty', 'fr')).toBeNull();
		expect(splitQtyFix(fm('      - { qty: 1 gros, name: oignon }\n'), 'ingredients[0].items[0].qty', 'fr')).toBeNull();
	});
});

describe('methodFix (W401)', () => {
	it('puts bare step lines under Préparation', () => {
		const t = file('schema: 3\ntitle: Pain\ningredients:\n  - items:\n      - { name: sel }\n', '- Mélanger.\n- Cuire.\n');
		expect(checkFile(t).diagnostics.map((d) => d.code)).toContain('W401');
		const r = methodFix(t, 'fr')!;
		expect(r.steps).toBe(2);
		expect(r.fix.result).toContain('\n## Préparation\n\n- Mélanger.');
		expect(checkFile(r.fix.result).body?.steps.length).toBe(2);
	});

	it('puts steps under Préparation when the only heading is the title again (E301)', () => {
		const t = file('schema: 3\ntitle: Pain\ningredients:\n  - items:\n      - { name: sel }\n', '# Pain\n\n1. Mélanger.\n2. Cuire.\n');
		expect(codes(t)).toContain('E301');
		const r = methodFix(t, 'fr')!;
		expect(r.steps).toBe(2);
		expect(codes(r.fix.result)).toEqual([]);
	});

	it('offers nothing for prose', () => {
		expect(methodFix(file('schema: 3\ntitle: Pain\ningredients:\n  - items:\n      - { name: sel }\n', 'Mélanger et cuire.\n'), 'fr')).toBeNull();
	});
});

describe('stepsFix (W401 / W403: step-like lines, none read)', () => {
	const fm = 'schema: 3\ntitle: Pain inventé\ningredients:\n  - items:\n      - { name: sel }\n';
	const steps = (t: string) => checkFile(t).body?.steps.map((s) => s.text);

	it('writes « Étape 1 : », « 1 - » and « 1.Mot » lines as steps, under Préparation', () => {
		for (const body of ['Étape 1 : Mélanger.\nÉtape 2 : Cuire.\n', '1 - Mélanger.\n2 - Cuire.\n', '1.Mélanger.\n2.Cuire.\n']) {
			const t = file(fm, body);
			expect(checkFile(t).diagnostics.map((d) => d.code)).toContain('W401');
			const r = stepsFix(t, 'fr')!;
			expect(r.steps).toBe(2);
			expect(r.first.text).toBe(body.split('\n')[0]);
			expect(steps(r.fix.result)).toEqual(['Mélanger.', 'Cuire.']);
			expect(checkFile(r.fix.result).diagnostics.map((d) => d.code)).not.toContain('W401');
		}
	});

	it('takes a list indented 4 spaces (read as code) back to the margin, with or without a heading', () => {
		const under = file(fm, '## Préparation\n\n    1. Mélanger.\n    2. Cuire.\n');
		expect(checkFile(under).diagnostics.map((d) => d.code)).toContain('W403');
		expect(steps(stepsFix(under, 'fr')!.fix.result)).toEqual(['Mélanger.', 'Cuire.']);
		const bare = file(fm, '    - Mélanger.\n    - Cuire.\n');
		const r = stepsFix(bare, 'fr')!;
		expect(r.fix.result).toContain('## Préparation\n\n1. Mélanger.\n2. Cuire.');
		expect(r.first.line).toBe(bare.split('\n').indexOf('    - Mélanger.'));
	});

	it('offers nothing for prose, numbers out of order, steps already read, or bare list lines (methodFix)', () => {
		expect(stepsFix(file(fm, 'Mélanger.\n\nCuire.\n'), 'fr')).toBeNull();
		expect(stepsFix(file(fm, '1 - Mélanger.\n3 - Cuire.\n'), 'fr')).toBeNull();
		expect(stepsFix(file(fm), 'fr')).toBeNull();
		expect(stepsFix(file(fm, '1. Mélanger.\n2. Cuire.\n'), 'fr')).toBeNull();
	});
});

describe('entryFix (E207: a line left whole)', () => {
	const fm = (items: string) => `schema: 3\ntitle: Pain inventé\ningredients:\n  - items:\n      - { qty: 1, unit: cup, name: farine }\n${items}`;

	it('reads the line as « Coller une liste » does and writes it as an entry', () => {
		const t = file(fm('      - 1 1/2 tasse de lait\n'));
		expect(codes(t)).toEqual(['E207']);
		expect(isPlainLine(t, 'ingredients[0].items[1]')).toBe(true);
		const r = entryFix(t, ['ingredients[0].items[1]'], 'fr')!;
		expect(r.items[0]).toMatchObject({ name: 'lait', unit: 'cup', qty: { raw: '1 1/2' } });
		expect(r.fix.result).toContain('      - { qty: "1 1/2", unit: cup, name: lait }\n');
		expect(codes(r.fix.result)).toEqual([]);
	});

	it('fixes several lines at once, « au goût » kept', () => {
		const t = file(fm('      - 2 oeufs\n      - sel, au goût\n'));
		const r = entryFix(t, ['ingredients[0].items[1]', 'ingredients[0].items[2]'], 'fr')!;
		expect(r.fix.result).toContain('- { qty: 2, unit: piece, name: oeufs }\n      - { name: sel, to_taste: true }\n');
		expect(codes(r.fix.result)).toEqual([]);
	});

	it('offers nothing for a line the reader cannot read whole, a map entry, or when one of several cannot be read', () => {
		const t = file(fm('      - 3 à 2 tasses de lait\n      - 1 tasse de lait\n'));
		expect(entryFix(t, ['ingredients[0].items[1]'], 'fr')).toBeNull();
		expect(entryFix(t, ['ingredients[0].items[1]', 'ingredients[0].items[2]'], 'fr')).toBeNull();
		expect(entryFix(t, ['ingredients[0].items[2]'], 'fr')).not.toBeNull();
		expect(entryFix(t, ['ingredients[0].items[0]'], 'fr')).toBeNull();
		expect(isPlainLine(t, 'ingredients[0].items[0]')).toBe(false);
	});
});

describe('resemblesSlugs (W305)', () => {
	it('reads the slugs the resolver names', () => {
		const resolver = {
			resolve: () => ({ resolution: 'none', key: 'huile vegetal' }),
			candidates: () => [{ slug: 'huile-vegetale', score: 0.8 }],
			has: () => true
		};
		const [d] = resolutionDiagnostics({ lang: 'fr', ingredients: [{ items: [{ name: 'huile végétal' }] }] } as never, resolver as never);
		expect(d.code).toBe('W305');
		expect(resemblesSlugs(d)).toEqual(['huile-vegetale']);
	});
});

describe('prepFix (W302)', () => {
	const words = { participles: parseWordList({ words: ['fondu', 'haché', 'en dés'] })! };
	const fm = (items: string) => `schema: 3\ntitle: Gâteau inventé\nsource: { type: invented }\ningredients:\n  - items:\n${items}`;
	const w302 = (t: string) => checkFile(t, { words }).diagnostics.filter((d) => d.code === 'W302');

	it('moves the word to prep, in a flow entry', () => {
		const t = file(fm('      - { qty: 2, unit: tbsp, name: beurre fondu }\n'));
		const r = prepFix(t, 'ingredients[0].items[0].name', words)!;
		expect(r).toMatchObject({ name: 'beurre', prep: 'fondu' });
		expect(r.fix.result).toContain('- { qty: 2, unit: tbsp, name: beurre, prep: fondu }');
		expect(w302(r.fix.result)).toEqual([]);
	});

	it('adds before a prep already there, in a block entry', () => {
		const t = file(fm('      - qty: 1\n        unit: piece\n        name: oignon haché\n        prep: finement\n'));
		const r = prepFix(t, 'ingredients[0].items[0].name', words)!;
		expect(r.fix.result).toContain('        name: oignon\n        prep: "haché, finement"\n');
	});

	it('offers nothing without the word lists, on another path, or on a whole-word name', () => {
		const t = file(fm('      - { qty: 2, unit: tbsp, name: beurre fondu }\n'));
		expect(prepFix(t, 'ingredients[0].items[0].name', undefined)).toBeNull();
		expect(prepFix(t, 'ingredients[0].items[0].qty', words)).toBeNull();
		expect(prepFix(file(fm('      - { qty: 2, unit: tbsp, name: fondu }\n')), 'ingredients[0].items[0].name', words)).toBeNull();
	});
});

describe('sourceTypeFixes (E106)', () => {
	const base = (type: string) => file(`schema: 3\ntitle: Galette inventée\nsource:\n  type: ${type}\n  author: Tante Inventée\ningredients:\n  - items:\n      - { qty: 1, unit: cup, name: farine }\n`);

	it('offers one fix per allowed type, the code written in place', () => {
		const t = base('card');
		expect(codes(t)).toEqual(['E106']);
		const fixes = sourceTypeFixes(t, 'source.type');
		expect(fixes.map((f) => f.type)).toEqual(['family', 'book', 'website', 'magazine', 'tv', 'invented']);
		const family = fixes[0].fix.result;
		expect(family).toContain('  type: family\n  author: Tante Inventée');
		expect(codes(family)).toEqual([]);
	});

	it('works in a flow mapping too', () => {
		const t = file('schema: 3\ntitle: Galette inventée\nsource: { type: personal, author: Tante Inventée }\ningredients:\n  - items:\n      - { qty: 1, unit: cup, name: farine }\n');
		const book = sourceTypeFixes(t, 'source.type').find((f) => f.type === 'book')!;
		expect(book.fix.result).toContain('source: { type: book, author: Tante Inventée }');
	});

	it('offers nothing for another path, or a source that is not a mapping', () => {
		expect(sourceTypeFixes(base('card'), 'source')).toEqual([]);
		const t = file('schema: 3\ntitle: Galette inventée\nsource: carte de Tante Inventée\ningredients:\n  - items:\n      - { qty: 1, unit: cup, name: farine }\n');
		expect(sourceTypeFixes(t, 'source.type')).toEqual([]);
	});
});

describe('durationFix (E109)', () => {
	const base = (times: string) => file(`schema: 3\ntitle: Galette inventée\ntimes:\n${times}ingredients:\n  - items:\n      - { qty: 1, unit: cup, name: farine }\n`);

	it('writes « 40 min » as 40m, only that time', () => {
		const t = base('  prep: 15 min\n  cook: 40 min\n');
		expect(codes(t)).toEqual(['E109', 'E109']);
		const r = durationFix(t, 'times.cook')!;
		expect(r.value).toBe('40m');
		expect(r.fix.result).toContain('  prep: 15 min\n  cook: 40m\n');
		expect(codes(r.fix.result)).toEqual(['E109']);
	});

	it('reads hours and minutes, and ranges', () => {
		expect(durationFix(base('  cook: 1 h 15\n'), 'times.cook')?.value).toBe('1h15m');
		expect(durationFix(base('  cook: 2 heures\n'), 'times.cook')?.value).toBe('2h');
		expect(durationFix(base('  cook: 45-50 minutes\n'), 'times.cook')?.value).toBe('45m-50m');
	});

	it('guesses nothing: a bare number, words after the time, a time already in the format', () => {
		expect(durationFix(base('  cook: 1.5\n'), 'times.cook')).toBeNull();
		expect(durationFix(base('  rest: 2 h de réfrigération\n'), 'times.rest')).toBeNull();
		expect(durationFix(base('  cook: 40m\n'), 'times.cook')).toBeNull();
		expect(durationFix(base('  cook: 40 min\n'), 'source.type')).toBeNull();
	});
});
