import { describe, expect, it } from "vitest";
import { onRequestPost as claim } from "./claim";
import { fakeDb, sqlFor, type Reply } from "./_fake-db";
import {
	onRequestGet as feedsGet,
	onRequestPost as feedsPost,
} from "./feeds";
import { onRequestPost as pair } from "./pair";
import { normalizePairCode, randomPairCode } from "./_shared";
import {
	onRequestGet as stateGet,
	onRequestPost as statePost,
} from "./state";

const DEVICE = { id: "device-1", group_id: "group-1" };
const WED = "2026-01-07T00:00:00.000Z";
const FRI = "2026-01-09T00:00:00.000Z";

function post(body?: unknown, token?: string): Request {
	return new Request("http://localhost/api/sync/x", {
		method: "POST",
		headers: token ? { Authorization: `Bearer ${token}` } : {},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

function get(token?: string): Request {
	return new Request("http://localhost/api/sync/x", {
		headers: token ? { Authorization: `Bearer ${token}` } : {},
	});
}

// Resolves any device lookup to DEVICE, so a request with any bearer token is
// treated as authenticated.
function authed(extra: (sql: string) => Reply = () => ({})) {
	return (sql: string): Reply => {
		if (sql.includes("FROM device WHERE token_hash")) return { first: DEVICE };
		return extra(sql);
	};
}

describe("pair", () => {
	it("creates a group seeded with the device's local watermark", async () => {
		const { db, calls } = fakeDb(() => ({}));
		const res = await pair({ request: post({ lastReadAt: WED }), env: { DB: db } });
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.deviceToken).toEqual(expect.any(String));
		expect(body.pairCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
		// Opting into sync must not discard what this device had already read.
		expect(sqlFor(calls, "INSERT INTO sync_group")?.values[1]).toBe(WED);
	});

	it("stores only the hash of the token and the code, never the values", async () => {
		const { db, calls } = fakeDb(() => ({}));
		const body = await (
			await pair({ request: post({}), env: { DB: db } })
		).json();

		const deviceInsert = sqlFor(calls, "INSERT INTO device");
		const codeInsert = sqlFor(calls, "INSERT INTO pair_code");
		expect(deviceInsert?.values).not.toContain(body.deviceToken);
		expect(codeInsert?.values).not.toContain(body.pairCode);
		expect(deviceInsert?.values[2]).toMatch(/^[0-9a-f]{64}$/);
	});

	it("reuses the existing group when the device is already paired", async () => {
		const { db, calls } = fakeDb(authed());
		const res = await pair({ request: post({}, "tok"), env: { DB: db } });
		const body = await res.json();

		// The requirement this endpoint exists for: re-pairing lets another
		// device join, it does not fork a second group.
		expect(body.groupId).toBe("group-1");
		expect(sqlFor(calls, "INSERT INTO sync_group")).toBeUndefined();
		expect(body.deviceToken).toBeUndefined();
	});

	it("401s on an unrecognised token instead of starting a fresh group", async () => {
		// Falling through to "create a group" would look to the user like their
		// entire reading history had vanished.
		const { db, calls } = fakeDb(() => ({ first: null }));
		const res = await pair({ request: post({}, "revoked"), env: { DB: db } });

		expect(res.status).toBe(401);
		expect(sqlFor(calls, "INSERT INTO sync_group")).toBeUndefined();
	});
});

describe("claim", () => {
	const live = { group_id: "group-1", expires_at: 4e12, claimed_at: null };

	it("400s without a code", async () => {
		const { db } = fakeDb(() => ({}));
		expect((await claim({ request: post({}), env: { DB: db } })).status).toBe(400);
	});

	it("410s on an unknown code", async () => {
		const { db } = fakeDb(() => ({ first: null }));
		expect((await claim({ request: post({ code: "X" }), env: { DB: db } })).status).toBe(410);
	});

	it("410s on an expired code", async () => {
		const { db } = fakeDb(() => ({ first: { ...live, expires_at: 1 } }));
		expect((await claim({ request: post({ code: "X" }), env: { DB: db } })).status).toBe(410);
	});

	it("410s on a code that was already redeemed", async () => {
		const { db } = fakeDb(() => ({ first: { ...live, claimed_at: 123 } }));
		expect((await claim({ request: post({ code: "X" }), env: { DB: db } })).status).toBe(410);
	});

	it("410s and issues no token when it loses the claim race", async () => {
		// Two devices scanning the same QR at once both pass the validity check —
		// read and write are separate round trips. Only the conditional UPDATE
		// decides, so the loser must get nothing.
		const { db, calls } = fakeDb((sql) => {
			if (sql.includes("UPDATE pair_code")) return { run: { meta: { changes: 0 } } };
			return { first: live };
		});
		const res = await claim({ request: post({ code: "X" }), env: { DB: db } });

		expect(res.status).toBe(410);
		expect(sqlFor(calls, "INSERT INTO device")).toBeUndefined();
	});

	it("returns a token plus the group's current state on success", async () => {
		const { db } = fakeDb((sql) => {
			if (sql.includes("FROM pair_code")) return { first: live };
			if (sql.includes("FROM sync_group")) return { first: { last_read_at: FRI } };
			if (sql.includes("FROM feed")) {
				return {
					all: {
						results: [
							{ feed_url: "a", title: "A", updated_at: 5, deleted_at: null },
						],
					},
				};
			}
			return {};
		});
		const body = await (
			await claim({ request: post({ code: "X" }), env: { DB: db } })
		).json();

		// Handed back in the same response so the joining device converges now,
		// not on its next load.
		expect(body.deviceToken).toEqual(expect.any(String));
		expect(body.lastReadAt).toBe(FRI);
		expect(body.feeds).toEqual([
			{ feedUrl: "a", title: "A", updatedAt: 5, deletedAt: null },
		]);
	});

	it("accepts a code typed in lower case with the display hyphen left in", async () => {
		expect(normalizePairCode("abcde-fghjk")).toBe("ABCDEFGHJK");
		expect(normalizePairCode(randomPairCode())).toHaveLength(10);
	});
});

describe("state", () => {
	it("401s without a valid token", async () => {
		const { db } = fakeDb(() => ({ first: null }));
		expect((await stateGet({ request: get(), env: { DB: db } })).status).toBe(401);
		expect((await statePost({ request: post({ lastReadAt: WED }), env: { DB: db } })).status).toBe(401);
	});

	it("returns the group's watermark", async () => {
		const { db } = fakeDb(authed(() => ({ first: { last_read_at: FRI } })));
		const body = await (await stateGet({ request: get("tok"), env: { DB: db } })).json();
		expect(body.lastReadAt).toBe(FRI);
	});

	it("400s on a value that isn't an ISO timestamp", async () => {
		const { db } = fakeDb(authed());
		const res = await statePost({ request: post({ lastReadAt: "yesterday" }, "tok"), env: { DB: db } });
		expect(res.status).toBe(400);
	});

	it("guards the write with the max() condition rather than overwriting", async () => {
		const { db, calls } = fakeDb(authed(() => ({ first: { last_read_at: FRI } })));
		await statePost({ request: post({ lastReadAt: WED }, "tok"), env: { DB: db } });

		const update = sqlFor(calls, "UPDATE sync_group");
		expect(update?.sql).toContain("last_read_at IS NULL OR last_read_at <");
		expect(update?.values).toEqual([WED, expect.any(Number), "group-1", WED]);
	});

	it("returns the stored winner, not the value that was pushed", async () => {
		// A device pushing a lower watermark must converge on the higher stored
		// one instead of believing its rewind took.
		const { db } = fakeDb(authed(() => ({ first: { last_read_at: FRI } })));
		const body = await (
			await statePost({ request: post({ lastReadAt: WED }, "tok"), env: { DB: db } })
		).json();
		expect(body.lastReadAt).toBe(FRI);
	});
});

describe("feeds", () => {
	it("401s without a valid token", async () => {
		const { db } = fakeDb(() => ({ first: null }));
		expect((await feedsGet({ request: get(), env: { DB: db } })).status).toBe(401);
	});

	it("returns tombstones alongside live feeds", async () => {
		// The client needs the tombstone to apply the deletion; dropping it would
		// let a device that still has the feed re-add it.
		const { db } = fakeDb(
			authed(() => ({
				all: {
					results: [
						{ feed_url: "a", title: "A", updated_at: 1, deleted_at: null },
						{ feed_url: "b", title: "B", updated_at: 2, deleted_at: 2 },
					],
				},
			})),
		);
		const body = await (await feedsGet({ request: get("tok"), env: { DB: db } })).json();
		expect(body.feeds).toHaveLength(2);
		expect(body.feeds[1].deletedAt).toBe(2);
	});

	it("rejects an empty, oversized, or malformed change set", async () => {
		const { db } = fakeDb(authed());
		const env = { DB: db };
		expect((await feedsPost({ request: post({ feeds: [] }, "tok"), env })).status).toBe(400);
		expect((await feedsPost({ request: post({ feeds: [{ title: "no url" }] }, "tok"), env })).status).toBe(400);
		expect(
			(await feedsPost({
				request: post({ feeds: Array.from({ length: 501 }, () => ({ feedUrl: "a" })) }, "tok"),
				env,
			})).status,
		).toBe(400);
	});

	it("stamps changes with the server clock, not the client's", async () => {
		const { db, calls } = fakeDb(authed());
		const before = Date.now();
		await feedsPost({
			request: post({ feeds: [{ feedUrl: "a", title: "A", updated_at: 1 }] }, "tok"),
			env: { DB: db },
		});

		const upsert = sqlFor(calls, "INSERT INTO feed");
		expect(upsert?.values[3]).toBeGreaterThanOrEqual(before);
		expect(upsert?.values[4]).toBeNull();
	});

	it("writes a tombstone rather than deleting the row", async () => {
		const { db, calls } = fakeDb(authed());
		await feedsPost({
			request: post({ feeds: [{ feedUrl: "a", deleted: true }] }, "tok"),
			env: { DB: db },
		});

		expect(sqlFor(calls, "DELETE FROM feed")).toBeUndefined();
		expect(sqlFor(calls, "INSERT INTO feed")?.values[4]).toEqual(expect.any(Number));
	});
});
