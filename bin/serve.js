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
	// adapter-node refuses bodies over 512 KB by default; a phone photo is up to
	// 25 MB (plan 04, Q12 A), plus the multipart envelope. /api/photo enforces the cap itself.
	process.env.BODY_SIZE_LIMIT ??= '26M';
} catch (e) {
	console.error(`recipevault: ${e instanceof ConfigError ? e.message : e}`);
	process.exit(1);
}
// A computed specifier, so type-checking does not pull the build output in.
await import(new URL('../build/index.js', import.meta.url).href);
