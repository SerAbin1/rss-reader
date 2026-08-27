// Cloudflare's real handler context (`EventContext` from `@cloudflare/workers-types`)
// also carries env/params/waitUntil/etc. Not pulling in that package yet — same
// "raw API first" reasoning as src/lib/db.ts — so this is a minimal local stand-in
// with just the one field this function actually reads.
interface RequestContext {
	request: Request;
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export async function onRequestGet({
	request,
}: RequestContext): Promise<Response> {
	const feedUrlParam = new URL(request.url).searchParams.get("url");
	if (!feedUrlParam) {
		return jsonError("Missing required 'url' query parameter.", 400);
	}

	let target: URL;
	try {
		target = new URL(feedUrlParam);
	} catch {
		return jsonError("Invalid feed URL.", 400);
	}

	if (!ALLOWED_PROTOCOLS.has(target.protocol)) {
		return jsonError("Feed URL must use http or https.", 400);
	}

	let feedResponse: Response;
	try {
		feedResponse = await fetch(target.toString());
	} catch {
		return jsonError("Failed to fetch feed.", 502);
	}

	if (!feedResponse.ok) {
		return jsonError(`Feed responded with ${feedResponse.status}.`, 502);
	}

	const body = await feedResponse.text();
	return new Response(body, {
		status: 200,
		headers: { "Content-Type": "application/xml; charset=utf-8" },
	});
}

function jsonError(message: string, status: number): Response {
	console.error(message);
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
