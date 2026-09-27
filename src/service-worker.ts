/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Offline kitchen mode (PLANNING.md): the app shell is cached on install;
// each recipe opened in kitchen mode (page, data, photo) is cached as it is
// fetched, so the kitchen's weak wifi cannot take the recipe away mid-cook.
// Entering kitchen mode from the recipe page is a client-side navigation that
// fetches only the page data, so the page's HTML is fetched and cached then
// too: a reload or a discarded tab offline still finds it. The kitchen cache
// goes with the build (its HTML points at that build's chunks); a new build
// re-fetches the kitchen pages it can and drops the old cache.
// Everything else goes to the network, falling back to a cached copy.

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const SHELL = `shell-${version}`;
const KITCHEN = `kitchen-${version}`;
const ASSETS = [...build, ...files];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(SHELL)
			.then((c) => c.addAll(ASSETS))
			.then(() => sw.skipWaiting())
	);
});

/** Carry the kitchen pages of an older build over to this one, fetched fresh; offline, they are lost with it. */
async function migrateKitchen(old: string) {
	const from = await caches.open(old);
	const to = await caches.open(KITCHEN);
	const reqs = (await from.keys()).slice(0, 200);
	await Promise.all(
		reqs.map(async (r) => {
			try {
				const res = await fetch(r.url, { credentials: 'same-origin' });
				if (res.ok) await to.put(r.url, res);
			} catch {
				// offline or gone
			}
		})
	);
}

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			const oldKitchens = keys.filter((k) => k.startsWith('kitchen-') && k !== KITCHEN);
			for (const k of oldKitchens) await migrateKitchen(k).catch(() => {});
			await Promise.all(keys.filter((k) => (k.startsWith('shell-') && k !== SHELL) || oldKitchens.includes(k)).map((k) => caches.delete(k)));
			await sw.clients.claim();
		})()
	);
});

const KITCHEN_PAGE = /^\/r\/[a-z0-9-]+\/cuisine(?:\/__data\.json)?$/;
const isKitchen = (url: URL) => KITCHEN_PAGE.test(url.pathname) || url.pathname.startsWith('/media/');

/** Cached under the path alone: ?portions and SvelteKit's data parameters do not make another page. */
const kitchenKey = (url: URL) => url.origin + url.pathname;

/** The kitchen page's data came through: fetch and keep its HTML too, for a reload offline. */
async function cacheKitchenDocument(dataUrl: URL) {
	const doc = new URL(dataUrl.pathname.replace(/\/__data\.json$/, ''), dataUrl.origin);
	try {
		const res = await fetch(doc, { credentials: 'same-origin', headers: { accept: 'text/html' } });
		if (res.ok) await (await caches.open(KITCHEN)).put(kitchenKey(doc), res);
	} catch {
		// offline: the data alone stays cached
	}
}

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
					event.waitUntil(caches.open(KITCHEN).then((c) => c.put(kitchenKey(url), copy)));
					if (url.pathname.endsWith('/__data.json')) event.waitUntil(cacheKitchenDocument(url));
				}
				return res;
			} catch (e) {
				const hit = await caches.match(req, isKitchen(url) ? { ignoreSearch: true, ignoreVary: true } : undefined);
				if (hit) return hit;
				throw e;
			}
		})()
	);
});
