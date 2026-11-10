// « Coller une liste » (plan 04, UI pass 2): the line reader the form shares
// with the web import, the list readers behind the paste box, the rows they
// fill, and the save bar's short sentence.

import { describe, expect, it } from 'vitest';
import { parseIngredientLine as webLine } from '../../../src/lib/server/webimport';
import { parseIngredientLine, parseIngredientList, parseStepList } from '../../../src/lib/form/lineparse';
import { emptyForm, newItem, type StepRow } from '../../../src/lib/form/model';
import { addStepRow, blankItem, blocks, fillItems, fillSteps } from '../../../src/lib/form/rows';
import { reasonGroups, reasonShort } from '../../../src/lib/components/form/formui';

describe('the line reader', () => {
	it('reads a line as the web import does', () => {
		for (const [line, lang] of [
			['2 tasses de farine tamisée', 'fr'],
			['1 ½ tasse de cassonade', 'fr'],
			['3 oignons, hachés', 'fr'],
			['1 boîte de tomates (796 ml)', 'fr'],
			['1 tasse (250 ml) de lait', 'fr'],
			['2-3 c. à table de beurre', 'fr'],
			['sel et poivre', 'fr'],
			['2 tbsp butter, melted', 'en'],
			['2 cuillerées de beurre', 'fr'],
			['2 boîtes de 398 ml de sauce tomate, égouttées', 'fr'],
			['1 branche de céleri, hachée', 'fr'],
			['1 c. à dessert de sucre', 'fr']
		] as const)
			expect(parseIngredientLine(line, lang), line).toEqual(webLine(line, lang));
	});
});

describe('a pasted ingredient list', () => {
	it('one ingredient per line, bullets dropped, headings start groups', () => {
		const list = parseIngredientList('- 2 tasses de farine\n• 1 c. à thé de sel\n\nGarniture :\n3 pommes, tranchées\n## Dessus\n1 tasse de sucre\n', 'fr');
		expect(list.map((g) => [g.name, g.items.length])).toEqual([
			[undefined, 2],
			['Garniture', 1],
			['Dessus', 1]
		]);
		expect(list[0].items[0]).toMatchObject({ read: true, item: { qty: { value: 2 }, unit: 'cup', name: 'farine' } });
		expect(list[0].items[1].item).toMatchObject({ unit: 'tsp', name: 'sel' });
		expect(list[1].items[0].item).toMatchObject({ unit: 'piece', name: 'pommes', prep: 'tranchées' });
	});

	it('« au goût » is to taste; a line it cannot read is the whole name, never a [?]', () => {
		const [g] = parseIngredientList('poivre, au goût\n2 cuillerées de beurre', 'fr');
		expect(g.items[0]).toMatchObject({ read: true, item: { name: 'poivre', toTaste: true } });
		expect(g.items[0].item.prep).toBeUndefined();
		expect(g.items[1]).toEqual({ line: '2 cuillerées de beurre', item: { name: '2 cuillerées de beurre' }, read: false });
	});

	it('a line with a quantity and a colon is an ingredient, not a heading; nothing pasted is nothing', () => {
		expect(parseIngredientList('2 tasses : farine', 'fr')[0].name).toBeUndefined();
		expect(parseIngredientList(' \n\n', 'fr')).toEqual([]);
	});
});

describe('pasted steps', () => {
	it('numbered: the lines between join the step above', () => {
		expect(parseStepList('1. Mélanger la farine\net le sel.\n2) Cuire 20 min.\n')).toEqual([
			{ type: 'step', text: 'Mélanger la farine et le sel.' },
			{ type: 'step', text: 'Cuire 20 min.' }
		]);
	});

	it('blank lines between paragraphs make the steps; a short line ending in « : » is a section title', () => {
		expect(parseStepList('Pâte :\n\nMélanger la farine\net le beurre.\n\nAbaisser.')).toEqual([
			{ type: 'heading', text: 'Pâte' },
			{ type: 'step', text: 'Mélanger la farine et le beurre.' },
			{ type: 'step', text: 'Abaisser.' }
		]);
	});

	it('else one line is one step, a trailing blank line changing nothing', () => {
		expect(parseStepList('Mélanger.\nCuire.\n\n')).toEqual([
			{ type: 'step', text: 'Mélanger.' },
			{ type: 'step', text: 'Cuire.' }
		]);
		expect(parseStepList('')).toEqual([]);
	});
});

describe('the rows a list fills', () => {
	it('takes out the empty rows and adds the listed ones; a heading names an empty first group', () => {
		const form = emptyForm();
		expect(blankItem(form.groups[0].items[0])).toBe(true);
		const added = fillItems(form, 0, parseIngredientList('Pâte :\n2 tasses de farine\nGarniture :\n3 pommes', 'fr'), 'fr');
		expect(added.map((it) => it.name)).toEqual(['farine', 'pommes']);
		expect(form.groups.map((g) => [g.name, g.items.map((it) => it.name)])).toEqual([
			['Pâte', ['farine']],
			['Garniture', ['pommes']]
		]);
		expect(added[0]).toMatchObject({ qty: '2', unit: 'cup' });
	});

	it('keeps what she typed; a heading after her rows starts a new group after hers', () => {
		const form = emptyForm();
		Object.assign(form.groups[0].items[0], { qty: '1', unit: 'cup', name: 'lait' });
		form.groups[0].items.push(newItem());
		fillItems(form, 0, parseIngredientList('1 c. à thé de sel\nSauce :\n2 tasses de bouillon', 'fr'), 'fr');
		expect(form.groups.map((g) => [g.name, g.items.map((it) => it.name)])).toEqual([
			['', ['lait', 'sel']],
			['Sauce', ['bouillon']]
		]);
	});

	it('an unread line goes whole into a name, where the form still asks for a fix', () => {
		const form = emptyForm();
		form.title = 'Essai';
		fillItems(form, 0, parseIngredientList('3 gousses d’ail hachées 500 g', 'fr'), 'fr');
		expect(form.groups[0].items[0].name).toBe('3 gousses d’ail hachées 500 g');
		expect(blocks(form).length).toBeGreaterThan(0);
	});

	it('steps go after hers, the empty ones taken out', () => {
		const rows: StepRow[] = [];
		addStepRow(rows).text = 'Un.';
		addStepRow(rows);
		const added = fillSteps(rows, parseStepList('Deux.\nTrois.'));
		expect(added).toHaveLength(2);
		expect(rows.map((r) => r.text)).toEqual(['Un.', 'Deux.', 'Trois.']);
	});
});

describe('the save bar’s sentence', () => {
	it('says what is missing apart from what is to fix, each once', () => {
		expect(reasonShort({ reason: 'required', field: 'title' })).toEqual({ missing: true, text: 'un titre' });
		expect(reasonShort({ reason: 'marker', field: 'title' })).toEqual({ missing: false, text: 'des crochets dans un texte' });
		expect(reasonShort({ reason: 'checker', field: 'recipe', code: 'E213' }).missing).toBe(false);
		const said = reasonGroups([
			{ block: { reason: 'required' as const, field: 'title' } },
			{ block: { reason: 'nameComma' as const, field: 'name' } },
			{ block: { reason: 'nameComma' as const, field: 'name' } }
		]);
		expect(said.missing.map((r) => r.text)).toEqual(['un titre']);
		expect(said.fix.map((r) => r.text)).toEqual(['un nom d’ingrédient avec une virgule']);
	});
});

describe('a whole line typed in a row’s name (usability round 3)', () => {
	it('reads the amount at its start with the paste reader, nothing guessed', async () => {
		const { nameSplit } = await import('../../../src/lib/form/lineparse');
		expect(nameSplit('1 pincée de sel', 'fr')).toMatchObject({ qty: { value: 1 }, unit: 'pinch', name: 'sel' });
		expect(nameSplit('3 pommes de terre', 'fr')).toMatchObject({ qty: { value: 3 }, unit: 'piece', name: 'pommes de terre' });
		expect(nameSplit('½ tasse de lait, tiède', 'fr')).toMatchObject({ unit: 'cup', name: 'lait', prep: 'tiède' });
		for (const name of ['sel', '1 pincée', '2', 'farine 2 tasses']) expect(nameSplit(name, 'fr')).toBeUndefined();
	});

	it('[Séparer] fills the amount and keeps the rest as the name', async () => {
		const { nameSplit } = await import('../../../src/lib/form/lineparse');
		const { applyNameSplit } = await import('../../../src/lib/form/rows');
		const it = newItem();
		it.name = '1 ½ tasse de lait, tiède';
		applyNameSplit(it, nameSplit(it.name, 'fr')!, 'fr');
		expect([it.qty, it.unit, it.name, it.prep]).toEqual(['1 ½', 'cup', 'lait', 'tiède']);
		const f = emptyForm();
		f.title = 'x';
		f.groups[0].items = [it];
		expect(blocks(f).filter((b) => b.id === it.id)).toEqual([]);
	});
});
