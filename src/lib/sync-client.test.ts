import { afterEach, describe, expect, it, vi } from "vitest";
import {
	claimPairCode,
	pullFeeds,
	pullWatermark,
	pushFeedChanges,
	pushWatermark,
	startPairing,
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

describe("startPairing", () => {
	it("omits the Authorization header when there is no token yet", async () => {
		const fetchMock = stubFetch({
			groupId: "g1",
			pairCode: "ABCDEFGHJK",
			expiresAt: 2000,
			deviceToken: "tok",
		});
		await startPairing(null, WED);

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("/api/sync/pair");
		expect(init.headers.Authorization).toBeUndefined();
		expect(sentBody(fetchMock)).toEqual({ lastReadAt: WED });
	});

	it("sends the device token as a bearer credential when re-pairing", async () => {
		const fetchMock = stubFetch({
			groupId: "g1",
			pairCode: "ABCDEFGHJK",
			expiresAt: 2000,
		});
		const result = await startPairing("tok", null);

		expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
		// Re-pairing an already-paired device issues a code for its existing
		// group rather than a new token — nothing for the caller to store.
		expect(result.deviceToken).toBeUndefined();
	});

	it("throws the server's message on a rejected token", async () => {
		stubFetch({ error: "Unknown device token." }, 401);
		await expect(startPairing("bad", null)).rejects.toMatchObject({
			status: 401,
			message: "Unknown device token.",
		});
	});
});

describe("claimPairCode", () => {
	it("sends no Authorization header — the code itself is the credential", async () => {
		const fetchMock = stubFetch({ deviceToken: "tok" });
		await claimPairCode("ABCDE-FGHJK");

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("/api/sync/claim");
		expect(init.headers.Authorization).toBeUndefined();
		expect(sentBody(fetchMock)).toEqual({ code: "ABCDE-FGHJK" });
	});

	it("returns the new device token", async () => {
		stubFetch({ deviceToken: "tok" });
		expect(await claimPairCode("ABCDE-FGHJK")).toEqual({ deviceToken: "tok" });
	});

	it("throws the server's message on an expired or already-claimed code", async () => {
		stubFetch({ error: "That pairing code is not valid any more." }, 410);
		await expect(claimPairCode("ABCDE-FGHJK")).rejects.toMatchObject({
			status: 410,
			message: "That pairing code is not valid any more.",
		});
	});
});
