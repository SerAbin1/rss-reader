// Thin HTTP layer over /api/sync. No DOM and no IndexedDB — the caller owns
// both — so this stays testable with nothing but a stubbed fetch, same split as
// the rest of src/lib.

import type { Feed } from "./db";
import type { SyncedFeed } from "./sync-state";

export class SyncError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

async function request<T>(
	path: string,
	token: string,
	init?: RequestInit,
): Promise<T> {
	const res = await fetch(`/api/sync/${path}`, {
		...init,
		headers: {
			...init?.headers,
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
	});
	if (!res.ok) {
		throw new SyncError(`sync/${path} failed (${res.status})`, res.status);
	}
	return (await res.json()) as T;
}

export async function pullWatermark(token: string): Promise<string | null> {
	const body = await request<{ lastReadAt: string | null }>("state", token);
	return body.lastReadAt;
}

// Returns the value that actually won, which is not necessarily what was sent:
// the server applies max(), so a push carrying a lower watermark comes back
// with the stored higher one.
export async function pushWatermark(
	token: string,
	lastReadAt: string,
): Promise<string | null> {
	const body = await request<{ lastReadAt: string | null }>("state", token, {
		method: "POST",
		body: JSON.stringify({ lastReadAt }),
	});
	return body.lastReadAt;
}

export async function pullFeeds(token: string): Promise<SyncedFeed[]> {
	const body = await request<{ feeds: SyncedFeed[] }>("feeds", token);
	return body.feeds;
}

// Pushes explicit additions and removals, never the whole local list — the
// server stamps every change with its own clock, so a replayed full set would
// outrank and undo the group's deletions.
export async function pushFeedChanges(
	token: string,
	added: Feed[],
	removed: string[] = [],
): Promise<SyncedFeed[]> {
	const feeds = [
		...added.map((feed) => ({ feedUrl: feed.feedUrl, title: feed.title })),
		...removed.map((feedUrl) => ({ feedUrl, deleted: true })),
	];
	const body = await request<{ feeds: SyncedFeed[] }>("feeds", token, {
		method: "POST",
		body: JSON.stringify({ feeds }),
	});
	return body.feeds;
}

export interface PairResponse {
	groupId: string;
	pairCode: string;
	expiresAt: number;
	// Present only when this call created a brand-new group (no token sent, or
	// a token that didn't resolve to one) — absent when it issued a fresh code
	// for the caller's existing group, since that device already has one.
	deviceToken?: string;
}

// Unlike every other sync call, the token here is optional: pairing is how a
// device gets a token in the first place. `lastReadAt` seeds a new group with
// this device's own reading history so opting into sync doesn't throw it
// away; it's ignored when a token is sent, since that group already has one.
export async function startPairing(
	token: string | null,
	lastReadAt: string | null,
): Promise<PairResponse> {
	const res = await fetch("/api/sync/pair", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(token === null ? {} : { Authorization: `Bearer ${token}` }),
		},
		body: JSON.stringify({ lastReadAt }),
	});
	const body = (await res.json()) as PairResponse & { error?: string };
	if (!res.ok) {
		throw new SyncError(body.error ?? `sync/pair failed (${res.status})`, res.status);
	}
	return body;
}

// Unauthenticated by design — the code itself is the credential, and it is
// spent by this call. Doesn't return the group's feeds/watermark: the caller
// stores the token and lets the normal reconcile-on-load pick those up,
// rather than duplicating that convergence here.
export async function claimPairCode(code: string): Promise<{ deviceToken: string }> {
	const res = await fetch("/api/sync/claim", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ code }),
	});
	const body = (await res.json()) as { deviceToken?: string; error?: string };
	if (!res.ok || body.deviceToken === undefined) {
		throw new SyncError(body.error ?? `sync/claim failed (${res.status})`, res.status);
	}
	return { deviceToken: body.deviceToken };
}
