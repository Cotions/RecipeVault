import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Self-hosted on the home network: a plain Node server (see docs/DEPLOY.md).
			adapter: adapter(),
			// The app is reached as http://<lan-host>:3370 and through Tailscale
			// HTTPS, so no single origin is right. hooks.server.ts checks instead
			// that a writing request's Origin names the host it was sent to.
			csrf: { trustedOrigins: ['*'] }
		})
	]
});
