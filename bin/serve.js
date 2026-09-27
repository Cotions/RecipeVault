#!/usr/bin/env node
// Production entry: read the config (host, port, vault) and start the built
// app (`npm run build` first). adapter-node reads HOST and PORT.
import { register } from 'tsx/esm/api';

register();
const { loadConfig, ConfigError } = await import('../src/lib/server/config.ts');
try {
	const config = loadConfig();
	process.env.PORT = String(config.port);
	process.env.HOST = config.host;
} catch (e) {
	console.error(`recipevault: ${e instanceof ConfigError ? e.message : e}`);
	process.exit(1);
}
// A computed specifier, so type-checking does not pull the build output in.
await import(new URL('../build/index.js', import.meta.url).href);
