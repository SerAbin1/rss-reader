import { isPairCodeUsable } from "../../../src/lib/sync-state";
import {
	json,
	jsonError,
	normalizePairCode,
	randomId,
	randomToken,
	readJson,
	sha256Hex,
	type SyncContext,
} from "./_shared";

interface ClaimBody {
	code?: string;
}

interface PairCodeRow {
	group_id: string;
	expires_at: number;
	claimed_at: number | null;
}

interface FeedRow {
	feed_url: string;
	title: string;
	updated_at: number;
	deleted_at: number | null;
}

// Redeems a pair code for a device token, joining the caller to that code's
// group. Unauthenticated by design — the code in the body is the credential,
// and it is spent by this call.
export async function onRequestPost(ctx: SyncContext): Promise<Response> {
	const now = Date.now();
	const body = await readJson<ClaimBody>(ctx.request);
	if (!body?.code) return jsonError("Missing pair code.", 400);

	const codeHash = await sha256Hex(normalizePairCode(body.code));
	const code = await ctx.env.DB.prepare(
		"SELECT group_id, expires_at, claimed_at FROM pair_code WHERE code_hash = ?",
	)
		.bind(codeHash)
		.first<PairCodeRow>();

	// Same message and status for unknown, expired and already-claimed: telling
	// them apart would let someone probing codes learn which ones existed.
	if (
		code === null ||
		!isPairCodeUsable(
			{ expiresAt: code.expires_at, claimedAt: code.claimed_at },
			now,
		)
	) {
		return jsonError("That pairing code is not valid any more.", 410);
	}

	// The conditional UPDATE *is* the claim, and single-use rests on it rather
	// than on the check above. Two devices scanning the same QR at once would
	// both pass that check — read and write are separate round trips — but only
	// one can match `claimed_at IS NULL`, so only one gets a token.
	const claim = await ctx.env.DB.prepare(
		"UPDATE pair_code SET claimed_at = ? WHERE code_hash = ? AND claimed_at IS NULL",
	)
		.bind(now, codeHash)
		.run();
	if (claim.meta.changes === 0) {
		return jsonError("That pairing code is not valid any more.", 410);
	}

	const deviceToken = randomToken();
	await ctx.env.DB.prepare(
		"INSERT INTO device (id, group_id, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
	)
		.bind(randomId(), code.group_id, await sha256Hex(deviceToken), now, now)
		.run();

	// Hand back the group's current state in the same response, so the joining
	// device converges immediately instead of showing its own stale view until
	// the next load.
	const group = await ctx.env.DB.prepare(
		"SELECT last_read_at FROM sync_group WHERE id = ?",
	)
		.bind(code.group_id)
		.first<{ last_read_at: string | null }>();

	const feeds = await ctx.env.DB.prepare(
		"SELECT feed_url, title, updated_at, deleted_at FROM feed WHERE group_id = ?",
	)
		.bind(code.group_id)
		.all<FeedRow>();

	return json({
		deviceToken,
		groupId: code.group_id,
		lastReadAt: group?.last_read_at ?? null,
		feeds: feeds.results.map((row) => ({
			feedUrl: row.feed_url,
			title: row.title,
			updatedAt: row.updated_at,
			deletedAt: row.deleted_at,
		})),
	});
}
