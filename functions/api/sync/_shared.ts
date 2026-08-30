// Shared helpers for the sync endpoints. The leading underscore keeps Pages
// from routing this file as an endpoint of its own.
//
// The D1/context types below are minimal local stand-ins covering only the
// surface these handlers touch — same "raw API first, don't pull in
// @cloudflare/workers-types yet" reasoning as functions/api/feed.ts.

export interface D1RunResult {
	meta: { changes: number };
}

export interface D1PreparedStatement {
	bind(...values: unknown[]): D1PreparedStatement;
	first<T>(): Promise<T | null>;
	run(): Promise<D1RunResult>;
	all<T>(): Promise<{ results: T[] }>;
}

export interface D1Database {
	prepare(query: string): D1PreparedStatement;
}

export interface SyncContext {
	request: Request;
	env: { DB: D1Database };
}

export function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export function jsonError(message: string, status: number): Response {
	return json({ error: message }, status);
}

// Device tokens are never typed by a human, so they're as long as is free:
// 256 bits, base64url.
export function randomToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Pair codes *are* typed by a human (the QR is a convenience layer over the
// same code), so they trade length for legibility: Crockford's base32 alphabet
// drops I, L, O and U so there's no 1/I or 0/O ambiguity to mistype. Ten
// characters is ~50 bits, which against a single-use code that expires in five
// minutes is far more than guessing can reach.
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 10;

export function randomPairCode(): string {
	const bytes = new Uint8Array(CODE_LENGTH);
	crypto.getRandomValues(bytes);
	let code = "";
	// Modulo bias here is negligible: 256 % 32 === 0, so the mapping is exactly
	// uniform rather than merely close to it.
	for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
	return code;
}

// Codes are shown grouped (ABCDE-FGHJK) and may be typed in lower case or with
// the hyphen left out, so normalise before hashing or nothing would ever match.
export function normalizePairCode(code: string): string {
	return code.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(value),
	);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export function randomId(): string {
	return crypto.randomUUID();
}

export interface DeviceRow {
	id: string;
	group_id: string;
}

export function bearerToken(request: Request): string | null {
	const header = request.headers.get("Authorization");
	if (header === null) return null;
	const match = /^Bearer (.+)$/.exec(header.trim());
	return match ? match[1] : null;
}

// Resolves the caller's device from its bearer token. The group id is never
// accepted as authentication — it's an internal identifier, and treating it as
// a credential would make it an unrevocable password that's also rendered on
// screen as a QR code.
export async function authenticate(
	ctx: SyncContext,
): Promise<DeviceRow | null> {
	const token = bearerToken(ctx.request);
	if (token === null) return null;

	const device = await ctx.env.DB.prepare(
		"SELECT id, group_id FROM device WHERE token_hash = ?",
	)
		.bind(await sha256Hex(token))
		.first<DeviceRow>();

	if (device !== null) {
		await ctx.env.DB.prepare("UPDATE device SET last_seen_at = ? WHERE id = ?")
			.bind(Date.now(), device.id)
			.run();
	}
	return device;
}

export async function readJson<T>(request: Request): Promise<T | null> {
	try {
		return (await request.json()) as T;
	} catch {
		return null;
	}
}
