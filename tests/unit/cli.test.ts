import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
});
