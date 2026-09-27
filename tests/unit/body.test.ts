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
			{ number: 1, text: "Faire revenir l'oignon." },
			{ number: 2, text: "Ajouter l'ail, puis le boeuf. Laisser mijoter." },
			{ number: 1, text: 'Encore.' },
			{ number: 4, text: 'Fondre le beurre.', subheading: 'Béchamel' }
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
