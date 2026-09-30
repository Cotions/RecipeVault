// vocab/scaling.yaml and vocab/unit-labels.yaml as data (plan 05, Phase 1).

import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_FACTOR_CAP, parseScaling } from '../../src/lib/render/scale';
import { parseUnitWords, setUnitWords, unitLabel, unitWord, unitWords } from '../../src/lib/render/unitwords';
import { formatPack } from '../../src/lib/render/money';
import { ingredientText } from '../../src/lib/render/ingredient';
import { seedVocab } from '../../src/lib/server/vault';
import { installUnitWords } from '../../src/lib/server/vocab';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const seed = seedVocab(readFileSync('docs/VOCAB.md', 'utf8'));
const read = (text: string) => parse(text, { version: '1.2' });

describe('parseScaling', () => {
	it('reads the seed', () => {
		const r = parseScaling(read(seed['scaling.yaml']))!;
		expect(r.tolerance).toBe(0.1);
		expect(r.approx).toBe(0.02);
		expect(r.factor).toEqual({ min: 0.1, max: 20 });
		expect(r.fractions.cup).toEqual([1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4]);
		expect(r.fractions.tbsp).toEqual([1 / 2]);
		expect(r.fractions.kg).toEqual([]);
		expect(r.fractions.count).toEqual([1 / 2]);
		expect(r.always).toEqual(['cup', 'tbsp', 'tsp', 'pinch', 'drop', 'count', 'container']);
		expect(r.ladder).toEqual([
			{ unit: 'tsp', into: 'tbsp', per: 3, from: 1 },
			{ unit: 'tbsp', into: 'cup', per: 16 },
			{ unit: 'oz', into: 'lb', per: 16 },
			{ unit: 'g', into: 'kg', per: 1000 },
			{ unit: 'ml', into: 'l', per: 1000 }
		]);
		expect(r.metric).toEqual({
			units: ['g', 'ml'],
			steps: [
				{ from: 0, step: 1 },
				{ from: 100, step: 5 },
				{ from: 1000, step: 25 }
			]
		});
	});

	it('a missing or broken file is null: amounts show as before', () => {
		expect(parseScaling(undefined)).toBeNull();
		expect(parseScaling(null)).toBeNull();
		expect(parseScaling('tolerance: 0.1')).toBeNull();
		expect(parseScaling([1, 2])).toBeNull();
	});

	it('keeps what reads and drops the rest', () => {
		const r = parseScaling(
			read(`
tolerance: -1
approx: 3
factor: { min: 2, max: 0.5 }
fractions:
  cup: [1/4, 1/5, 0.5, abc, 2/3]
  gallon: [1/2]
  count: ~
  mass: [3/8]
always: [cup, nope, default]
ladder:
  - { unit: tsp, into: tbsp, per: 3, from: 1/2 }
  - { unit: tsp, into: cup, per: 48 }
  - { unit: g, into: cup, per: 250 }
  - { unit: cup, into: cup, per: 1 }
  - { unit: lb, into: kg, per: 0 }
metric:
  units: [g, pouce]
  steps: [{ from: 0, step: 1 }, { from: 10, step: -5 }, oops]
`)
		)!;
		expect(r.tolerance).toBe(0.1);
		expect(r.approx).toBe(0.02);
		expect(r.factor).toEqual(DEFAULT_FACTOR_CAP);
		expect(r.fractions).toEqual({ cup: [1 / 4, 1 / 2, 2 / 3], count: [], mass: [3 / 8] });
		expect(r.always).toEqual(['cup']);
		expect(r.ladder).toEqual([{ unit: 'tsp', into: 'tbsp', per: 3, from: 0.5 }]);
		expect(r.metric).toEqual({ units: ['g'], steps: [{ from: 0, step: 1 }] });
	});

	it('a partial file gets the default numbers', () => {
		expect(parseScaling({})).toEqual({
			tolerance: 0.1,
			approx: 0.02,
			factor: DEFAULT_FACTOR_CAP,
			fractions: {},
			always: [],
			ladder: [],
			metric: { units: [], steps: [] }
		});
	});
});

describe('unit words as data', () => {
	const installed = unitWords();
	afterEach(() => setUnitWords(installed));

	it('the seed gives the words the code had', () => {
		const w = parseUnitWords(read(seed['unit-labels.yaml']));
		expect(w.cup).toEqual({ fr: ['tasse', 'tasses'], en: ['cup', 'cups'] });
		expect(w.tbsp).toEqual({ fr: ['c. à table', 'c. à table'], en: ['tbsp', 'tbsp'] });
		expect(w.piece).toEqual({ fr: ['pièce', 'pièces'], en: ['piece', 'pieces'] });
		expect(Object.keys(w)).toHaveLength(26);
	});

	it('server code gets the vault’s words from the request hook, not only from a layout render (review)', () => {
		const dir = mkdtempSync(join(tmpdir(), 'rv-unitwords-'));
		try {
			setUnitWords({});
			expect(formatPack(6, 'piece')).toBe('6 piece');
			writeFileSync(join(dir, 'unit-labels.yaml'), 'piece:\n  fr: [morceau, morceaux]\n');
			installUnitWords(dir);
			expect(formatPack(6, 'piece')).toBe('6 morceaux');
			// An edit is read on the next request.
			writeFileSync(join(dir, 'unit-labels.yaml'), 'piece:\n  fr: [bout, bouts]\n');
			installUnitWords(dir);
			expect(formatPack(6, 'piece')).toBe('6 bouts');
			expect(readFileSync('src/hooks.server.ts', 'utf8')).toMatch(/installUnitWords\(app\.ctx\.paths\.vocab\)/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('a vault without the file shows the unit code; a line in piece never has a word', () => {
		setUnitWords({});
		expect(unitLabel('tbsp', 2, 'fr')).toBe('tbsp');
		expect(unitLabel('piece', 2, 'fr')).toBe('');
		expect(unitWord('piece', 2, 'fr')).toBe('piece');
		expect(formatPack(6, 'piece')).toBe('6 piece');
		expect(ingredientText({ qty: { raw: 2, value: 2 }, unit: 'cup', name: 'farine' }, { lang: 'fr' })).toBe('2 cup de farine');
	});

	it('the vault’s words win, per language, and a malformed entry is dropped', () => {
		setUnitWords(parseUnitWords({ tbsp: { fr: 'c. à soupe' }, cup: { fr: ['verre'] }, tsp: { fr: [1, 2] }, piece: { fr: 'pièce' }, pouce: { fr: 'po' } }));
		expect(unitLabel('tbsp', 3, 'fr')).toBe('c. à soupe');
		expect(unitLabel('tbsp', 3, 'en')).toBe('tbsp');
		expect(unitLabel('cup', 3, 'fr')).toBe('verre');
		expect(unitLabel('tsp', 1, 'fr')).toBe('tsp');
		expect(unitLabel('piece', 1, 'fr')).toBe('');
		// A pack size is where piece's word shows (money.ts): the vault's, not the code's.
		expect(formatPack(1, 'piece')).toBe('1 pièce');
		expect(formatPack(6, 'piece')).toBe('6 pièce');
		expect(unitWords()).not.toHaveProperty('pouce');
	});

	it('French plural from 2, English above 1', () => {
		expect(unitLabel('cup', 1.5, 'fr')).toBe('tasse');
		expect(unitLabel('cup', 2, 'fr')).toBe('tasses');
		expect(unitLabel('cup', 1.5, 'en')).toBe('cups');
		expect(unitLabel('cup', 1, 'en')).toBe('cup');
	});
});
