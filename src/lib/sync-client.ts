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
