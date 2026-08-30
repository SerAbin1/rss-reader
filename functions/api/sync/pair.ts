import {
	authenticate,
	bearerToken,
	json,
	jsonError,
	randomId,
	randomPairCode,
	randomToken,
	readJson,
	sha256Hex,
	type SyncContext,
} from "./_shared";

// Five minutes: long enough to walk a code over to another device, short
// enough that an unused one stops being a live credential quickly.
const CODE_TTL_MS = 5 * 60 * 1000;

interface PairBody {
	lastReadAt?: string | null;
}

// Starts a pairing. Two paths, and which one runs is the whole point of this
// endpoint taking an *optional* token:
//
//   - Device has no token: this is the first device. Create the group, seeded
//     with whatever it has read locally so opting into sync doesn't throw away
//     the watermark it already had, and issue it a token.
//   - Device has a token: it is already in a group. Issue a code for THAT
//     group. Re-running the pairing flow must let another device join, never
//     silently fork a second group and strand the first one's history.
export async function onRequestPost(ctx: SyncContext): Promise<Response> {
	const now = Date.now();
	const device = await authenticate(ctx);

	let groupId: string;
	let deviceToken: string | undefined;

	if (device !== null) {
		groupId = device.group_id;
	} else {
		// A token that was sent but didn't resolve is an error, not a new user.
		// Falling through to "create a group" would silently strand a device
		// whose token was revoked or whose group was deleted, and it would look
		// to them like their reading history had vanished.
		if (bearerToken(ctx.request) !== null) {
			return jsonError("Unknown device token.", 401);
		}

		const body = await readJson<PairBody>(ctx.request);
		groupId = randomId();
		await ctx.env.DB.prepare(
			"INSERT INTO sync_group (id, last_read_at, updated_at, created_at) VALUES (?, ?, ?, ?)",
		)
			.bind(groupId, body?.lastReadAt ?? null, now, now)
			.run();

		deviceToken = randomToken();
		await ctx.env.DB.prepare(
			"INSERT INTO device (id, group_id, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
		)
			.bind(randomId(), groupId, await sha256Hex(deviceToken), now, now)
			.run();
	}

	const pairCode = randomPairCode();
	const expiresAt = now + CODE_TTL_MS;
	await ctx.env.DB.prepare(
		"INSERT INTO pair_code (code_hash, group_id, expires_at, claimed_at) VALUES (?, ?, ?, NULL)",
	)
		.bind(await sha256Hex(pairCode), groupId, expiresAt)
		.run();

	// The code is returned in the clear exactly once, here, and only its hash is
	// stored — it cannot be re-read later, by us or by anyone with the database.
	return json({ groupId, pairCode, expiresAt, deviceToken });
}
