import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findQtyUnit, headingKind, suggestKey, unitForAlias, UNITS, ALLOWED_KEYS } from '../../src/lib/vault/vocab';

describe('unit list', () => {
	it('matches rule 8 of the prompt in docs/AI-TEMPLATE.md', () => {
		const doc = readFileSync('docs/AI-TEMPLATE.md', 'utf8');
		const m = doc.match(/unit must be exactly one of:\n([\s\S]*?)\n\s+qty requires unit/);
		expect(m).not.toBeNull();
		const listed = m![1].split(/[\s,]+/).filter(Boolean);
		expect([...listed].sort()).toEqual([...UNITS].sort());
	});

	it('matches the canonical units in docs/VOCAB.md', () => {
		const doc = readFileSync('docs/VOCAB.md', 'utf8');
		const block = doc.slice(doc.indexOf('## Units'));
		const yaml = block.slice(block.indexOf('```yaml') + 7, block.indexOf('```', block.indexOf('```yaml') + 7));
		const keys = [...yaml.matchAll(/^(\w+):/gm)].map((x) => x[1]);
		expect([...keys].sort()).toEqual([...UNITS].sort());
	});
});

describe('unitForAlias', () => {
	it.each([
		['tasse', 'fr', 'cup'],
		['tasses', 'fr', 'cup'],
		['livre', 'fr', 'lb'],
		['lbs', 'fr', 'lb'],
		['c. à thé', 'fr', 'tsp'],
		['c.à thé', 'fr', 'tsp'],
		['c. a soupe', 'fr', 'tbsp'],
		['C. À TABLE', 'fr', 'tbsp'],
		['cuillère à soupe', 'fr', 'tbsp'],
		['L', 'fr', 'l'],
		['gousses', 'fr', 'clove'],
		['boîte', 'fr', 'can'],
		['bouteille', 'fr', 'bottle'],
		['pot', 'fr', 'jar'],
		['sacs', 'fr', 'bag'],
		['t.', 'fr', 'cup'],
		['t', 'fr', 'cup'],
		['t', 'en', 'tsp'],
		['T', 'en', 'tbsp']
	] as const)('%s (%s) → %s', (alias, lang, unit) => {
		expect(unitForAlias(alias, lang)).toBe(unit);
	});

	it('is ambiguous where VOCAB.md does not settle it', () => {
		expect(unitForAlias('T', 'fr')).toBeNull();
		expect(unitForAlias('t.', 'en')).toBeNull();
	});

	it('knows nothing of branche or cuillere', () => {
		expect(unitForAlias('branche', 'fr')).toBeUndefined();
		expect(unitForAlias('cuillere', 'fr')).toBeUndefined();
	});
});

describe('findQtyUnit', () => {
	it.each([
		['2 lbs', '2', 'lbs'],
		['1/2 tasse', '1/2', 'tasse'],
		['500 g de lait', '500', 'g'],
		['3 c. à thé de sel', '3', 'c. à thé'],
		['environ 1 1/2 livre', '1 1/2', 'livre'],
		['ou 1 ml piment', '1', 'ml'],
		['2 Tasses', '2', 'Tasses'],
		['250ml', '250', 'ml'],
		['1 pot de moutarde', '1', 'pot']
	])('%s', (text, qty, unit) => {
		const m = findQtyUnit(text);
		expect(m?.qty).toBe(qty);
		expect(m?.unitText).toBe(unit);
	});

	it.each(['crème 35 %', 'bien mûr', '7 Up', '2 oeufs', 'boîte de 796', 'gros', 'tomates en 4 morceaux'])(
		'finds nothing in %s',
		(text) => expect(findQtyUnit(text)).toBeUndefined()
	);
});

describe('headingKind', () => {
	it.each([
		['Préparation', 'method'],
		['PREPARATION', 'method'],
		['Méthode :', 'method'],
		['Instructions', 'method'],
		['Remarques', 'notes'],
		['Variants', 'variants'],
		['Substitutions', 'alternatives'],
		['Étapes', 'other'],
		['Ingrédients', 'other']
	])('%s → %s', (h, kind) => expect(headingKind(h)).toBe(kind));
});

describe('suggestKey', () => {
	it.each([
		['serving', 'servings'],
		['temps', 'times'],
		['portions', 'servings'],
		['titre', 'title'],
		['tag', 'tags']
	])('%s → %s', (k, s) => expect(suggestKey(k, ALLOWED_KEYS.top)).toBe(s));

	it('suggests nothing far away', () => {
		expect(suggestKey('photographie', ALLOWED_KEYS.top)).toBeUndefined();
	});
});
