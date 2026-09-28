import { describe, expect, it } from 'vitest';
import { lookupKey, singularKey, type PluralRules } from '../../src/lib/ingredients/normalize';
import { resolutionDiagnostics, Resolver, trigrams } from '../../src/lib/ingredients/resolve';
import type { Recipe } from '../../src/lib/vault/types';

const PLURALS: PluralRules = { fr: { suffixes: ['x', 's'], minLength: 4 }, en: { suffixes: ['s'], minLength: 4 } };

// Invented registry: [slug, lang, names].
const ENTRIES: [string, string, string[]][] = [
	['oeuf', 'fr', ['œuf', 'oeuf', 'œufs']],
	['oeuf', 'en', ['egg']],
	['tomates-fraiches', 'fr', ['tomate fraîche']],
	['huile-d-olive', 'fr', ["huile d'olive", 'huile']],
	['huile-vegetale', 'fr', ['huile végétale', 'huile']],
	['creme-15', 'fr', ['crème 15 %']],
	['creme-35', 'fr', ['crème 35 %', 'crème à fouetter']],
	['piment-vert', 'fr', ['piment vert', 'poivron vert']],
	['piment-fort', 'fr', ['piment fort']],
	['pates-alimentaires', 'fr', ['pâtes']],
	['pate-a-tarte', 'fr', ['pâte', 'pâte à tarte']],
	['carotte', 'fr', ['carotte']]
];

const rows = ENTRIES.flatMap(([slug, lang, names]) =>
	names.map((n) => {
		const key = lookupKey(n);
		return { key, skey: singularKey(key, PLURALS[lang]), slug };
	})
);
const resolver = new Resolver(rows, PLURALS, ['bouillon']);

const recipe = (items: Recipe['ingredients'][number]['items']): Pick<Recipe, 'ingredients' | 'lang'> => ({
	lang: 'fr',
	ingredients: [{ items }]
});

describe('lookup key', () => {
	it('folds case, accents, ligatures, markers, apostrophes, hyphens and the space before %', () => {
		expect(lookupKey('Œufs')).toBe('oeufs');
		expect(lookupKey('Huile d’olive')).toBe("huile d'olive");
		expect(lookupKey('crème 35%')).toBe(lookupKey('crème 35 %'));
		expect(lookupKey('tomates [?]')).toBe('tomates');
		expect(lookupKey('céleri – rave')).toBe(lookupKey('céleri-rave'));
	});

	it('singularizes each word above the minimum length, never words with digits', () => {
		expect(singularKey('tomates fraiches', PLURALS.fr)).toBe('tomate fraiche');
		expect(singularKey('choux', PLURALS.fr)).toBe('chou');
		expect(singularKey('pois', PLURALS.fr)).toBe('poi');
		expect(singularKey('gras', PLURALS.fr)).toBe('gra');
		expect(singularKey('os', PLURALS.fr)).toBe('os');
		expect(singularKey('35s', PLURALS.fr)).toBe('35s');
	});

	it('pads trigrams per word', () => {
		expect([...trigrams('ail')]).toEqual(['  a', ' ai', 'ail', 'il ']);
	});
});

describe('resolution order', () => {
	it('override first, then the exact key, then the singular key', () => {
		expect(resolver.resolve({ name: 'œufs', item: 'carotte' })).toEqual({ key: 'oeufs', item: 'carotte', resolution: 'override' });
		expect(resolver.resolve({ name: 'Œufs' })).toEqual({ key: 'oeufs', item: 'oeuf', resolution: 'alias' });
		expect(resolver.resolve({ name: 'tomates fraîches' })).toEqual({ key: 'tomates fraiches', item: 'tomates-fraiches', resolution: 'plural' });
		expect(resolver.resolve({ name: 'carottes' })).toMatchObject({ item: 'carotte', resolution: 'plural' });
		expect(resolver.resolve({ name: 'eggs' }, 'en')).toMatchObject({ item: 'oeuf', resolution: 'plural' });
	});

	it('a sub-recipe line resolves to no item', () => {
		expect(resolver.resolve({ name: 'bouillon maison', recipe: 'bouillon' })).toEqual({ key: 'bouillon maison', item: null, resolution: 'recipe' });
	});

	it('an exact key under two entries is ambiguous and never auto-resolved', () => {
		expect(resolver.resolve({ name: 'huile' })).toEqual({ key: 'huile', item: null, resolution: 'ambiguous' });
		expect(resolver.candidates('huile')).toEqual([
			{ slug: 'huile-d-olive', score: 1 },
			{ slug: 'huile-vegetale', score: 1 }
		]);
	});

	it('traps stay apart: the exact form wins over the plural rule', () => {
		expect(resolver.resolve({ name: 'pâtes' })).toMatchObject({ item: 'pates-alimentaires', resolution: 'alias' });
		expect(resolver.resolve({ name: 'pâte' })).toMatchObject({ item: 'pate-a-tarte', resolution: 'alias' });
		expect(resolver.resolve({ name: 'crème 35%' })).toMatchObject({ item: 'creme-35' });
		expect(resolver.resolve({ name: 'crème' })).toMatchObject({ item: null, resolution: 'none' });
		expect(resolver.resolve({ name: 'piment vert' })).toMatchObject({ item: 'piment-vert' });
		expect(resolver.resolve({ name: 'piment' })).toMatchObject({ item: null, resolution: 'none' });
	});

	it('a singular key under two entries resolves to neither', () => {
		const r = new Resolver(
			[
				{ key: 'noix', skey: 'noi', slug: 'noix' },
				{ key: 'noi', skey: 'noi', slug: 'autre' }
			],
			PLURALS
		);
		expect(r.resolveKey('nois')).toEqual({ key: 'nois', item: null, resolution: 'none' });
	});
});

describe('candidates', () => {
	it('nearest entries by trigram similarity, best first, never below the threshold', () => {
		const c = resolver.candidates(lookupKey('tomate fraîches en dés'));
		expect(c[0].slug).toBe('tomates-fraiches');
		expect(c.length).toBeLessThanOrEqual(3);
		expect(c.every((x) => x.score >= 0.3 && x.score <= 1)).toBe(true);
		expect(resolver.candidates('zzz')).toEqual([]);
	});

	it('respects the count and threshold options', () => {
		expect(resolver.candidates('piment', 'fr', { minScore: 0.1, count: 1 })).toHaveLength(1);
		expect(resolver.candidates('piment', 'fr', { minScore: 0.99 })).toEqual([]);
	});
});

describe('resolution diagnostics', () => {
	it('W305 with a candidate, W303 without, W307 for an override naming nothing, on the right paths', () => {
		const d = resolutionDiagnostics(
			recipe([
				{ name: 'œufs' },
				{ name: 'carottes râpées' },
				{ name: 'xylophage' },
				{ name: 'farine', item: 'farine-de-riz' },
				{ name: 'bouillon', recipe: 'bouillon' },
				{ name: 'beurre', item: 'carotte', or: [{ name: 'huile' }] }
			]),
			resolver
		);
		expect(d.map((x) => [x.code, x.path, x.severity])).toEqual([
			['W305', 'ingredients[0].items[1].name', 'warning'],
			['W303', 'ingredients[0].items[2].name', 'warning'],
			['W307', 'ingredients[0].items[3].item', 'warning'],
			['W305', 'ingredients[0].items[5].or[0].name', 'warning']
		]);
		expect(d[0].message).toContain('carotte');
		expect(d[3].message).toContain('huile-d-olive, huile-vegetale');
	});
});
