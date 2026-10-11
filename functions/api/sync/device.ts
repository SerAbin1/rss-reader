import { authenticate, countDevices, json, jsonError, type SyncContext } from "./_shared";

// Unpairs the calling device: its row goes, so its token stops working and
// its place in the two-device group is free for another. Only ever the
// caller's own row — removing the *other* device is /pair's `replace`.
export async function onRequestDelete(ctx: SyncContext): Promise<Response> {
	const device = await authenticate(ctx);
	if (device === null) return jsonError("Unknown device token.", 401);

	await ctx.env.DB.prepare("DELETE FROM device WHERE id = ?")
		.bind(device.id)
		.run();

	// The last device out takes the group with it: nothing can authenticate
	// against it any more, so its feeds and codes would only ever be litter.
	// Children first, for the foreign keys.
	if ((await countDevices(ctx, device.group_id)) === 0) {
		for (const table of ["pair_code", "feed"]) {
			await ctx.env.DB.prepare(`DELETE FROM ${table} WHERE group_id = ?`)
				.bind(device.group_id)
				.run();
		}
		await ctx.env.DB.prepare("DELETE FROM sync_group WHERE id = ?")
			.bind(device.group_id)
			.run();
	}

	return json({ ok: true });
}
