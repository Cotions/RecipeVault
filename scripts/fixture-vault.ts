// A throwaway vault holding a copy of tests/fixtures/vault (all invented),
// plus a config pointing at it. For trying the app and for the e2e tests:
//
//   npx tsx scripts/fixture-vault.ts /tmp/rv-demo [port]
//   RECIPEVAULT_CONFIG=/tmp/rv-demo/config.json npm run dev

import { cpSync, existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { commitPaths } from '../src/lib/server/git';
import { initVault } from '../src/lib/server/vault';

export async function makeFixtureVault(root: string, port = 3399): Promise<string> {
	const dir = resolve(root);
	if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
	const vault = join(dir, 'vault');
	const author = { name: 'Fixture', email: 'fixture@example.invalid' };
	await initVault(vault, readFileSync('docs/VOCAB.md', 'utf8'), author);
	for (const d of ['recipes', 'ingredients', 'media']) cpSync(join('tests/fixtures/vault', d), join(vault, d), { recursive: true });
	cpSync('tests/fixtures/vault/prices.csv', join(vault, 'prices.csv'));
	await commitPaths(vault, ['recipes', 'ingredients', 'prices.csv'], 'fixtures', author);
	const config = join(dir, 'config.json');
	writeFileSync(config, JSON.stringify({ vault_directory: vault, port, host: '127.0.0.1', git_author: author, git_push: false }, null, 2));
	return config;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const config = await makeFixtureVault(process.argv[2] ?? '/tmp/rv-demo', Number(process.argv[3] ?? 3399));
	console.log(`RECIPEVAULT_CONFIG=${config}`);
}
