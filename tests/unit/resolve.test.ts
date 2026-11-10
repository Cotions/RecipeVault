import { describe, expect, it } from 'vitest';
import { lookupKey, singularKey, type PluralRules } from '../../src/lib/ingredients/normalize';
import { clearTypo, FUZZY, modifierOnly, nameRows, resolutionDiagnostics, Resolver, ruleRows, sharesStem, SHOWN, shownCandidates, trigrams, typoDistance } from '../../src/lib/ingredients/resolve';
import { resemblesSlugs } from '../../src/lib/vault/quickfix';
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

describe('disambiguation rules (`when`)', () => {
	// Invented entries: a bare name the unit, the prep or the language decides.
	const R = new Resolver(
		[
			{ key: 'tomates fraiches', skey: 'tomate fraiche', slug: 'tomates-fraiches' },
			{ key: 'boeuf hache', skey: 'boeuf hache', slug: 'boeuf-hache' },
			{ key: 'champignons', skey: 'champignon', slug: 'champignons' }
		],
		PLURALS,
		[],
		ruleRows([
			{ slug: 'tomates-en-boite', when: [{ names: ['tomates', 'tomatoes'], unit: ['container'] }] },
			{ slug: 'tomates-fraiches', when: [{ names: ['tomates', 'tomatoes'], unit: ['piece', 'lb'] }] },
			{ slug: 'boeuf-hache', when: [{ names: ['bœuf'], words: ['haché', 'hachée'] }] },
			{ slug: 'boeuf-en-cubes', when: [{ names: ['boeuf'], words: ['en cubes'] }] },
			{ slug: 'lard-sale', when: [{ names: ['lard'], lang: 'fr' }] },
			{ slug: 'saindoux', when: [{ names: ['lard'], lang: 'en' }] },
			{ slug: 'champignons-en-boite', when: [{ names: ['champignons'], unit: ['container'] }] }
		])
	);
	const r = (name: string, line: object = {}, lang = 'fr') => {
		const x = R.resolve({ name, ...line }, lang);
		return `${x.resolution}:${x.item}`;
	};

	it('the unit or unit class decides', () => {
		expect(r('tomates', { unit: 'can', note: '28 oz' })).toBe('rule:tomates-en-boite');
		expect(r('Tomatoes', { unit: 'jar' }, 'en')).toBe('rule:tomates-en-boite');
		expect(r('tomates', { unit: 'piece' })).toBe('rule:tomates-fraiches');
		expect(r('tomate', { unit: 'lb' })).toBe('rule:tomates-fraiches');
	});

	it('prep or note words decide, as whole words, singular or plural', () => {
		expect(r('boeuf', { prep: 'haché' })).toBe('rule:boeuf-hache');
		expect(r('bœuf', { prep: 'hachés maigre' })).toBe('rule:boeuf-hache');
		expect(r('boeuf', { note: 'coupé en cubes' })).toBe('rule:boeuf-en-cubes');
		expect(r('boeuf', { prep: 'hachoir' })).toBe('ambiguous:null');
	});

	it('the language decides', () => {
		expect(r('lard', {}, 'fr')).toBe('rule:lard-sale');
		expect(r('lard', {}, 'en')).toBe('rule:saindoux');
	});

	it('when no rule holds the name stays unresolved: ambiguous across entries, never a guess', () => {
		expect(r('tomates', { unit: 'cup' })).toBe('ambiguous:null');
		expect(r('tomates')).toBe('ambiguous:null');
		expect(r('boeuf', { prep: 'en cubes, haché' })).toBe('ambiguous:null');
		expect(R.candidates('tomates').map((c) => c.slug)).toEqual(['tomates-en-boite', 'tomates-fraiches']);
	});

	it('a rule beats an alias; when none holds, the alias decides', () => {
		expect(r('champignons', { unit: 'can' })).toBe('rule:champignons-en-boite');
		expect(r('champignons', { unit: 'cup' })).toBe('alias:champignons');
	});

	it('a rule name alone is not an alias, and plain names are unaffected', () => {
		expect(r('tomates fraîches', { unit: 'can' })).toBe('alias:tomates-fraiches');
		expect(R.hasRules('tomates')).toBe(true);
		expect(R.hasRules('tomates fraiches')).toBe(false);
		const one = new Resolver([], PLURALS, [], ruleRows([{ slug: 'boeuf-hache', when: [{ names: ['boeuf'], words: ['haché'] }] }]));
		expect(one.resolve({ name: 'boeuf', prep: 'en cubes' }).resolution).toBe('none');
		expect(one.candidates('boeuf')[0]).toEqual({ slug: 'boeuf-hache', score: 1 });
	});

	it('a rule reached through the singular key never beats an exact alias of another entry', () => {
		const names = [
			{ key: 'pates', skey: 'pate', slug: 'pates-alimentaires' },
			{ key: 'pate', skey: 'pate', slug: 'pate-a-tarte' }
		];
		const P = new Resolver(names, PLURALS, [], ruleRows([{ slug: 'pate-a-pizza', when: [{ names: ['pâte'], unit: ['mass'] }] }]));
		expect(P.resolve({ name: 'pâtes', unit: 'g' })).toMatchObject({ item: 'pates-alimentaires', resolution: 'alias' });
		expect(P.hasRules('pates')).toBe(false);
		// The rule's own key, and a plural no alias names, still meet it.
		expect(P.resolve({ name: 'pâte', unit: 'g' })).toMatchObject({ item: 'pate-a-pizza', resolution: 'rule' });
		expect(P.hasRules('pate')).toBe(true);
		const Q = new Resolver([], PLURALS, [], ruleRows([{ slug: 'pate-a-pizza', when: [{ names: ['pâte'], unit: ['mass'] }] }]));
		expect(Q.resolve({ name: 'pâtes', unit: 'g' })).toMatchObject({ item: 'pate-a-pizza', resolution: 'rule' });
		expect(Q.hasRules('pates')).toBe(true);
	});
});

describe('candidates', () => {
	it('nearest entries by trigram similarity, best first, never below the threshold', () => {
		const c = resolver.candidates(lookupKey('tomate fraîches en dés'));
		expect(c[0].slug).toBe('tomates-fraiches');
		expect(c.length).toBeLessThanOrEqual(3);
		expect(c.every((x) => x.score >= FUZZY.minScore && x.score <= 1)).toBe(true);
		expect(resolver.candidates('zzz')).toEqual([]);
	});

	it('respects the count and threshold options', () => {
		expect(resolver.candidates('piment', 'fr', { minScore: 0.1, count: 1 })).toHaveLength(1);
		expect(resolver.candidates('piment', 'fr', { minScore: 0.99 })).toEqual([]);
	});

	it('shown: never under half the best one, nor under the floor; best first', () => {
		const c = (slug: string, score: number) => ({ slug, score });
		expect(shownCandidates([c('a', 0.8), c('b', 0.41), c('c', 0.39)]).map((x) => x.slug)).toEqual(['a', 'b']);
		expect(shownCandidates([c('a', 0.2), c('b', SHOWN.floor), c('c', SHOWN.floor - 0.01)]).map((x) => x.slug)).toEqual(['a', 'b']);
		expect(shownCandidates([])).toEqual([]);
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

describe('a name that is only a modifier in an alias (usability round 4)', () => {
	it('says which end of an alias is its noun, by language', () => {
		expect(modifierOnly('soda', 'biscuits soda', 'fr')).toBe(true);
		expect(modifierOnly('soda', 'soda crackers', 'en')).toBe(true);
		expect(modifierOnly('chocolat', 'pepites de chocolat', 'fr')).toBe(true);
		expect(modifierOnly('soda', 'soda a pate', 'fr')).toBe(false);
		expect(modifierOnly('sugar', 'brown sugar', 'en')).toBe(false);
		expect(modifierOnly('soda', 'biscuits soda')).toBe(false);
		expect(modifierOnly('soda', 'sodas')).toBe(false);
		expect(modifierOnly('soda', 'soda', 'fr')).toBe(false);
	});

	// Invented registry; « soda » by the spoon is baking soda (docs/INGREDIENTS-SEED.yaml).
	const reg = [
		{ slug: 'bicarbonate-de-soude', names: { fr: ['bicarbonate de soude', 'soda à pâte'], en: ['baking soda'] }, when: [{ names: ['soda'], unit: ['tsp', 'tbsp', 'pinch'] }] },
		{ slug: 'biscuits-soda', names: { fr: ['biscuits soda'], en: ['soda crackers'] } },
		{ slug: 'pepites-de-chocolat', names: { fr: ['pépites de chocolat'], en: ['chocolate chips'] } }
	] as never[];
	const R = new Resolver(nameRows(reg, PLURALS), PLURALS, [], ruleRows(reg));

	it('never offers « biscuits soda » for « soda »; the spoon rule links it', () => {
		expect(R.candidates('soda').map((c) => c.slug)).not.toContain('biscuits-soda');
		expect(R.candidates('soda')[0].slug).toBe('bicarbonate-de-soude');
		expect(R.resolve({ name: 'soda', unit: 'tsp' }, 'fr')).toMatchObject({ item: 'bicarbonate-de-soude', resolution: 'rule' });
		expect(R.resolve({ name: 'soda', unit: 'tsp' }, 'en')).toMatchObject({ item: 'bicarbonate-de-soude', resolution: 'rule' });
		expect(R.resolve({ name: 'soda', unit: 'cup' }, 'fr').item).toBeNull();
	});

	it('keeps a look-alike that is not a whole-word modifier', () => {
		expect(R.candidates('biscuit soda').map((c) => c.slug)).toContain('biscuits-soda');
		expect(R.candidates('pepites chocolat').map((c) => c.slug)).toContain('pepites-de-chocolat');
	});
});

describe('a strong suggestion and a guess (usability round 5)', () => {
	// Invented registry.
	const reg = [
		{ slug: 'vanille', names: { fr: ['vanille'] } },
		{ slug: 'oignon', names: { fr: ['oignon'] } },
		{ slug: 'boeuf-hache', names: { fr: ['bœuf haché'] } },
		{ slug: 'beurre', names: { fr: ['beurre'] } },
		{ slug: 'babeurre', names: { fr: ['babeurre'] } },
		{ slug: 'lime', names: { fr: ['lime'] } },
		{ slug: 'poivre', names: { fr: ['poivre'] } },
		{ slug: 'citrouille', names: { fr: ['citrouille'] } },
		{ slug: 'nouilles-aux-oeufs', names: { fr: ['nouilles aux œufs'] } },
		{ slug: 'huile-vegetale', names: { fr: ['huile végétale'] } },
		{ slug: 'saindoux', names: { fr: ['saindoux'] } }
	] as never[];
	const R = new Resolver(nameRows(reg, PLURALS), PLURALS);
	const shown = (name: string) => shownCandidates(R.candidates(lookupKey(name)));

	it('counts an adjacent swap as one edit', () => {
		expect(typoDistance('oingon', 'oignon')).toBe(1);
		expect(typoDistance('beouf hache', 'boeuf hache')).toBe(1);
		expect(typoDistance('vanile', 'vanille')).toBe(1);
		expect(typoDistance('lievre', 'lime')).toBe(3);
	});

	it('a clear typo is one edit, on a word of four letters or more', () => {
		expect(clearTypo('vanile', 'vanille')).toBe(true);
		expect(clearTypo('oeu', 'oeuf')).toBe(false);
		expect(clearTypo('soupe tomate', 'sauce tomate')).toBe(false);
	});

	it('a clear typo is strong and first; a near word is a guess, not strong', () => {
		expect(shown('vanile')).toEqual([expect.objectContaining({ slug: 'vanille', strong: true })]);
		expect(shown('oingon')[0]).toMatchObject({ slug: 'oignon', strong: true });
		expect(shown('beouf haché')[0]).toMatchObject({ slug: 'boeuf-hache', strong: true });
		expect(shown('beure').map((c) => [c.slug, !!c.strong])).toEqual([
			['beurre', true],
			['babeurre', false]
		]);
		expect(shown('huile')[0]).toMatchObject({ slug: 'huile-vegetale' });
		expect(shown('huile')[0].strong).toBeUndefined();
		expect(shown('nouilles').map((c) => c.slug)).toEqual(['nouilles-aux-oeufs']);
		expect(shown('nouilles')[0].strong).toBeUndefined();
	});

	it('never offers an entry that shares no stem with the name', () => {
		expect(sharesStem('lievre', 'lime')).toBe(false);
		expect(sharesStem('nouille', 'citrouille')).toBe(false);
		expect(sharesStem('beurre fondu', 'saindoux')).toBe(false);
		expect(sharesStem('noix', 'noix de coco rapee')).toBe(true);
		expect(sharesStem('ognon', 'oignon')).toBe(true);
		expect(shown('lièvre')).toEqual([]);
		expect(shown('beurre fondu').map((c) => c.slug)).not.toContain('saindoux');
		expect(R.candidates('lievre', 'fr', { stem: false }).map((c) => c.slug)).toContain('lime');
	});
});

describe('« soda »: the paste box and the resolve queue give one answer (usability round 5)', () => {
	// Invented registry; « soda » by the spoon is baking soda (docs/INGREDIENTS-SEED.yaml).
	const reg = [
		{ slug: 'bicarbonate-de-soude', names: { fr: ['bicarbonate de soude', 'soda à pâte'], en: ['baking soda'] }, when: [{ names: ['soda'], unit: ['tsp', 'tbsp', 'pinch'] }] },
		{ slug: 'gingembre-ale', names: { fr: ['soda au gingembre', 'ginger ale'], en: ['ginger ale'] } },
		{ slug: 'son-de-ble', names: { fr: ['son de blé'], en: ['wheat bran'] } }
	] as never[];
	const withRule = new Resolver(nameRows(reg, PLURALS), PLURALS, [], ruleRows(reg));
	const noRule = new Resolver(nameRows(reg, PLURALS), PLURALS);
	const w305 = (R: Resolver, it: { name: string; unit?: string }) => resolutionDiagnostics(recipe([it as never]), R).filter((d) => d.code === 'W305');
	/** What /resoudre offers for the key (server/queue.ts resolveQueue). */
	const queue = (R: Resolver) => shownCandidates(R.candidates('soda', 'fr')).map((c) => c.slug);

	it('by the spoon the rule links it: no W305', () => {
		expect(w305(withRule, { name: 'soda', unit: 'tsp' })).toEqual([]);
	});

	it('with no unit, or by the cup: W305 names what the queue offers, in its order, baking soda first and as a guess', () => {
		for (const unit of [undefined, 'cup']) {
			const [d] = w305(withRule, { name: 'soda', unit });
			expect(resemblesSlugs(d)).toEqual(queue(withRule));
			expect(resemblesSlugs(d)[0]).toBe('bicarbonate-de-soude');
		}
		// The rule did not hold on the line: its entry comes first but is not the answer.
		expect(withRule.candidates('soda')[0]).toEqual({ slug: 'bicarbonate-de-soude', score: 1 });
	});

	it('without the rule, the alias « soda à pâte » still puts baking soda first; « son de blé » shares no stem', () => {
		const [d] = w305(noRule, { name: 'soda' });
		expect(resemblesSlugs(d)).toEqual(queue(noRule));
		expect(queue(noRule)).toEqual(['bicarbonate-de-soude', 'gingembre-ale']);
	});
});
