// Fresh fixture vault in /tmp, then the built app on it.
import { makeFixtureVault } from '../../scripts/fixture-vault';

const port = Number(process.argv[2] ?? 3398);
process.env.RECIPEVAULT_CONFIG = await makeFixtureVault('/tmp/rv-e2e', port);
await import('../../bin/serve.js');
