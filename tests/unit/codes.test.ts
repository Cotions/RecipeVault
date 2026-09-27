import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODE_FIXERS, fixerOf } from '../../src/lib/vault/codes';

/** Code → fixer, from the "Fixed by" column of docs/VALIDATION.md. */
function docFixers(): Record<string, string> {
	const doc = readFileSync('docs/VALIDATION.md', 'utf8');
	const out: Record<string, string> = {};
	for (const m of doc.matchAll(/^\| ([EWI]\d{3}) \| (\w+) \|/gm)) out[m[1]] = m[2];
	return out;
}

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []
	);
}

describe('who fixes each code', () => {
	it('matches the Fixed by column of VALIDATION.md exactly', () => {
		expect(CODE_FIXERS).toEqual(docFixers());
	});

	it('every code the checker can emit has a fixer', () => {
		const emitted = new Set<string>();
		for (const f of sourceFiles('src/lib/vault')) {
			if (f.endsWith('codes.ts') || f.endsWith('deferred.ts')) continue;
			for (const m of readFileSync(f, 'utf8').matchAll(/'([EWI]\d{3})'/g)) emitted.add(m[1]);
		}
		expect(emitted.size).toBeGreaterThan(40);
		expect([...emitted].filter((c) => !(c in CODE_FIXERS))).toEqual([]);
	});

	it('keeps the codes the app settles away from the AI', () => {
		for (const c of ['E103', 'W306', 'W503', 'W608', 'W501', 'W502']) expect(fixerOf(c)).toBe('app');
		expect(fixerOf('E201')).toBe('ai');
		expect(fixerOf('X999')).toBe('app');
	});
});
