// The service worker, for an installed, offline-capable shell.
//
// This is the source; `astro:build:done` copies it to dist/sw.js with the
// precache placeholder below filled in with the build's actual asset list and a
// version derived from those assets' contents (see scripts/precache.mjs). It is
// not served from src/ — only the emitted dist/sw.js is registered, so the file
// you edit is never a half-substituted one that a browser could install.
//
// Plain JavaScript and no imports on purpose: a worker runs before any bundler
// is in the picture, and this app's caching policy is a few rules, not a
// framework.

const PRECACHE = __PRECACHE__;

const CACHE_PREFIX = "rss-reader-";
const PRECACHE_CACHE = `${CACHE_PREFIX}precache-${PRECACHE.version}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${PRECACHE.version}`;

// Served network-first and cached at runtime rather than precached, so a deploy
// that changes the curated feed list is picked up on the next load instead of
// whenever the cache version happens to change.
const CURATED_FEEDS_PATH = "/curated-feeds.opml";

self.addEventListener("install", (event) => {
	event.waitUntil(precacheAndActivate());
});

self.addEventListener("activate", (event) => {
	event.waitUntil(deleteSupersededCaches());
});

self.addEventListener("fetch", (event) => {
	const request = event.request;
	const url = new URL(request.url);

	// Everything below is a same-origin GET, and nothing else. That covers the
	// sync endpoints' POSTs, which must never be answered from a cache: a
	// replayed watermark push or feed change would quietly rewrite the group
	// from a stale request. It also covers /api/feed — posts are meant to be
	// live, and a cached feed body is a feed body that never updates. Both
	// already fail cleanly when the network is gone, which is a far better
	// outcome than a stale one.
	if (request.method !== "GET") return;
	if (url.origin !== self.location.origin) return;
	if (url.pathname.startsWith("/api/")) return;

	event.respondWith(respond(request, url));
});

async function precacheAndActivate() {
	const cache = await caches.open(PRECACHE_CACHE);
	await cache.addAll(PRECACHE.assets);
	// Take over immediately rather than waiting for every tab to close: this
	// app is a single page with no in-flight writes to lose, and the alternative
	// is a deploy that a long-lived tab can keep serving the old shell of.
	await self.skipWaiting();
}

async function deleteSupersededCaches() {
	const names = await caches.keys();
	await Promise.all(
		names
			.filter(
				(name) =>
					name.startsWith(CACHE_PREFIX) &&
					name !== PRECACHE_CACHE &&
					name !== RUNTIME_CACHE,
			)
			.map((name) => caches.delete(name)),
	);
	// Take over pages that were already open when this worker activated.
	await self.clients.claim();
}

async function respond(request, url) {
	// A navigation is answered from the precache first, so launching the
	// installed app is instant and needs no network. It's never stale: each
	// build replaces the whole precache under a new version, and the asset URLs
	// it references are content-hashed, so the document and the script it
	// points at are always the same build.
	if (request.mode === "navigate") return respondToNavigation(request, url);

	const cached = await matchPrecache(url.pathname);
	if (cached !== null) return cached;

	if (url.pathname === CURATED_FEEDS_PATH) return networkFirst(request);

	return fetch(request);
}

async function respondToNavigation(request, url) {
	// The directory itself first ("/" or "/pair/" — both are precache entries),
	// then the document behind it, then the main page as a last resort so an
	// unknown in-app path still opens the app rather than the browser's offline
	// error page.
	const candidates = [
		url.pathname,
		`${url.pathname.replace(/\/$/, "")}/index.html`,
		"/index.html",
	];
	for (const candidate of candidates) {
		const cached = await matchPrecache(candidate);
		if (cached !== null) return cached;
	}
	return fetch(request);
}

async function matchPrecache(pathname) {
	const cache = await caches.open(PRECACHE_CACHE);
	return (await cache.match(pathname)) ?? null;
}

async function networkFirst(request) {
	const cache = await caches.open(RUNTIME_CACHE);
	try {
		const response = await fetch(request);
		// Only keep responses worth replaying: caching a 404 or a 500 would
		// make the failure outlive the deploy that caused it.
		if (response.ok) await cache.put(request, response.clone());
		return response;
	} catch (err) {
		const cached = await cache.match(request);
		if (cached !== undefined) return cached;
		throw err;
	}
}
