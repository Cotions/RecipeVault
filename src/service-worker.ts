/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Offline kitchen mode (PLANNING.md): the app shell is cached on install;
// each recipe opened in kitchen mode (page, data, photo) is cached as it is
// fetched, so the kitchen's weak wifi cannot take the recipe away mid-cook.
// Everything else goes to the network, falling back to a cached copy.

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const SHELL = `shell-${version}`;
const KITCHEN = 'kitchen-v1';
const ASSETS = [...build, ...files];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(SHELL)
			.then((c) => c.addAll(ASSETS))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k))))
			.then(() => sw.clients.claim())
	);
});

const isKitchen = (url: URL) =>
	/^\/r\/[a-z0-9-]+\/cuisine(?:\/__data\.json)?$/.test(url.pathname) || url.pathname.startsWith('/media/');

sw.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;
	const url = new URL(req.url);
	if (url.origin !== sw.location.origin) return;

	if (ASSETS.includes(url.pathname)) {
		event.respondWith(caches.match(url.pathname).then((hit) => hit ?? fetch(req)));
		return;
	}

	event.respondWith(
		(async () => {
			try {
				const res = await fetch(req);
				if (res.ok && isKitchen(url)) {
					const copy = res.clone();
					caches.open(KITCHEN).then((c) => c.put(req, copy));
				}
				return res;
			} catch (e) {
				const hit = await caches.match(req, { ignoreSearch: isKitchen(url) });
				if (hit) return hit;
				throw e;
			}
		})()
	);
});
