// Connectivity state, for telling the user why feeds are failing.
//
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
