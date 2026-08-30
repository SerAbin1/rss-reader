// Pure merge/validation logic for cross-device sync, kept separate from the D1
// queries in functions/api/sync/ and the DOM+IndexedDB wiring in app.ts, so it
// can be tested without a database or a browser — same split as read-state.ts.
// See the Obsidian decision log for why these particular merge rules.

import type { Feed } from "./db";

// Server-stamped, never client-stamped: with tombstones, feed membership is
// resolved by comparing timestamps, so a device with a skewed clock would win
// arguments it should lose. One clock, in the endpoint.
export interface SyncedFeed extends Feed {
	updatedAt: number; // epoch ms
	deletedAt: number | null; // tombstone; null = live
}

export interface PairCode {
	expiresAt: number; // epoch ms
	claimedAt: number | null; // null = not yet redeemed
}

// The reading watermark is monotonic, so max() is the whole conflict story.
// Not last-writer-wins: a device that last synced on Wednesday must not rewind
// one that has read to Friday. max() is commutative, associative and
// idempotent, which is what makes offline devices converge regardless of who
// reconnects first, and makes a duplicate push a no-op.
export function mergeWatermark(
	a: string | null,
	b: string | null,
): string | null {
	if (a === null) return b;
	if (b === null) return a;
	return a >= b ? a : b;
}

// Single-use and short-lived: a pair code is only ever exchangeable for a
// device token, never usable as one.
export function isPairCodeUsable(code: PairCode, now: number): boolean {
	return code.claimedAt === null && code.expiresAt > now;
}

// Displayed grouped (ABCDE-FGHJK) purely for human legibility — the server's
// normalizePairCode strips non-alphanumerics before hashing, so the hyphen
// carries no meaning to it and typing or pasting it back in is optional.
export function formatPairCode(code: string): string {
	return `${code.slice(0, 5)}-${code.slice(5)}`;
}

// Per-feed last-write-wins over the union of both sides, keyed by feedUrl.
// Unlike the watermark this is not a grow-only set — without tombstones a feed
// deleted on one device would be resurrected by the other on the next merge —
// so deletions travel as `deletedAt` records rather than as absent rows.
//
// Ties are broken in favour of the tombstone. Equal timestamps are possible
// (same millisecond, one server clock), and the tiebreak has to be independent
// of argument order or the merge stops being commutative and the two devices
// converge on different answers.
export function mergeFeeds(
	a: SyncedFeed[],
	b: SyncedFeed[],
): SyncedFeed[] {
	const merged = new Map<string, SyncedFeed>();
	for (const feed of [...a, ...b]) {
		const existing = merged.get(feed.feedUrl);
		if (existing === undefined || wins(feed, existing)) {
			merged.set(feed.feedUrl, feed);
		}
	}
	return [...merged.values()];
}

function wins(candidate: SyncedFeed, incumbent: SyncedFeed): boolean {
	if (candidate.updatedAt !== incumbent.updatedAt) {
		return candidate.updatedAt > incumbent.updatedAt;
	}
	return candidate.deletedAt !== null && incumbent.deletedAt === null;
}

// Tombstones stay in the synced set so deletions keep propagating, but the app
// only ever renders and fetches the live ones.
export function liveFeeds(feeds: SyncedFeed[]): Feed[] {
	return feeds
		.filter((feed) => feed.deletedAt === null)
		.map(({ feedUrl, title }) => ({ feedUrl, title }));
}
