import { describe, expect, it } from 'vitest';
import { checkBatch, checkPaste } from '../../src/lib/vault/check';

function card(title: string, opts: { slug?: string; refs?: string[] } = {}) {
	const items = ['{ qty: 1, unit: cup, name: farine }', ...(opts.refs ?? []).map((r) => `{ qty: 1, unit: piece, name: ${r}, recipe: ${r} }`)];
	return `---
schema: 3
title: ${title}
${opts.slug ? `slug: ${opts.slug}\n` : ''}source: { type: invented }
times: { prep: 10m }
servings: 4
ingredients:
  - items:
${items.map((i) => `      - ${i}`).join('\n')}
---

## Préparation

1. Mélanger.
`;
}

const codesOf = (r: ReturnType<typeof checkBatch>) => r.files.map((f) => f.diagnostics.map((d) => d.code));

describe('checkBatch', () => {
	it('E103 on a slug collision within the batch, derived or explicit', () => {
		const r = checkBatch([
			{ name: 'a.md', text: card('Tarte au sucre') },
			{ name: 'b.md', text: card('Tarte à la farlouche', { slug: 'tarte-au-sucre' }) }
		]);
		expect(codesOf(r)).toEqual([['E103'], ['E103']]);
		expect(r.files[0].diagnostics[0]).toMatchObject({ file: 'a.md', path: 'slug' });
		expect(r.files[0].diagnostics[0].message).toContain('b.md');
		expect(r.files[0].recipe).toBeUndefined();
	});

	it('E103 against the vault', () => {
		const r = checkBatch([{ name: 'a.md', text: card('Tarte au sucre') }], {
			vault: [{ slug: 'tarte-au-sucre', title: 'Tarte au sucre', refs: [] }]
		});
		expect(r.files[0].diagnostics.map((d) => d.code)).toEqual(['E103']);
		expect(r.files[0].diagnostics[0].message).toContain('already in the vault');
	});

	it('W306 for a sub-recipe in neither the batch nor the vault', () => {
		const r = checkBatch([{ name: 'a.md', text: card('Tarte au sucre', { refs: ['pate-brisee'] }) }]);
		expect(r.files[0].diagnostics.map((d) => [d.code, d.path])).toEqual([['W306', 'ingredients[0].items[1].recipe']]);
		expect(r.files[0].recipe).toBeDefined();
	});

	it('no W306 when the batch or the vault has it', () => {
		const inBatch = checkBatch([
			{ name: 'a.md', text: card('Tarte au sucre', { refs: ['pate-brisee'] }) },
			{ name: 'b.md', text: card('Pâte brisée') }
		]);
		expect(codesOf(inBatch)).toEqual([[], []]);
		const inVault = checkBatch([{ name: 'a.md', text: card('Tarte au sucre', { refs: ['pate-brisee'] }) }], {
			vault: [{ slug: 'pate-brisee', refs: [] }]
		});
		expect(codesOf(inVault)).toEqual([[]]);
	});

	it('E213 on a cycle through the vault', () => {
		const r = checkBatch([{ name: 'a.md', text: card('Tarte au sucre', { refs: ['pate-brisee'] }) }], {
			vault: [
				{ slug: 'pate-brisee', refs: ['beurre-clarifie'] },
				{ slug: 'beurre-clarifie', refs: ['tarte-au-sucre'] }
			]
		});
		const [d] = r.files[0].diagnostics;
		expect(d.code).toBe('E213');
		expect(d.message).toContain('tarte-au-sucre → pate-brisee → beurre-clarifie → tarte-au-sucre');
	});

	it('E213 on a recipe using itself', () => {
		const r = checkBatch([{ name: 'a.md', text: card('Tarte au sucre', { refs: ['tarte-au-sucre'] }) }]);
		expect(codesOf(r)).toEqual([['E213']]);
	});

	it('W608 same title, W503 near-identical title (markers, case and accents ignored)', () => {
		const r = checkBatch([
			{ name: 'a.md', text: card('Pouding chômeur', { slug: 'pouding-a' }) },
			{ name: 'b.md', text: card('POUDING CHOMEUR [+]', { slug: 'pouding-b' }) },
			{ name: 'c.md', text: card('Poudings chomeurs', { slug: 'pouding-c' }) }
		]);
		expect(codesOf(r)).toEqual([
			['W503', 'W608'],
			['W503', 'W608', 'I701'],
			['W503']
		]);
	});

	it('near-identical to a vault title', () => {
		const r = checkBatch([{ name: 'a.md', text: card('Tarte au sucre') }], {
			vault: [{ slug: 'tartes-au-sucre', title: 'Tartes au sucre', refs: [] }]
		});
		expect(codesOf(r)).toEqual([['W503']]);
	});

	it('summarizes codes by frequency', () => {
		const r = checkBatch([
			{ name: 'a.md', text: card('Tarte au sucre') },
			{ name: 'b.md', text: card('Tarte au sucre') }
		]);
		expect(r.summary).toEqual([
			{ code: 'E103', severity: 'error', count: 2 },
			{ code: 'W608', severity: 'warning', count: 2 }
		]);
	});
});

describe('checkPaste', () => {
	it('checks each fence and reports outside text as I702', () => {
		const text = `Voici.\n\n\`\`\`markdown\n${card('Tarte au sucre')}\`\`\`\n\nQUESTIONS\n1. Combien de sucre ?\n`;
		const r = checkPaste(text);
		expect(r.files).toHaveLength(1);
		expect(r.files[0].diagnostics).toEqual([]);
		expect(r.pasteDiagnostics.map((d) => d.code)).toEqual(['I702']);
		expect(r.pasteDiagnostics[0].message).toContain('Combien de sucre');
	});

	it('a paste with no fence and no frontmatter is E001', () => {
		const r = checkPaste('Je ne peux pas lire cette image.');
		expect(r.files[0].diagnostics.map((d) => d.code)).toEqual(['E001']);
		expect(r.pasteDiagnostics).toEqual([]);
	});
});
