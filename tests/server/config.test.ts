import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/lib/server/config';

let root: string;
let vault: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'rv-config-'));
	vault = join(root, 'vault');
	mkdirSync(join(vault, 'recipes'), { recursive: true });
	mkdirSync(join(root, 'home/.config/recipevault'), { recursive: true });
	mkdirSync(join(root, 'repo'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const write = (rel: string, data: unknown) => writeFileSync(join(root, rel), JSON.stringify(data));
const load = (env: Record<string, string> = {}) => loadConfig({ env, home: join(root, 'home'), cwd: join(root, 'repo') });

describe('config', () => {
	it('looks up RECIPEVAULT_CONFIG, then ~/.config, then ./config.json', () => {
		write('repo/config.json', { vault_directory: vault, port: 1 });
		expect(load().port).toBe(1);
		write('home/.config/recipevault/config.json', { vault_directory: vault, port: 2 });
		expect(load().port).toBe(2);
		write('explicit.json', { vault_directory: vault, port: 3 });
		expect(load({ RECIPEVAULT_CONFIG: join(root, 'explicit.json') }).port).toBe(3);
	});

	it('applies defaults and RECIPEVAULT_PORT', () => {
		write('repo/config.json', { vault_directory: vault });
		const c = load({ RECIPEVAULT_PORT: '3399' });
		expect(c).toMatchObject({ vaultDirectory: vault, port: 3399, host: '0.0.0.0', gitPush: true, hosts: [] });
		expect(load().port).toBe(3370);
	});

	it('refuses a missing config, a missing or non-existent vault_directory, a folder that is not a vault', () => {
		expect(() => load()).toThrow(ConfigError);
		write('repo/config.json', {});
		expect(() => load()).toThrow(/vault_directory" is missing/);
		write('repo/config.json', { vault_directory: join(root, 'typo') });
		expect(() => load()).toThrow(/does not exist.*vault init/);
		write('repo/config.json', { vault_directory: join(root, 'repo') });
		expect(() => load()).toThrow(/not a vault/);
		expect(() => load({ RECIPEVAULT_CONFIG: join(root, 'nope.json') })).toThrow(/does not exist/);
	});

	it('reads extra hosts, and refuses a hosts value that is not a list of names', () => {
		write('repo/config.json', { vault_directory: vault, hosts: ['recettes.maison.lan'] });
		expect(load().hosts).toEqual(['recettes.maison.lan']);
		write('repo/config.json', { vault_directory: vault, hosts: 'recettes.maison.lan' });
		expect(() => load()).toThrow(/"hosts"/);
		write('repo/config.json', { vault_directory: vault, hosts: [''] });
		expect(() => load()).toThrow(/"hosts"/);
	});
});
