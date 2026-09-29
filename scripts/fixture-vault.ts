// A throwaway vault holding a copy of tests/fixtures/vault (all invented),
// plus a config pointing at it. For trying the app and for the e2e tests:
//
//   npx tsx scripts/fixture-vault.ts /tmp/rv-demo [port]
//   RECIPEVAULT_CONFIG=/tmp/rv-demo/config.json npm run dev
//
// With --corpus: the invented card corpus (tests/fixtures/corpus/recipes, 320
// recipes), the seed registry and the corpus prices instead — realistic data
// for the resolve queue, the ingredient pages and pantry search (plan 03).
//
//   npx tsx scripts/fixture-vault.ts /tmp/rv-corpus 3399 --corpus
//
// Next to the config, a users.json with two invented accounts (plan 04,
// Phase 1): FIXTURE_USERS below, passwords included — throwaway test data.

import { cpSync, existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { commitPaths } from '../src/lib/server/git';
import { initVault } from '../src/lib/server/vault';
import { hashPassword, usersPath, writeUsers } from '../src/lib/server/users';

/** Invented accounts: the owner with the Markdown tools, and a cook without them (plan 04, Q2 B). */
export const FIXTURE_USERS = {
	owner: { login: 'proprio', name: 'Proprio Inventé', email: 'proprio@example.invalid', password: 'proprio-mot-de-passe', markdown: true },
	cook: { login: 'cuisine', name: 'Cuisinière Inventée', password: 'cuisine-mot-de-passe', markdown: false }
};

export async function makeFixtureVault(root: string, port = 3399, { corpus = false } = {}): Promise<string> {
	const dir = resolve(root);
	if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
	const vault = join(dir, 'vault');
	const author = { name: 'Fixture', email: 'fixture@example.invalid' };
	if (corpus) {
		await initVault(vault, readFileSync('docs/VOCAB.md', 'utf8'), author, readFileSync('docs/INGREDIENTS-SEED.yaml', 'utf8'));
		cpSync('tests/fixtures/corpus/recipes', join(vault, 'recipes'), { recursive: true });
		cpSync('tests/fixtures/prices/corpus.csv', join(vault, 'prices.csv'));
	} else {
		await initVault(vault, readFileSync('docs/VOCAB.md', 'utf8'), author);
		for (const d of ['recipes', 'ingredients', 'media']) cpSync(join('tests/fixtures/vault', d), join(vault, d), { recursive: true });
		cpSync('tests/fixtures/vault/prices.csv', join(vault, 'prices.csv'));
	}
	await commitPaths(vault, ['recipes', 'ingredients', 'prices.csv'], 'fixtures', author);
	const config = join(dir, 'config.json');
	writeFileSync(config, JSON.stringify({ vault_directory: vault, port, host: '127.0.0.1', git_author: author, git_push: false }, null, 2));
	writeUsers(
		usersPath(config),
		await Promise.all(
			Object.values(FIXTURE_USERS).map(async ({ password, markdown, ...u }) => ({ ...u, ...(markdown ? { markdown } : {}), hash: await hashPassword(password) }))
		)
	);
	return config;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const args = process.argv.slice(2).filter((a) => a !== '--corpus');
	const config = await makeFixtureVault(args[0] ?? '/tmp/rv-demo', Number(args[1] ?? 3399), { corpus: process.argv.includes('--corpus') });
	console.log(`RECIPEVAULT_CONFIG=${config}`);
	for (const u of Object.values(FIXTURE_USERS)) console.error(`account: ${u.login} / ${u.password}`);
}
