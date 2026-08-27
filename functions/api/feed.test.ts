import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestGet } from "./feed";

function requestFor(url?: string): Request {
	const params = url ? `?url=${encodeURIComponent(url)}` : "";
	return new Request(`http://localhost/api/feed${params}`);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("onRequestGet", () => {
	it("400s when the url query parameter is missing", async () => {
		const res = await onRequestGet({ request: requestFor() });
		expect(res.status).toBe(400);
	});

	it("400s on an unparseable url", async () => {
		const res = await onRequestGet({ request: requestFor("not a url") });
		expect(res.status).toBe(400);
	});

	it("400s on a non-http(s) protocol", async () => {
		const res = await onRequestGet({
			request: requestFor("file:///etc/passwd"),
		});
		expect(res.status).toBe(400);
	});

	it("returns the feed body with an XML content type on success", async () => {
		const feedXml = "<rss><channel><title>Test Feed</title></channel></rss>";
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response(feedXml, { status: 200 })),
		);

		const res = await onRequestGet({
			request: requestFor("https://example.com/rss.xml"),
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("application/xml");
		expect(await res.text()).toBe(feedXml);
	});

	it("502s when the upstream fetch rejects", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("network down")),
		);

		const res = await onRequestGet({
			request: requestFor("https://example.com/rss.xml"),
		});

		expect(res.status).toBe(502);
	});

	it("502s when the upstream responds with a non-2xx status", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("not found", { status: 404 })),
		);

		const res = await onRequestGet({
			request: requestFor("https://example.com/rss.xml"),
		});

		expect(res.status).toBe(502);
	});
});
