// Cloudflare's real handler context (`EventContext` from `@cloudflare/workers-types`)
// also carries env/params/waitUntil/etc. Not pulling in that package yet — same
// "raw API first" reasoning as src/lib/db.ts — so this is a minimal local stand-in
// with just the one field this function actually reads.
interface RequestContext {
  request: Request;
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const USER_AGENT = "RssReader/1.0 (+https://my-rss-reader.serabin1.workers.dev)";

// The body, not the Content-Type: plenty of real feeds are mislabelled
// text/html, but none of them start with an HTML document.
export function looksLikeHtmlPage(body: string): boolean {
  const start = body.trimStart().slice(0, 64).toLowerCase();
  return start.startsWith("<!doctype html") || start.startsWith("<html");
}

export async function onRequestGet({ request }: RequestContext): Promise<Response> {
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
    // Identifies the reader honestly, as the Android app does. Some hosts
    // refuse a request with no User-Agent at all.
    feedResponse = await fetch(target.toString(), {
      headers: { "User-Agent": USER_AGENT },
    });
  } catch {
    return jsonError("Failed to fetch feed.", 502);
  }

  if (!feedResponse.ok) {
    return jsonError(`Feed responded with ${feedResponse.status}.`, 502);
  }

  const body = await feedResponse.text();
  // A 200 that's a web page, not a feed: usually a bot check (SiteGround's
  // sgcaptcha, Cloudflare's challenge) that some hosts show to datacenter
  // IPs like this function's — while the same URL works from a phone. Said
  // plainly here, because the client would only report "Invalid feed XML".
  if (looksLikeHtmlPage(body)) {
    return jsonError(
      "The site sent a web page (likely a bot check) instead of the feed, so the server can't read it.",
      502,
    );
  }
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
