#!/usr/bin/env node
// Prints the address the app listens on from this machine, read from the
// config: `http://localhost:3370`. For run.sh and the installed launcher.
import { register } from 'tsx/esm/api';

register();
const { loadConfig, ConfigError } = await import('../src/lib/server/config.ts');
try {
	console.log(`http://localhost:${loadConfig().port}`);
} catch (e) {
	console.error(`recipevault: ${e instanceof ConfigError ? e.message : e}`);
	process.exit(1);
}
