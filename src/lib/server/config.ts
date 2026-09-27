// App configuration. Lookup order: RECIPEVAULT_CONFIG, then
// ~/.config/recipevault/config.json, then config.json at the repo root
// (gitignored). RECIPEVAULT_PORT overrides the port.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export interface GitAuthor {
	name: string;
	email: string;
}

export interface Config {
	/** Where the config was read from. */
	file: string;
	vaultDirectory: string;
	port: number;
	host: string;
	gitAuthor: GitAuthor;
	gitPush: boolean;
	/** Extra host names the app is reached on, besides the defaults (see hosts.ts). */
	hosts: string[];
}

export class ConfigError extends Error {}

export interface ConfigEnv {
	env?: Record<string, string | undefined>;
	home?: string;
	cwd?: string;
}

const DEFAULT_PORT = 3370;
const DEFAULT_HOST = '0.0.0.0';

/** The config file to read, or undefined when none of the candidates exists. */
export function findConfig({ env = process.env, home = homedir(), cwd = process.cwd() }: ConfigEnv = {}): string | undefined {
	if (env.RECIPEVAULT_CONFIG) {
		const f = resolve(cwd, env.RECIPEVAULT_CONFIG);
		if (!existsSync(f)) throw new ConfigError(`RECIPEVAULT_CONFIG points at ${f}, which does not exist.`);
		return f;
	}
	for (const f of [join(home, '.config/recipevault/config.json'), join(cwd, 'config.json')]) {
		if (existsSync(f)) return f;
	}
	return undefined;
}

/**
 * Load and validate the config. A missing or non-existent `vault_directory` is
 * an error: never create an empty vault silently — a typo in the path would
 * look exactly like losing every recipe. `vault init` creates vaults.
 */
export function loadConfig(opts: ConfigEnv = {}): Config {
	const env = opts.env ?? process.env;
	const file = findConfig(opts);
	if (!file)
		throw new ConfigError(
			'no config found. Create ~/.config/recipevault/config.json (or set RECIPEVAULT_CONFIG) with at least {"vault_directory": "/path/to/vault"}.'
		);
	let raw: Record<string, unknown>;
	try {
		raw = JSON.parse(readFileSync(file, 'utf8'));
	} catch (e) {
		throw new ConfigError(`${file} is not valid JSON: ${(e as Error).message}`);
	}
	const dir = raw.vault_directory;
	if (typeof dir !== 'string' || !dir.trim()) throw new ConfigError(`${file}: "vault_directory" is missing.`);
	if (!isAbsolute(dir)) throw new ConfigError(`${file}: "vault_directory" must be an absolute path, got "${dir}".`);
	if (!existsSync(dir) || !statSync(dir).isDirectory())
		throw new ConfigError(`${file}: vault_directory ${dir} does not exist. Create a vault with \`vault init ${dir}\`.`);
	if (!existsSync(join(dir, 'recipes')))
		throw new ConfigError(`${dir} is not a vault (no recipes/ folder). Create one with \`vault init ${dir}\`.`);

	const portEnv = env.RECIPEVAULT_PORT;
	const port = portEnv ? Number(portEnv) : raw.port === undefined ? DEFAULT_PORT : Number(raw.port);
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigError(`invalid port: ${portEnv ?? String(raw.port)}`);

	const author = raw.git_author as Partial<GitAuthor> | undefined;
	const gitAuthor: GitAuthor = {
		name: typeof author?.name === 'string' && author.name ? author.name : 'RecipeVault',
		email: typeof author?.email === 'string' && author.email ? author.email : 'recipevault@localhost'
	};
	const hosts = raw.hosts ?? [];
	if (!Array.isArray(hosts) || hosts.some((h) => typeof h !== 'string' || !h.trim()))
		throw new ConfigError(`${file}: "hosts" must be a list of host names, like ["recettes.example.lan"].`);
	return {
		file,
		vaultDirectory: resolve(dir),
		port,
		host: typeof raw.host === 'string' && raw.host ? raw.host : DEFAULT_HOST,
		gitAuthor,
		gitPush: raw.git_push !== false,
		hosts: hosts as string[]
	};
}
