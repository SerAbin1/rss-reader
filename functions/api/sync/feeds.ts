import {
	authenticate,
	json,
	jsonError,
	readJson,
	type SyncContext,
} from "./_shared";

interface FeedRow {
	feed_url: string;
	title: string;
	updated_at: number;
	deleted_at: number | null;
}

interface FeedChange {
	feedUrl?: string;
	title?: string;
	deleted?: boolean;
}

interface FeedsBody {
	feeds?: FeedChange[];
}

// One OPML import is the realistic upper bound on a single push.
const MAX_CHANGES = 500;

// Returns the group's whole feed set, tombstones included. Deleted rows are not
// filtered out here: the client needs them to apply the deletion locally, and a
// tombstone that stopped being sent would let a device that still has the feed
// re-add it on its next push.
export async function onRequestGet(ctx: SyncContext): Promise<Response> {
	const device = await authenticate(ctx);
	if (device === null) return jsonError("Unknown device token.", 401);

	const feeds = await ctx.env.DB.prepare(
		"SELECT feed_url, title, updated_at, deleted_at FROM feed WHERE group_id = ?",
	)
		.bind(device.group_id)
		.all<FeedRow>();

	return json({
		feeds: feeds.results.map((row) => ({
			feedUrl: row.feed_url,
			title: row.title,
			updatedAt: row.updated_at,
			deletedAt: row.deleted_at,
		})),
	});
}

// Pushes explicit user actions — a feed added, or a feed removed — never the
// device's whole feed list. That distinction is load-bearing: every change is
// stamped with the server's clock, so it is by definition newer than anything
// stored and always wins. Replaying a full local set would therefore resurrect
// every feed the group had deleted since that device last pulled.
export async function onRequestPost(ctx: SyncContext): Promise<Response> {
	const device = await authenticate(ctx);
	if (device === null) return jsonError("Unknown device token.", 401);

	const body = await readJson<FeedsBody>(ctx.request);
	const changes = body?.feeds;
	if (!Array.isArray(changes) || changes.length === 0) {
		return jsonError("feeds must be a non-empty array.", 400);
	}
	if (changes.length > MAX_CHANGES) {
		return jsonError(`At most ${MAX_CHANGES} feeds per request.`, 400);
	}
	if (changes.some((change) => typeof change?.feedUrl !== "string")) {
		return jsonError("Every feed needs a feedUrl.", 400);
	}

	// Server-stamped, never device-stamped. Feed membership resolves by
	// comparing these timestamps, so accepting a client's clock would let a
	// skewed device win arguments it should lose.
	const now = Date.now();
	for (const change of changes) {
		await ctx.env.DB.prepare(
			`INSERT INTO feed (group_id, feed_url, title, updated_at, deleted_at)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT (group_id, feed_url) DO UPDATE SET
			   title = excluded.title,
			   updated_at = excluded.updated_at,
			   deleted_at = excluded.deleted_at`,
		)
			.bind(
				device.group_id,
				change.feedUrl,
				change.title ?? change.feedUrl,
				now,
				change.deleted === true ? now : null,
			)
			.run();
	}

	return onRequestGet(ctx);
}
