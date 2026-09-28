import { describe, expect, it } from 'vitest';
import { nameRows, Resolver } from '../../src/lib/ingredients/resolve';
import { toTasteDiagnostics } from '../../src/lib/ingredients/totaste';
import { checkRecipe } from '../../src/lib/vault/check';
import { suggestTag, tagFor, vocabDiagnostics } from '../../src/lib/vault/rules/vaultvocab';
import type { Recipe } from '../../src/lib/vault/types';
import { findAtEdge, findInside, nameWords, parseWordList, type CheckWords } from '../../src/lib/vault/words';

// Invented lists: the checks read whatever the vault's files say.
const WORDS: CheckWords = {
	participles: parseWordList({ words: { fr: ['haché', 'hachés', 'râpé', 'en cubes'], en: ['chopped'] }, keep: ['porc haché'] }),
	descriptors: parseWordList({ words: { fr: ['gros', 'petits'], en: ['large'] }, keep: ['gros sel', 'petits pois'] }),
	brands: parseWordList({ words: ['Heinz', 'Lea & Perrins', 'Kraft'], keep: ['Kraft Dinner'] })
};

const file = (items: string, extra = '') => `---
schema: 3
title: Recette inventée
lang: fr
${extra}ingredients:
  - items:
${items}
---

## Préparation

1. Mélanger.
`;

const codes = (text: string, opts = { words: WORDS }) => checkRecipe(text, opts).diagnostics.filter((d) => ['W302', 'W304', 'W607'].includes(d.code));

describe('parseWordList', () => {
	it('reads one list or lists per language, folded into words', () => {
		expect(parseWordList({ words: ['Club House'] })).toEqual({ words: [['club', 'house']], keep: [] });
		expect(parseWordList({ words: { fr: ['Émincé'], en: ['sliced'] }, keep: ['Bœuf haché'] })).toEqual({
			words: [['emince'], ['sliced']],
			keep: [['boeuf', 'hache']]
		});
	});

	it('gives nothing for a missing or malformed file, so the check stays off', () => {
		expect(parseWordList(undefined)).toBeUndefined();
		expect(parseWordList('haché')).toBeUndefined();
		expect(parseWordList({ words: [] })).toBeUndefined();
		expect(parseWordList({ words: [3, null], keep: ['x'] })).toBeUndefined();
	});
});

describe('finding listed words in a name', () => {
	it('matches whole words at the end (French) or the start (English), accent- and case-insensitively', () => {
		expect(findAtEdge(nameWords('Oignon HACHE'), WORDS.participles)).toMatchObject({ text: 'HACHE', rest: 'Oignon' });
		expect(findAtEdge(nameWords('chopped onion'), WORDS.participles)).toMatchObject({ text: 'chopped', rest: 'onion' });
		expect(findAtEdge(nameWords('bœuf en cubes'), WORDS.participles)).toMatchObject({ text: 'en cubes', rest: 'bœuf' });
		// Not inside a word, not in the middle of the name.
		expect(findAtEdge(nameWords('hachoir'), WORDS.participles)).toBeUndefined();
		expect(findAtEdge(nameWords('oignon haché fin'), WORDS.participles)).toBeUndefined();
	});

	it('never flags a name that is the word alone', () => {
		expect(findAtEdge(nameWords('haché'), WORDS.participles)).toBeUndefined();
		expect(findInside(nameWords('Heinz'), WORDS.brands)).toBeUndefined();
	});

	it('leaves a word that a keep name covers', () => {
		expect(findAtEdge(nameWords('porc haché'), WORDS.participles)).toBeUndefined();
		expect(findAtEdge(nameWords('veau haché'), WORDS.participles)).toBeDefined();
		expect(findAtEdge(nameWords('gros sel'), WORDS.descriptors)).toBeUndefined();
		expect(findInside(nameWords('Kraft Dinner'), WORDS.brands)).toBeUndefined();
		expect(findInside(nameWords('fromage Kraft'), WORDS.brands)).toMatchObject({ text: 'Kraft', rest: 'fromage' });
	});

	it('keeps markers and punctuation of the name as written', () => {
		expect(findAtEdge(nameWords('oignon [?] haché'), WORDS.participles)).toMatchObject({ text: 'haché', rest: 'oignon [?]' });
		expect(findInside(nameWords('sauce (Lea & Perrins)'), WORDS.brands)).toMatchObject({ text: 'Lea & Perrins', rest: 'sauce' });
	});
});

describe('W302 / W304 / W607 in the checker', () => {
	it('flag a preparation, a size and a brand in a name, with the entry to write', () => {
		const ds = codes(
			file(`      - { qty: 1, unit: piece, name: oignon haché, prep: fin }
      - { qty: 2, unit: piece, name: gros oignons }
      - { qty: 1, unit: cup, name: ketchup Heinz }`)
		);
		expect(ds.map((d) => [d.code, d.path])).toEqual([
			['W302', 'ingredients[0].items[0].name'],
			['W304', 'ingredients[0].items[1].name'],
			['W607', 'ingredients[0].items[2].name']
		]);
		expect(ds[0].fix).toContain('`name: oignon, prep: "haché, fin"`');
		expect(ds[1].fix).toContain('`name: oignons, note: gros`');
		expect(ds[2].fix).toContain('`name: ketchup, brand: Heinz`');
		expect(ds.every((d) => d.severity === 'warning')).toBe(true);
	});

	it('check `or` options, plain or full entries', () => {
		const ds = codes(file(`      - { qty: 1, unit: cup, name: sauce chili, or: [ketchup Heinz, { qty: 1, unit: cup, name: tomates en cubes }] }`));
		expect(ds.map((d) => [d.code, d.path])).toEqual([
			['W607', 'ingredients[0].items[0].or[0]'],
			['W302', 'ingredients[0].items[0].or[1].name']
		]);
		expect(ds[0].fix).toContain('Write the option as an entry: `{ name: ketchup, brand: Heinz }`');
	});

	it('are off without the lists: the same file checked with none gives no warning', () => {
		const text = file(`      - { qty: 1, unit: piece, name: oignon haché }`);
		expect(codes(text)).toHaveLength(1);
		expect(checkRecipe(text).diagnostics.filter((d) => d.code === 'W302')).toEqual([]);
	});

	it('are warnings: the file still passes', () => {
		const r = checkRecipe(file(`      - { qty: 1, unit: piece, name: gros oignon haché }`), { words: WORDS });
		expect(r.recipe).toBeDefined();
		expect(r.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['W302', 'W304']));
	});
});

describe('W501 / W502', () => {
	const tags = new Map([
		['dessert', 'dessert'],
		['sweet', 'dessert'],
		['plat-principal', 'plat-principal'],
		['main course', 'plat-principal']
	]);

	it('finds a tag by alias, as the index does', () => {
		expect(tagFor(tags, 'Sweet')).toBe('dessert');
		expect(tagFor(tags, 'main course')).toBe('plat-principal');
		expect(tagFor(tags, 'Plat principal')).toBe('plat-principal');
		expect(tagFor(tags, 'dessert [?]')).toBe('dessert');
		expect(tagFor(tags, 'tarte')).toBeUndefined();
	});

	it('suggests the closest canonical tag, and nothing when nothing is close', () => {
		expect(suggestTag(tags, 'desert')).toBe('dessert');
		expect(suggestTag(tags, 'swete')).toBe('dessert');
		expect(suggestTag(tags, 'tarte')).toBeUndefined();
	});

	it('W501 per unknown tag, W502 for a family within two edits of another', () => {
		const ds = vocabDiagnostics({ tags: ['dessert', 'desert', 'tarte'], family: 'lasagnes' }, { tags, families: ['lasagna', 'tarte-au-sucre'] });
		expect(ds.map((d) => [d.code, d.path])).toEqual([
			['W501', 'tags[1]'],
			['W501', 'tags[2]'],
			['W502', 'family']
		]);
		expect(ds[0].fix).toContain('`dessert`');
		expect(ds[2].fix).toContain('family: lasagna');
	});

	it('W502 stays quiet for an existing family, and when nothing is near', () => {
		expect(vocabDiagnostics({ family: 'lasagna' }, { families: ['lasagna', 'lasagnes'] })).toEqual([]);
		expect(vocabDiagnostics({ family: 'pate-chinois' }, { families: ['lasagna'] })).toEqual([]);
	});

	it('run in the checker only with the vault vocabulary (the server check)', () => {
		const text = file(`      - { qty: 1, unit: cup, name: farine }`, 'tags: [desert]\nfamily: lasagnes\nvariant: de la cabane\n');
		expect(checkRecipe(text).diagnostics.filter((d) => d.code[1] === '5' && d.code[0] === 'W')).toEqual([]);
		const ds = checkRecipe(text, { vocab: { tags, families: ['lasagna'] } }).diagnostics;
		expect(ds.filter((d) => d.code === 'W501' || d.code === 'W502').map((d) => d.code)).toEqual(['W502', 'W501']);
	});
});

describe('W606', () => {
	const resolver = new Resolver(
		nameRows([
			{ slug: 'sel', names: { fr: ['sel'], en: [] } },
			{ slug: 'farine', names: { fr: ['farine'], en: [] } }
		]),
		{}
	);
	const recipe = (items: Recipe['ingredients'][number]['items']) => ({ lang: 'fr' as const, ingredients: [{ items }] });

	it('flags to_taste on a registry entry not marked au_gout', () => {
		const ds = toTasteDiagnostics(
			recipe([
				{ name: 'sel', toTaste: true },
				{ name: 'farine', toTaste: true },
				{ name: 'poudre de perlimpinpin', toTaste: true },
				{ name: 'sel', or: [{ name: 'farine', toTaste: true }] }
			]),
			resolver,
			new Set(['sel'])
		);
		expect(ds.map((d) => [d.code, d.path])).toEqual([
			['W606', 'ingredients[0].items[1].to_taste'],
			['W606', 'ingredients[0].items[3].or[0].to_taste']
		]);
		expect(ds[0].fix).toContain('`{ name: farine }`');
	});
});
