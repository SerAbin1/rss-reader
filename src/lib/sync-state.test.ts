import { describe, expect, it } from "vitest";
import {
	isPairCodeUsable,
	liveFeeds,
	mergeFeeds,
	mergeWatermark,
	type SyncedFeed,
} from "./sync-state";

const WED = "2026-01-07T00:00:00.000Z";
const FRI = "2026-01-09T00:00:00.000Z";

function feed(overrides: Partial<SyncedFeed> & { feedUrl: string }): SyncedFeed {
	return {
		title: overrides.feedUrl,
		updatedAt: 1000,
		deletedAt: null,
		...overrides,
	};
}

describe("mergeWatermark", () => {
	it("takes the later of two watermarks", () => {
		expect(mergeWatermark(WED, FRI)).toBe(FRI);
	});

	it("does not let a stale device rewind a fresher one", () => {
		// The whole reason this isn't last-writer-wins: the phone last synced
		// Wednesday, the laptop has read to Friday, and the phone writes last.
		expect(mergeWatermark(FRI, WED)).toBe(FRI);
	});

	it("treats null as 'nothing read yet'", () => {
		expect(mergeWatermark(null, WED)).toBe(WED);
		expect(mergeWatermark(WED, null)).toBe(WED);
		expect(mergeWatermark(null, null)).toBeNull();
	});

	it("is idempotent, so a duplicate push is a no-op", () => {
		expect(mergeWatermark(FRI, FRI)).toBe(FRI);
		expect(mergeWatermark(mergeWatermark(WED, FRI), FRI)).toBe(FRI);
	});

	it("is commutative, so reconnection order doesn't matter", () => {
		expect(mergeWatermark(WED, FRI)).toBe(mergeWatermark(FRI, WED));
	});
});

describe("isPairCodeUsable", () => {
	it("accepts an unclaimed, unexpired code", () => {
		expect(isPairCodeUsable({ expiresAt: 2000, claimedAt: null }, 1000)).toBe(
			true,
		);
	});

	it("rejects a code that has already been redeemed", () => {
		expect(isPairCodeUsable({ expiresAt: 2000, claimedAt: 1500 }, 1000)).toBe(
			false,
		);
	});

	it("rejects an expired code", () => {
		expect(isPairCodeUsable({ expiresAt: 2000, claimedAt: null }, 3000)).toBe(
			false,
		);
	});

	it("rejects a code at the exact instant it expires", () => {
		expect(isPairCodeUsable({ expiresAt: 2000, claimedAt: null }, 2000)).toBe(
			false,
		);
	});
});

describe("mergeFeeds", () => {
	it("unions feeds only one side knows about", () => {
		const merged = mergeFeeds([feed({ feedUrl: "a" })], [feed({ feedUrl: "b" })]);
		expect(merged.map((f) => f.feedUrl).sort()).toEqual(["a", "b"]);
	});

	it("keeps the more recently updated record for the same feed", () => {
		const merged = mergeFeeds(
			[feed({ feedUrl: "a", title: "old", updatedAt: 1000 })],
			[feed({ feedUrl: "a", title: "new", updatedAt: 2000 })],
		);
		expect(merged).toHaveLength(1);
		expect(merged[0].title).toBe("new");
	});

	it("propagates a deletion instead of resurrecting the feed", () => {
		// The failure this exists to prevent: without tombstones, the device
		// that still has the feed simply re-adds it on the next merge.
		const merged = mergeFeeds(
			[feed({ feedUrl: "a", updatedAt: 1000 })],
			[feed({ feedUrl: "a", updatedAt: 2000, deletedAt: 2000 })],
		);
		expect(merged[0].deletedAt).toBe(2000);
	});

	it("lets a later re-add win over an earlier deletion", () => {
		const merged = mergeFeeds(
			[feed({ feedUrl: "a", updatedAt: 1000, deletedAt: 1000 })],
			[feed({ feedUrl: "a", updatedAt: 2000 })],
		);
		expect(merged[0].deletedAt).toBeNull();
	});

	it("breaks an exact timestamp tie the same way in both directions", () => {
		// Same millisecond off one server clock is possible. If the tiebreak
		// depended on argument order the two devices would converge on
		// different answers, which is the one thing this merge must never do.
		const live = feed({ feedUrl: "a", updatedAt: 1000 });
		const dead = feed({ feedUrl: "a", updatedAt: 1000, deletedAt: 1000 });
		expect(mergeFeeds([live], [dead])[0].deletedAt).toBe(1000);
		expect(mergeFeeds([dead], [live])[0].deletedAt).toBe(1000);
	});

	it("is idempotent", () => {
		const feeds = [feed({ feedUrl: "a" }), feed({ feedUrl: "b" })];
		expect(mergeFeeds(feeds, feeds)).toHaveLength(2);
	});
});

describe("liveFeeds", () => {
	it("drops tombstones and strips the sync bookkeeping", () => {
		const live = liveFeeds([
			feed({ feedUrl: "a", title: "A" }),
			feed({ feedUrl: "b", updatedAt: 2000, deletedAt: 2000 }),
		]);
		expect(live).toEqual([{ feedUrl: "a", title: "A" }]);
	});
});
