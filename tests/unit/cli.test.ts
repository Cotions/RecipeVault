import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = 'tests/fixtures/check';

function vault(args: string[], input?: string) {
	const r = spawnSync(process.execPath, ['bin/vault.js', ...args], { encoding: 'utf8', input, env: { ...process.env, NO_COLOR: '1' } });
	return { code: r.status, out: r.stdout, err: r.stderr };
}

describe('vault check', () => {
	it('exits 0 on the valid fixtures', () => {
		const files = readdirSync(`${DIR}/valid`).map((f) => join(DIR, 'valid', f));
		const r = vault(['check', ...files]);
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/✓ .*quebec-card\.md/);
	});

	it('exits 1 on each invalid fixture and names its code', () => {
		for (const f of ['E201-tasse.md', 'E001-fenced.md', 'E109-hours-words.md']) {
			const r = vault(['check', join(DIR, 'invalid', f)]);
			expect(r.code, f).toBe(1);
			expect(r.out).toContain(`✗ ${join(DIR, 'invalid', f)}`);
			expect(r.out).toContain(f.slice(0, 4));
		}
	}, 30_000);

	it('--json', () => {
		const r = vault(['check', '--json', join(DIR, 'invalid', 'E201-tasse.md')]);
		const json = JSON.parse(r.out);
		expect(json.files[0].ok).toBe(false);
		expect(json.files[0].diagnostics[0]).toMatchObject({ code: 'E201', path: 'ingredients[0].items[0].unit' });
	});

	it('--fix-block prints the block with the prompt from the docs when needed', () => {
		const r = vault(['check', '--fix-block', join(DIR, 'invalid', 'E001-no-frontmatter.md')]);
		expect(r.code).toBe(1);
		expect(r.out).toMatch(/^RECIPEVAULT — FILE REJECTED\n/);
		expect(r.out).toContain('--- FORMAT ---\nYou convert photographs of recipes');
		expect(r.out).toContain('--- YOUR FILE ---');
	});

	it('--fix-block has nothing for the AI when the only error is E103', () => {
		const r = vault(['check', '--fix-block', '--dir', join(DIR, 'batch', 'E103-same-slug')]);
		expect(r.code).toBe(1);
		expect(r.out).toBe('');
		expect(r.err).toContain('nothing for the AI to fix');
	});

	it('reads a paste from stdin', () => {
		const r = vault(['check', '-'], readFileSync(join(DIR, 'paste', 'two-recipes-one-failing.txt'), 'utf8'));
		expect(r.code).toBe(1);
		expect(r.out).toContain('✓ stdin #1');
		expect(r.out).toContain('✗ stdin #2');
		expect(r.out).toContain('I702');
	});

	it('--dir ends with a summary by code frequency; --quiet prints only the summary line', () => {
		const r = vault(['check', '--dir', join(DIR, 'batch', 'E103-same-slug')]);
		expect(r.out).toMatch(/By code, most frequent first:\n\s+E103\s+2\s+in 2 files/);
		const q = vault(['check', '--quiet', '--dir', join(DIR, 'batch', 'E103-same-slug')]);
		expect(q.out.trim().split('\n')).toEqual(['2 files: 2 failed, 0 passed — 2 errors, 2 warnings']);
	});

	it('--vault checks against the vault and skips the file being checked', () => {
		const v = mkdtempSync(join(tmpdir(), 'rv-'));
		mkdirSync(join(v, 'recipes'));
		const card = readFileSync(join(DIR, 'valid', 'minimal.md'), 'utf8');
		writeFileSync(join(v, 'recipes', 'toasts-au-beurre-d-arachide.md'), card);
		expect(vault(['check', '--vault', v, join(DIR, 'valid', 'minimal.md')]).out).toContain('E103');
		expect(vault(['check', '--vault', v, join(v, 'recipes', 'toasts-au-beurre-d-arachide.md')]).code).toBe(0);
	});

	it('--dir on a vault checks its recipes and its ingredient registry', () => {
		const r = vault(['check', '--dir', 'tests/fixtures/vault']);
		expect(r.code).toBe(1);
		expect(r.out).toMatch(/✗ ingredients\/casse\.md {2}1 error/);
		expect(r.out).toMatch(/! ingredients\/huile-vegetale\.md {2}1 warning/);
		expect(r.out).toMatch(/37 ingredients: 1 failed, 36 passed/);
		const j = JSON.parse(vault(['check', '--dir', 'tests/fixtures/vault', '--json']).out);
		expect(j.files.length).toBe(22);
		expect(j.ingredients.find((f: { name: string }) => f.name === 'ingredients/casse.md').diagnostics[0].code).toBe('E803');
	});

	it('--dir reports the settled duplicate pairs naming a recipe no longer in the vault as stale (plan 05, Q14)', () => {
		const v = join(mkdtempSync(join(tmpdir(), 'rv-cli-distinct-')), 'vault');
		cpSync('tests/fixtures/vault', v, { recursive: true });
		mkdirSync(join(v, 'vocab'), { recursive: true });
		writeFileSync(join(v, 'vocab', 'distinct.yaml'), '# settled\n- [crepes, pate-brisee]\n- [crepes, gone-recipe]\n');
		const r = vault(['check', '--dir', v]);
		expect(r.out).toContain('vocab/distinct.yaml: 2 pairs settled as different recipes, 1 stale');
		expect(r.out).toContain('crepes ≠ gone-recipe  (no longer in recipes/; ignored)');
	});

	it('exits 2 on usage and IO errors', () => {
		expect(vault([]).code).toBe(2);
		expect(vault(['check']).code).toBe(2);
		expect(vault(['check', '--bogus', 'x']).code).toBe(2);
		expect(vault(['check', 'does-not-exist.md']).code).toBe(2);
	});
});

describe('vault prompt', () => {
	it('prints the fenced prompt from docs/AI-TEMPLATE.md', () => {
		const r = vault(['prompt']);
		expect(r.code).toBe(0);
		expect(r.out.startsWith('You convert photographs of recipes')).toBe(true);
		expect(r.out).toContain('SKELETON');
		expect(r.out).not.toContain('````');
	});

	it('every frontmatter example holding a marker is valid YAML', async () => {
		const { parse } = await import('yaml');
		const examples = vault(['prompt'])
			.out.split('\n')
			.map((l) => l.replace(/^\s*(Examples:)?\s*/, ''))
			.filter((l) => /^(- \{|[a-z_]+: )/.test(l) && /\[(\?|illisible|\+)/.test(l));
		expect(examples.length).toBeGreaterThanOrEqual(3);
		for (const line of examples) expect(() => parse(line, { version: '1.2' }), line).not.toThrow();
	});
});
