import { describe, expect, it } from 'vitest';
import { locate, pathTokens, scalarAt, valueAt, yamlScalar } from '../../src/lib/vault/locate';
import { parseRecipe } from '../../src/lib/vault/parse';
import { checkFile } from '../../src/lib/vault/check';

// Invented recipe.
const FILE = `---
schema: 3
title: Galettes inventées
tags: [dessert, desertt]
ingredients:
  - group: Pâte
    items:
      - { qty: 1, unit: cup, name: farine }
      - { qty: 2, unit: tasse, name: eau }
  - items:
      - name: sel
        qty: 1
        unit: pincée
      - "500 g de lait"
---

Une introduction.

## Préparation

1. Mélanger la farine et l’eau.
2. Cuire 20 min.

## Notes

Rien.
`;

const at = (s: { start: number; end: number } | null) => (s ? FILE.slice(s.start, s.end) : null);
const parsed = parseRecipe(FILE);

describe('pathTokens', () => {
	it('splits a path, refuses a malformed one', () => {
		expect(pathTokens('ingredients[0].items[3].unit')).toEqual(['ingredients', 0, 'items', 3, 'unit']);
		expect(pathTokens('a..b[')).toBeUndefined();
		expect(pathTokens('')).toBeUndefined();
	});
});

describe('valueAt', () => {
	it('gives the scalar as written', () => {
		expect(valueAt(parsed.frontmatter, 'ingredients[0].items[1].unit')).toBe('tasse');
		expect(valueAt(parsed.frontmatter, 'ingredients[1].items[1]')).toBe('500 g de lait');
		expect(valueAt(parsed.frontmatter, 'tags[1]')).toBe('desertt');
		expect(valueAt(parsed.frontmatter, 'schema')).toBe('3');
	});
	it('gives nothing for a missing value, a map, a list or the body', () => {
		expect(valueAt(parsed.frontmatter, 'times')).toBeUndefined();
		expect(valueAt(parsed.frontmatter, 'ingredients[0]')).toBeUndefined();
		expect(valueAt(parsed.frontmatter, 'tags')).toBeUndefined();
		expect(valueAt(parsed.frontmatter, 'body.steps[0]')).toBeUndefined();
		expect(valueAt(parsed.frontmatter, null)).toBeUndefined();
	});
});

describe('locate', () => {
	it('selects a frontmatter value, in a flow map or a block map', () => {
		expect(at(locate(FILE, 'ingredients[0].items[1].unit'))).toBe('tasse');
		expect(at(locate(FILE, 'ingredients[1].items[0].unit'))).toBe('pincée');
		expect(at(locate(FILE, 'tags[1]'))).toBe('desertt');
		expect(at(locate(FILE, 'title'))).toBe('Galettes inventées');
	});
	it('falls back to the deepest part that exists', () => {
		expect(at(locate(FILE, 'ingredients[0].items[0].note'))).toBe('{ qty: 1, unit: cup, name: farine }');
		expect(at(locate(FILE, 'ingredients[1].items[0].brand'))).toBe('name: sel\n        qty: 1\n        unit: pincée');
		expect(locate(FILE, 'times.prep')).toBeNull();
	});
	it('finds body places: preamble, section heading, step', () => {
		const { body } = parsed;
		expect(at(locate(FILE, 'body.preamble', body))).toBe('Une introduction.');
		expect(at(locate(FILE, 'body.sections[1]', body))).toBe('## Notes');
		expect(at(locate(FILE, 'body.steps[1]', body))).toBe('Cuire 20 min.');
	});
	it('points at nothing for a whole-file diagnostic or a file it cannot read', () => {
		expect(locate(FILE, null)).toBeNull();
		expect(locate('pas une fiche', 'title')).toBeNull();
		expect(locate('---\ntitle: [\n---\n', 'title')).toBeNull();
	});
	it('every path the checker reports on the file resolves or gives null, never throws', () => {
		for (const d of checkFile(FILE).diagnostics) {
			const s = locate(FILE, d.path, parsed.body);
			if (s) expect(s.end).toBeGreaterThanOrEqual(s.start);
		}
	});
});

describe('scalarAt (the quick fix)', () => {
	it('gives the one scalar the whole path names, quotes included', () => {
		expect(at(scalarAt(FILE, 'ingredients[0].items[1].unit'))).toBe('tasse');
		expect(at(scalarAt(FILE, 'ingredients[1].items[0].unit'))).toBe('pincée');
		expect(at(scalarAt(FILE, 'tags[1]'))).toBe('desertt');
		expect(at(scalarAt(FILE, 'ingredients[1].items[1]'))).toBe('"500 g de lait"');
	});
	it('gives nothing short of the full path, for a map or a list, or the body', () => {
		expect(scalarAt(FILE, 'ingredients[0].items[0].note')).toBeNull();
		expect(scalarAt(FILE, 'ingredients[0]')).toBeNull();
		expect(scalarAt(FILE, 'tags')).toBeNull();
		expect(scalarAt(FILE, 'body.steps[0]')).toBeNull();
		expect(scalarAt(FILE, null)).toBeNull();
	});
	it('a replacement written there reads back as the new value', () => {
		const s = scalarAt(FILE, 'ingredients[0].items[1].unit')!;
		const fixed = FILE.slice(0, s.start) + yamlScalar('cup') + FILE.slice(s.end);
		expect(valueAt(parseRecipe(fixed).frontmatter, 'ingredients[0].items[1].unit')).toBe('cup');
		const t = scalarAt(FILE, 'tags[1]')!;
		const tagged = FILE.slice(0, t.start) + yamlScalar('pâte à choux') + FILE.slice(t.end);
		expect(parseRecipe(tagged).frontmatter?.tags).toEqual(['dessert', 'pâte à choux']);
	});
});

describe('yamlScalar', () => {
	it('plain when it reads back as itself, else quoted', () => {
		expect(yamlScalar('cup')).toBe('cup');
		expect(yamlScalar('sans-gluten')).toBe('sans-gluten');
		expect(yamlScalar('true')).toBe('"true"');
		expect(yamlScalar('a: b')).toBe('"a: b"');
		expect(yamlScalar('[x]')).toBe('"[x]"');
	});
});
