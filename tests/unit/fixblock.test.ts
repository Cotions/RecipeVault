import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkPaste, checkRecipe, hasErrors } from '../../src/lib/vault/check';
import { needsSpec, renderFixBlock } from '../../src/lib/vault/fixblock';

const fixture = (f: string) => readFileSync(`tests/fixtures/check/${f}`, 'utf8');
const SPEC = 'You convert photographs of recipes into a strict Markdown format.\n(…the rest of the prompt…)\n';

function blockFor(file: string, spec?: string) {
	const text = fixture(file);
	return renderFixBlock([{ text, diagnostics: checkRecipe(text).diagnostics }], [], { spec });
}

describe('renderFixBlock', () => {
	it('single file, errors only', async () => {
		await expect(blockFor('invalid/E201-tasse.md', SPEC)).toMatchFileSnapshot('../fixtures/check/fixblock/single-error.txt');
	});

	it('errors and warnings in separate sections', async () => {
		const text = fixture('invalid/E210-quantity-in-name.md').replace('servings: 8\n', 'serving: 8\n');
		const block = renderFixBlock([{ text, diagnostics: checkRecipe(text).diagnostics }], []);
		expect(block).toContain('ERRORS — must fix:\n  [E210]');
		expect(block).toContain('WARNINGS — fix if you can, the file will save without them:\n  [W610] serving:');
		await expect(block).toMatchFileSnapshot('../fixtures/check/fixblock/errors-and-warnings.txt');
	});

	it('includes the spec for E001', async () => {
		const block = blockFor('invalid/E001-no-frontmatter.md', SPEC);
		expect(block).toContain('--- FORMAT ---\n' + SPEC + '--- END FORMAT ---');
		await expect(block).toMatchFileSnapshot('../fixtures/check/fixblock/e001-with-spec.txt');
	});

	it('points at the spec when none is given', () => {
		expect(blockFor('invalid/E001-no-frontmatter.md')).toContain('Re-read the format instructions');
	});

	it('leaves the spec out for a single ingredient error', () => {
		const block = blockFor('invalid/E203-qty-without-unit.md', SPEC);
		expect(block).not.toContain('FORMAT');
		expect(block).not.toContain('Re-read');
	});

	it('multi-recipe paste: only failing files, plus the titles that passed', async () => {
		const text = fixture('paste/two-recipes-one-failing.txt');
		const r = checkPaste(text);
		const { files } = await import('../../src/lib/vault/fences').then((m) => m.splitPaste(text));
		const failed = r.files.map((f, i) => ({ text: files[i], diagnostics: f.diagnostics })).filter((f) => hasErrors(f.diagnostics));
		const passed = r.files.filter((f) => !hasErrors(f.diagnostics)).map((f) => f.recipe!.title);
		const block = renderFixBlock(failed, passed, { spec: SPEC });
		expect(block).toContain('Already saved, do not send again: Sucre à la crème.');
		expect(block).not.toContain('title: Sucre à la crème');
		await expect(block).toMatchFileSnapshot('../fixtures/check/fixblock/paste-one-failing.txt');
	});

	it('two failing files are numbered', () => {
		const a = fixture('invalid/E201-tasse.md');
		const b = fixture('invalid/E203-qty-without-unit.md');
		const block = renderFixBlock(
			[a, b].map((text) => ({ text, diagnostics: checkRecipe(text).diagnostics })),
			[]
		);
		expect(block).toMatch(/^RECIPEVAULT — 2 FILES REJECTED\n/);
		expect(block.replace(/\s+/g, ' ')).toContain('each COMPLETE corrected file inside its own ```markdown fence');
		expect(block).toContain('=== FILE 1 OF 2 ===');
		expect(block).toContain('=== FILE 2 OF 2 ===');
		expect(block.match(/--- YOUR FILE ---/g)).toHaveLength(2);
	});

	it('leaves E103 out: the app resolves slug collisions', () => {
		const text = fixture('invalid/E201-tasse.md');
		const e103 = { code: 'E103', severity: 'error' as const, path: 'slug', message: 'collision.', fix: 'Resolve in the app.' };
		const withBoth = renderFixBlock([{ text, diagnostics: [e103, ...checkRecipe(text).diagnostics] }], []);
		expect(withBoth).toContain('[E201]');
		expect(withBoth).not.toContain('E103');
		expect(renderFixBlock([{ text, diagnostics: [e103] }], [])).toBe('');
	});

	it('never shows info diagnostics', () => {
		expect(blockFor('invalid/E112-status-added.md')).not.toContain('E112');
	});

	it('wraps at 80 columns', () => {
		const block = blockFor('invalid/E201-unknown-unit.md');
		const head = block.slice(0, block.indexOf('--- YOUR FILE ---'));
		for (const line of head.split('\n')) {
			if (!line.includes('`')) expect(line.length).toBeLessThanOrEqual(80);
		}
	});
});

describe('needsSpec', () => {
	const d = (code: string) => ({ code, severity: 'error' as const, path: null, message: '' });
	it('on E001, or three E2xx errors in one file', () => {
		expect(needsSpec([{ text: '', diagnostics: [d('E001')] }])).toBe(true);
		expect(needsSpec([{ text: '', diagnostics: [d('E201'), d('E203'), d('E210')] }])).toBe(true);
		expect(needsSpec([{ text: '', diagnostics: [d('E201'), d('E203'), d('E109')] }])).toBe(false);
	});
});
