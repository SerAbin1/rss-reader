// Service worker registration and connectivity state, the two things the app
// needs to know about its PWA layer.
//
// Deliberately small and DOM-free apart from `window`/`navigator`: the
// registration is a side effect the page scripts trigger, and the connectivity
// signal is just `navigator.onLine` plus its two events, so neither needs a
// framework or a test harness to be obvious.

const serviceWorkerUrl = "/sw.js";

// Registers the worker, if this build produced one and the browser runs them.
// Astro's dev server serves unbundled modules, and a worker caching those would
// hand back stale code for as long as its cache version — so dev is a no-op.
// To exercise the worker for real: `pnpm build`, then `pnpm pages:dev`, which
// serves the same dist/ that gets deployed.
export function registerServiceWorker(): void {
	if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

	// Waiting for load keeps the worker's install fetch (the precache list)
	// off the critical path of the first paint, which for this app is the one
	// moment it gets to be fast.
	window.addEventListener("load", () => {
		void navigator.serviceWorker
			.register(serviceWorkerUrl, { scope: "/" })
			.catch((err) => {
				// Nothing here is load-bearing: without a worker the app still
				// works, it just can't be launched offline. Worth a console
				// entry, not a banner.
				console.error("Service worker registration failed.", err);
			});
	});
}

// `navigator.onLine` is a hint, not a guarantee — a connected-to-nothing
// hotspot still reports true — so this is for telling the user what to expect,
// never for deciding whether to try a request.
export function isOnline(): boolean {
	return navigator.onLine;
}

export function onConnectivityChange(handler: (online: boolean) => void): void {
	window.addEventListener("online", () => handler(true));
	window.addEventListener("offline", () => handler(false));
}
