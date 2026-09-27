import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkFile } from '../../src/lib/vault/check';
import { scalar, serialize } from '../../src/lib/vault/serialize';
import type { Body } from '../../src/lib/vault/types';

const dirs = ['tests/fixtures/check/valid', 'tests/fixtures/vault/recipes'];
const fixtures = dirs.flatMap((d) =>
	readdirSync(d)
		.filter((f) => f.endsWith('.md'))
		.map((f) => [f, readFileSync(join(d, f), 'utf8')] as const)
);

function load(text: string) {
	const r = checkFile(text);
	expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
	return { recipe: r.recipe!, body: r.body! };
}

/** Meaning of a body: section kinds and text, steps. Heading wording may change. */
const bodyMeaning = (b: Body) => ({
	preamble: b.preamble,
	sections: b.sections.map((s) => ({ kind: s.kind, heading: s.kind === 'other' ? s.heading : null, text: s.text })),
	steps: b.steps
});

describe('serialize', () => {
	it.each(fixtures)('%s round-trips without changing meaning', (_, text) => {
		const a = load(text);
		const out = serialize(a.recipe, a.body);
		const b = load(out);
		expect({ ...b.recipe, slugDerived: false }).toEqual({ ...a.recipe, slugDerived: false });
		expect(bodyMeaning(b.body)).toEqual(bodyMeaning(a.body));
	});

	it.each(fixtures)('%s is idempotent', (_, text) => {
		const a = load(text);
		const once = serialize(a.recipe, a.body);
		const b = load(once);
		expect(serialize(b.recipe, b.body)).toBe(once);
	});

	it('writes the house style', () => {
		const a = load(readFileSync('tests/fixtures/check/valid/quebec-card.md', 'utf8'));
		const out = serialize(a.recipe, a.body);
		expect(out).toMatch(/^---\nschema: 3\ntitle: "Tarte au sucre de ma tante \[\?: tante Irène\]"\nslug: tarte-au-sucre\n/);
		expect(out).toContain('oven: { temp: 350, temp_max: 375, unit: F }');
		expect(out).toContain('      - { qty: "1 1/2", unit: cup, name: cassonade, alt: { qty: 375, unit: ml } }');
		expect(out).toContain('      - { qty: 1, unit: lb, name: "beurre [illisible]", prep: fondu }');
		expect(out).toContain('or: [{ qty: 1, unit: tbsp, name: fécule de maïs, note: "délayée [+]" }]');
		expect(out).toContain('  - group: Crème fouettée\n    optional: true\n    items:\n');
		expect(out).toContain('tags: [dessert, tarte, quebecois]');
		expect(out.endsWith('\n')).toBe(true);
		expect(out.endsWith('\n\n')).toBe(false);
	});

	it('writes body headings in the recipe language', () => {
		const text = readFileSync('tests/fixtures/check/valid/sub-recipe-yield.md', 'utf8');
		const a = load(text);
		const out = serialize(a.recipe, a.body);
		expect(out).toContain('## Préparation\n\n1. Couper');
		expect(out).toContain('## Notes\n\nSe congèle bien.');
		expect(out).not.toContain('Méthode');
	});

	it('keeps bullet steps as written', () => {
		const a = load(readFileSync('tests/fixtures/check/valid/bullet-steps.md', 'utf8'));
		const out = serialize(a.recipe, a.body);
		expect(out).toContain("## Préparation\n\n- Mettre les pommes et l'eau dans une casserole.\n- Cuire à feu doux 20 min,\n  en brassant de temps en temps.\n* Ajouter le sucre");
		expect(out).toContain('### Garniture\n\n- Saupoudrer');
		expect(a.body.steps).toHaveLength(4);
	});

	it('quotes what YAML could misread', () => {
		for (const s of ['no', 'Yes', 'off', 'null', '1:30', '010', '3.5', '[?] beurre', 'a: b', 'x #y', '#tag', '', ' pad', '- dash', '@at', '1e3'])
			expect(scalar(s), s).toMatch(/^"/);
		for (const s of ['crème 35 %', "huile d'olive", 'bœuf haché', '30m', '45m-50m', '2026-09-26'])
			expect(scalar(s), s).toBe(s);
		expect(scalar('a, b', true)).toBe('"a, b"');
		expect(scalar('a, b', false)).toBe('a, b');
	});
});
