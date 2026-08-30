import { afterEach, describe, expect, it, vi } from "vitest";
import {
	pullFeeds,
	pullWatermark,
	pushFeedChanges,
	pushWatermark,
	SyncError,
} from "./sync-client";

const FRI = "2026-01-09T00:00:00.000Z";
const WED = "2026-01-07T00:00:00.000Z";

function stubFetch(body: unknown, status = 200) {
	const fetchMock = vi.fn().mockResolvedValue(
		new Response(JSON.stringify(body), { status }),
	);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>): unknown {
	return JSON.parse(fetchMock.mock.calls[0][1].body);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("pullWatermark", () => {
	it("sends the device token as a bearer credential", async () => {
		const fetchMock = stubFetch({ lastReadAt: FRI });
		await pullWatermark("tok");

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("/api/sync/state");
		expect(init.headers.Authorization).toBe("Bearer tok");
	});

	it("throws with the status attached on a rejected token", async () => {
		stubFetch({ error: "Unknown device token." }, 401);
		await expect(pullWatermark("bad")).rejects.toMatchObject({ status: 401 });
		await expect(pullWatermark("bad")).rejects.toBeInstanceOf(SyncError);
	});
});

describe("pushWatermark", () => {
	it("returns the value that won, not the one that was sent", async () => {
		// The server applies max(), so pushing a lower watermark comes back with
		// the stored higher one — the caller must adopt it.
		stubFetch({ lastReadAt: FRI });
		expect(await pushWatermark("tok", WED)).toBe(FRI);
	});
});

describe("pushFeedChanges", () => {
	it("sends additions and removals in one request", async () => {
		const fetchMock = stubFetch({ feeds: [] });
		await pushFeedChanges("tok", [{ feedUrl: "a", title: "A" }], ["b"]);

		expect(sentBody(fetchMock)).toEqual({
			feeds: [
				{ feedUrl: "a", title: "A" },
				{ feedUrl: "b", deleted: true },
			],
		});
	});

	it("sends only feedUrl and title, never local-only fields", async () => {
		// siteUrl is discovered per device from the feed itself; pushing it would
		// make one device's parse result the group's truth for no reason.
		const fetchMock = stubFetch({ feeds: [] });
		await pushFeedChanges("tok", [
			{ feedUrl: "a", title: "A", siteUrl: "https://a.example" },
		]);

		expect(sentBody(fetchMock)).toEqual({ feeds: [{ feedUrl: "a", title: "A" }] });
	});
});

describe("pullFeeds", () => {
	it("returns the group's feed set including tombstones", async () => {
		stubFetch({
			feeds: [
				{ feedUrl: "a", title: "A", updatedAt: 1, deletedAt: null },
				{ feedUrl: "b", title: "B", updatedAt: 2, deletedAt: 2 },
			],
		});
		const feeds = await pullFeeds("tok");
		expect(feeds).toHaveLength(2);
		expect(feeds[1].deletedAt).toBe(2);
	});
});
