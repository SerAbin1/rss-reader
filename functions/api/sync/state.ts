import {
	authenticate,
	json,
	jsonError,
	readJson,
	type SyncContext,
} from "./_shared";

interface StateBody {
	lastReadAt?: string | null;
}

export async function onRequestGet(ctx: SyncContext): Promise<Response> {
	const device = await authenticate(ctx);
	if (device === null) return jsonError("Unknown device token.", 401);

	const group = await ctx.env.DB.prepare(
		"SELECT last_read_at FROM sync_group WHERE id = ?",
	)
		.bind(device.group_id)
		.first<{ last_read_at: string | null }>();

	return json({ lastReadAt: group?.last_read_at ?? null });
}

export async function onRequestPost(ctx: SyncContext): Promise<Response> {
	const device = await authenticate(ctx);
	if (device === null) return jsonError("Unknown device token.", 401);

	const body = await readJson<StateBody>(ctx.request);
	const incoming = body?.lastReadAt;
	if (typeof incoming !== "string" || Number.isNaN(Date.parse(incoming))) {
		return jsonError("lastReadAt must be an ISO 8601 timestamp.", 400);
	}

	// max(), enforced by the database in one statement. Deliberately not
	// read → mergeWatermark() → write: those are two round trips, so two
	// devices pushing at once can interleave and let the *lower* value land
	// last, which is the exact rewind the merge rule exists to prevent. The
	// WHERE clause is the same rule, applied atomically.
	//
	// Comparison is lexicographic on the ISO 8601 string, which is why the
	// column is TEXT — ISO 8601 in UTC sorts identically as text and as time.
	await ctx.env.DB.prepare(
		"UPDATE sync_group SET last_read_at = ?, updated_at = ? WHERE id = ? AND (last_read_at IS NULL OR last_read_at < ?)",
	)
		.bind(incoming, Date.now(), device.group_id, incoming)
		.run();

	// Read back rather than echoing the input: a push that lost to a higher
	// stored value must return the winner, so the pushing device converges
	// instead of believing its own rewind took.
	const group = await ctx.env.DB.prepare(
		"SELECT last_read_at FROM sync_group WHERE id = ?",
	)
		.bind(device.group_id)
		.first<{ last_read_at: string | null }>();

	return json({ lastReadAt: group?.last_read_at ?? null });
}
