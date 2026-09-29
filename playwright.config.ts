import { defineConfig, devices } from '@playwright/test';
import { STATE } from './tests/e2e/state';

// End-to-end tests against the built app and a throwaway copy of the
// invented fixture vault (tests/e2e/serve.ts). Screenshots stay in /tmp.
const PORT = 3398;

export default defineConfig({
	testDir: 'tests/e2e',
	fullyParallel: false,
	workers: 1,
	outputDir: '/tmp/rv-e2e-results',
	reporter: 'list',
	use: {
		baseURL: `http://127.0.0.1:${PORT}`,
		screenshot: 'off',
		trace: 'off'
	},
	projects: [
		// Signs the invented owner account in once; the other projects start signed in (plan 04, Phase 1).
		{ name: 'setup', testMatch: /auth\.setup\.ts/ },
		{
			name: 'desktop',
			use: { ...devices['Desktop Chrome'], permissions: ['clipboard-read', 'clipboard-write'], storageState: STATE },
			testIgnore: /kitchen|auth\.spec/,
			dependencies: ['setup']
		},
		{ name: 'phone', use: { ...devices['Pixel 7'], storageState: STATE }, testMatch: /kitchen|auth\.spec|form\.spec/, dependencies: ['setup'] },
		{ name: 'tablet', use: { ...devices['Galaxy Tab S9'], storageState: STATE }, testMatch: /kitchen|form\.spec/, dependencies: ['setup'] }
	],
	webServer: {
		command: `npm run build && npx tsx tests/e2e/serve.ts ${PORT}`,
		url: `http://127.0.0.1:${PORT}/`,
		timeout: 180_000,
		reuseExistingServer: false,
		stdout: 'ignore'
	}
});
