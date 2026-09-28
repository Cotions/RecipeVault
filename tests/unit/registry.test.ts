import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { lookupKey, parseNormalizeVocab, singularKey } from '../../src/lib/ingredients/normalize';
import { checkRegistry, parseIngredient, serializeIngredient } from '../../src/lib/ingredients/registry';
import { CATEGORIES, type RegistryEntry } from '../../src/lib/ingredients/types';
import { seedVocab } from '../../src/lib/server/vault';
import { seedEntries } from '../../src/lib/server/seed';
import { CODE_FIXERS } from '../../src/lib/vault/codes';

const VOCAB = seedVocab(readFileSync('docs/VOCAB.md', 'utf8'));
const ALLERGENS = new Set(Object.keys(parse(VOCAB['allergens.yaml'])));
const RULES = parseNormalizeVocab(parse(VOCAB['normalize.yaml'])).plurals;
const FIXTURE_DIR = 'tests/fixtures/vault/ingredients';
const fixtures = readdirSync(FIXTURE_DIR)
	.filter((f) => f.endsWith('.md'))
	.map((f) => ({ file: f, stem: f.slice(0, -3), text: readFileSync(join(FIXTURE_DIR, f), 'utf8') }));

describe('lookup key', () => {
	it('folds case, accents, ligatures and whitespace, and strips markers', () => {
		expect(lookupKey('  Œufs  [?] ')).toBe('oeufs');
		expect(lookupKey('Crème   Fraîche')).toBe('creme fraiche');
		expect(lookupKey('beurre [illisible]')).toBe('beurre');
	});

	it('unifies apostrophe and hyphen variants, and the space before %', () => {
		expect(lookupKey('blé d’Inde')).toBe(lookupKey("blé d'Inde"));
		expect(lookupKey('blé d ’ Inde')).toBe("ble d'inde");
		expect(lookupKey('chou‑fleur')).toBe('chou-fleur');
		expect(lookupKey('chou – fleur')).toBe('chou-fleur');
		expect(lookupKey('crème 35 %')).toBe(lookupKey('crème 35%'));
		expect(lookupKey('crème 35 %')).not.toBe(lookupKey('crème 15 %'));
	});
});

describe('plural rules (data, vocab/normalize.yaml)', () => {
	it('reads the seed rules', () => {
		expect(RULES.fr).toEqual({ suffixes: ['x', 's'], minLength: 4 });
		expect(RULES.en).toEqual({ suffixes: ['s'], minLength: 4 });
	});

	it('strips each word and each part of a compound, leaving short words and numbers alone', () => {
		expect(singularKey('tomates concassees', RULES.fr)).toBe('tomate concassee');
		expect(singularKey('pommes de terre', RULES.fr)).toBe('pomme de terre');
		expect(singularKey('choux-fleurs', RULES.fr)).toBe('chou-fleur');
		expect(singularKey('poireaux', RULES.fr)).toBe('poireau');
		expect(singularKey('os', RULES.fr)).toBe('os');
		expect(singularKey('lait 3.25%', RULES.fr)).toBe('lait 3.25%');
		expect(singularKey('eggs', RULES.en)).toBe('egg');
		expect(singularKey('eggs', undefined)).toBe('eggs');
	});

	it('ignores malformed rule data', () => {
		expect(parseNormalizeVocab(undefined)).toEqual({ plurals: {} });
		expect(parseNormalizeVocab({ plurals: { fr: { suffixes: 's' }, en: { suffixes: ['s', 3] } } }).plurals).toEqual({ en: { suffixes: ['s'], minLength: 1 } });
	});
});

describe('registry files', () => {
	it('parses every fixture entry but the broken one', () => {
		for (const f of fixtures) {
			const r = parseIngredient(f.text, { fileStem: f.stem, allergens: ALLERGENS });
			if (f.stem === 'casse') expect(r.diagnostics.map((d) => d.code)).toEqual(['E803']);
			else expect(r.diagnostics, f.file).toEqual([]);
		}
	});

	it('covers every category, staples, a density, per-unit weights and a substitute pair', () => {
		const entries = fixtures.flatMap((f) => parseIngredient(f.text, { fileStem: f.stem }).entry ?? []);
		expect(entries.length).toBeGreaterThanOrEqual(30);
		expect(new Set(entries.map((e) => e.category))).toEqual(new Set(CATEGORIES));
		expect(entries.some((e) => e.staple)).toBe(true);
		expect(entries.some((e) => e.density)).toBe(true);
		expect(entries.find((e) => e.slug === 'oeuf')?.weights).toEqual({ piece: 55 });
		const beurre = entries.find((e) => e.slug === 'beurre')!;
		expect(beurre.substitutes).toEqual(['margarine']);
		expect(entries.find((e) => e.slug === 'margarine')?.substitutes).toEqual(['beurre']);
	});

	it('round-trips: serialize(parse(file)) is the file, byte for byte', () => {
		for (const f of fixtures) {
			const { entry } = parseIngredient(f.text, { fileStem: f.stem });
			if (!entry) continue;
			expect(serializeIngredient(entry), f.file).toBe(f.text);
			expect(parseIngredient(serializeIngredient(entry)).entry).toEqual(entry);
		}
	});

	it('writes a fixed key order, flow lists, and quotes what would misread', () => {
		const e: RegistryEntry = {
			slug: 'lait-inventé'.replace('é', 'e'),
			category: 'cremerie',
			names: { fr: ['lait 3,25 %', 'lait'], en: [] },
			defaultUnit: 'ml',
			staple: false,
			auGout: true,
			density: 1.03,
			weights: { cup: 258 },
			substitutes: [],
			allergens: ['lait'],
			body: 'Note.'
		};
		const text = serializeIngredient(e);
		expect(text).toBe(
			'---\nslug: lait-invente\ncategory: cremerie\nnames:\n  fr: ["lait 3,25 %", lait]\n  en: []\ndefault_unit: ml\nstaple: false\nau_gout: true\ndensity: 1.03\nweights: { cup: 258 }\nsubstitutes: []\nallergens: [lait]\n---\n\nNote.\n'
		);
		expect(parseIngredient(text).entry).toEqual(e);
	});
});

describe('registry codes', () => {
	const dir = 'tests/fixtures/registry';
	const files = readdirSync(dir).filter((f) => f.endsWith('.md'));

	it('has a fixture for every per-file code, raising exactly that code', () => {
		for (const f of files) {
			const code = f.slice(0, 4);
			const stem = code === 'E802' ? f.slice(0, -3) : undefined;
			const r = parseIngredient(readFileSync(join(dir, f), 'utf8'), { fileStem: stem, allergens: ALLERGENS });
			expect([...new Set(r.diagnostics.map((d) => d.code))], f).toEqual([code]);
			expect(r.entry === undefined, f).toBe(code[0] === 'E');
		}
		const perFile = Object.keys(CODE_FIXERS).filter((c) => /^[EW]8/.test(c) && !['W808', 'W810'].includes(c));
		expect(files.map((f) => f.slice(0, 4)).sort()).toEqual(perFile.sort());
	});

	it('drops an unknown allergen from the entry, and suggests the close one', () => {
		const r = parseIngredient(readFileSync(join(dir, 'W809-unknown-allergen.md'), 'utf8'), { allergens: ALLERGENS });
		expect(r.entry?.allergens).toEqual(['gluten']);
		expect(r.diagnostics[0]).toMatchObject({ code: 'W809', path: 'allergens[1]', fix: 'Did you mean `arachide`?' });
	});

	it('W808: a substitute that does not exist, or the entry itself', () => {
		const e = (slug: string, subs: string[], fr: string[] = [slug]): RegistryEntry => ({
			slug,
			category: 'autre',
			names: { fr, en: [] },
			staple: false,
			auGout: false,
			weights: {},
			substitutes: subs,
			allergens: [],
			body: ''
		});
		const out = checkRegistry([e('a', ['b', 'zz', 'a']), e('b', [])]);
		expect(out.get('a')?.map((d) => [d.code, d.path])).toEqual([
			['W808', 'substitutes[1]'],
			['W808', 'substitutes[2]']
		]);
		expect(out.has('b')).toBe(false);
	});

	it('W810: one lookup key under two entries, on both, once per entry', () => {
		const e = (slug: string, fr: string[], en: string[] = []): RegistryEntry => ({
			slug,
			category: 'autre',
			names: { fr, en },
			staple: false,
			auGout: false,
			weights: {},
			substitutes: [],
			allergens: [],
			body: ''
		});
		const out = checkRegistry([e('huile-d-olive', ["huile d'olive", 'Huile']), e('huile-vegetale', ['huile végétale', 'huile'], ['oil']), e('oeuf', ['œuf', 'oeuf'])]);
		expect(out.get('huile-d-olive')?.map((d) => [d.code, d.path])).toEqual([['W810', 'names.fr[1]']]);
		expect(out.get('huile-vegetale')?.map((d) => [d.code, d.path])).toEqual([['W810', 'names.fr[1]']]);
		// Two spellings of one key inside one entry are not a collision.
		expect(out.has('oeuf')).toBe(false);
	});
});

describe('the seed registry (docs/INGREDIENTS-SEED.yaml)', () => {
	const entries = seedEntries(readFileSync('docs/INGREDIENTS-SEED.yaml', 'utf8'), ALLERGENS);

	it('has well over a hundred entries, every category, no error, no collision, no dangling substitute', () => {
		expect(entries.length).toBeGreaterThan(150);
		expect(new Set(entries.map((e) => e.category))).toEqual(new Set(CATEGORIES));
		expect([...checkRegistry(entries).entries()]).toEqual([]);
	});

	it('marks the doc’s staples, and keeps regional names as aliases', () => {
		const by = new Map(entries.map((e) => [e.slug, e]));
		for (const s of ['sel', 'poivre', 'huile-vegetale', 'farine-tout-usage', 'sucre', 'beurre', 'eau']) expect(by.get(s)?.staple, s).toBe(true);
		const keyOf = new Map(entries.flatMap((e) => [...e.names.fr, ...e.names.en].map((n) => [lookupKey(n), e.slug] as const)));
		expect(keyOf.get(lookupKey('piment vert'))).toBe('poivron-vert');
		expect(keyOf.get(lookupKey("blé d'Inde en crème"))).toBe('mais-en-creme');
		expect(keyOf.get(lookupKey('crème 35 %'))).not.toBe(keyOf.get(lookupKey('crème 15 %')));
	});
});
