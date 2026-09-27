import { describe, expect, it } from 'vitest';
import { parseBody } from '../../src/lib/vault/body';

const BODY = `Texte avant.

## Préparation

1. Faire revenir l'oignon.
2. Ajouter l'ail,
   puis le boeuf.

   Laisser mijoter.
1. Encore.

### Béchamel
4. Fondre le beurre.

Un paragraphe libre.

## Notes

Meilleur le lendemain.

## Autre chose

- un point
`;

describe('parseBody', () => {
	const { body, chunks } = parseBody(BODY);

	it('finds sections and their kinds', () => {
		expect(body.sections.map((s) => [s.kind, s.heading])).toEqual([
			['method', 'Préparation'],
			['notes', 'Notes'],
			['other', 'Autre chose']
		]);
		expect(body.preamble).toBe('Texte avant.');
	});

	it('collects numbered steps with continuations and sub-headings', () => {
		expect(body.steps).toEqual([
			{ number: 1, text: "Faire revenir l'oignon.", section: 0 },
			{ number: 2, text: "Ajouter l'ail, puis le boeuf. Laisser mijoter.", section: 0 },
			{ number: 1, text: 'Encore.', section: 0 },
			{ number: 4, text: 'Fondre le beurre.', subheading: 'Béchamel', section: 0 }
		]);
	});

	it('covers every line in exactly one chunk', () => {
		expect(chunks.map((c) => c.path)).toEqual([
			'body.preamble',
			'body.steps[0]',
			'body.steps[1]',
			'body.steps[2]',
			'body.steps[3]',
			'body.sections[0]',
			'body.sections[1]',
			'body.sections[2]'
		]);
		expect(chunks.find((c) => c.path === 'body.sections[0]')?.text).toBe('### Béchamel\nUn paragraphe libre.');
	});

	it('ignores headings inside code fences', () => {
		expect(parseBody('## Notes\n\n```\n## Préparation\n```\n').body.sections).toHaveLength(1);
	});

	it('opens a method section on a deep heading under an unrecognized one', () => {
		const { body } = parseBody('## Tarte\n\n### Préparation\n\n1. X\n\n### Glaçage\n\n1. Y\n');
		expect(body.sections.map((s) => s.kind)).toEqual(['other', 'method']);
		expect(body.steps.map((s) => s.subheading)).toEqual([undefined, 'Glaçage']);
	});

	it('opens a section on a deep heading when none is open yet', () => {
		expect(parseBody('### Préparation\n1. X\n').body.steps).toHaveLength(1);
	});
});

describe('bullet steps', () => {
	it('reads `-` and `*` lines in a method section as steps, with continuations', () => {
		const { body, chunks } = parseBody('## Préparation\n\n- Mélanger.\n* Verser dans le moule,\n  puis lisser.\n\n  Laisser reposer.\n- Cuire.\n');
		expect(body.steps).toEqual([
			{ text: 'Mélanger.', section: 0 },
			{ text: 'Verser dans le moule, puis lisser. Laisser reposer.', section: 0 },
			{ text: 'Cuire.', section: 0 }
		]);
		expect(chunks.map((c) => c.path)).toEqual(['body.steps[0]', 'body.steps[1]', 'body.steps[2]']);
	});

	it('mixes numbered and bullet lines in source order', () => {
		const { body } = parseBody('## Préparation\n\n1. Un.\n- Deux.\n\n### Glaçage\n* Trois.\n2. Quatre.\n');
		expect(body.steps.map((s) => [s.number, s.text, s.subheading])).toEqual([
			[1, 'Un.', undefined],
			[undefined, 'Deux.', undefined],
			[undefined, 'Trois.', 'Glaçage'],
			[2, 'Quatre.', 'Glaçage']
		]);
	});

	it('joins a list nested under a step to that step', () => {
		const { body } = parseBody('## Préparation\n\n1. Préparer la garniture :\n   - les pommes\n   - la cannelle\n2. Cuire.\n- Servir.\n  - tiède\n');
		expect(body.steps.map((s) => s.text)).toEqual(['Préparer la garniture : - les pommes - la cannelle', 'Cuire.', 'Servir. - tiède']);
	});

	it('leaves bullets outside a method section alone, and a `---` or `* * *` break is not a step', () => {
		const { body, chunks } = parseBody('## Préparation\n\n- Cuire.\n\n---\n\n* * *\n\n## Variantes\n\n- Avec des noix.\n');
		expect(body.steps.map((s) => s.text)).toEqual(['Cuire.']);
		expect(chunks.map((c) => c.path)).toEqual(['body.steps[0]', 'body.sections[0]', 'body.sections[1]']);
	});

	it('an emphasis line is not a bullet', () => {
		expect(parseBody('## Préparation\n\n*Au goût.*\n').body.steps).toEqual([]);
	});
});
