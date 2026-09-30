import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so the tests do not load the SvelteKit plugin:
// the library under test is plain TypeScript.
export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		setupFiles: ['tests/setup/unit-words.ts'],
		passWithNoTests: true
	}
});
