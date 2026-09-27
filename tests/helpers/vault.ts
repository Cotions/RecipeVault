// Temporary vaults for server tests: `vault init` layout, git, fixed author.

import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openVault, type VaultContext } from '../../src/lib/server/context';
import { initVault } from '../../src/lib/server/vault';
import { commitPaths } from '../../src/lib/server/git';
import { syncVault } from '../../src/lib/server/index/sync';

export const AUTHOR = { name: 'Test Author', email: 'test@example.invalid' };
export const VOCAB_DOC = readFileSync('docs/VOCAB.md', 'utf8');

export interface TempVault {
	dir: string;
	ctx: VaultContext;
	git(...args: string[]): string;
	read(rel: string): string;
	cleanup(): void;
}

export async function tempVault(): Promise<TempVault> {
	const dir = join(mkdtempSync(join(tmpdir(), 'rv-test-')), 'vault');
	await initVault(dir, VOCAB_DOC, AUTHOR);
	const ctx = openVault({ root: dir, author: AUTHOR, log: () => {} });
	return {
		dir,
		ctx,
		git: (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }),
		read: (rel) => readFileSync(join(dir, rel), 'utf8'),
		cleanup() {
			ctx.db.close();
			rmSync(join(dir, '..'), { recursive: true, force: true });
		}
	};
}

/** A minimal valid recipe file. */
export function recipe(title: string, extra = '', body = '## Préparation\n\n1. Mélanger.\n'): string {
	return `---\nschema: 3\ntitle: ${title}\n${extra}ingredients:\n  - items:\n      - { qty: 1, unit: cup, name: farine }\nextracted_by: ai\n---\n\n${body}`;
}

/** A temp vault holding a copy of tests/fixtures/vault, committed and indexed. */
export async function fixtureVault(): Promise<TempVault> {
	const v = await tempVault();
	for (const d of ['recipes', 'ingredients', 'media']) cpSync(join('tests/fixtures/vault', d), join(v.dir, d), { recursive: true });
	cpSync('tests/fixtures/vault/prices.csv', join(v.dir, 'prices.csv'));
	await commitPaths(v.dir, ['recipes', 'ingredients', 'prices.csv'], 'fixtures', AUTHOR);
	syncVault(v.ctx.db, v.ctx.paths);
	return v;
}
