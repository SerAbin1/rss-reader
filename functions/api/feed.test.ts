import { afterEach, describe, expect, it, vi } from "vitest";
import { looksLikeHtmlPage, onRequestGet } from "./feed";

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

	it("502s with an explanation when the site sends a web page instead", async () => {
		const challenge =
			'<html><head><meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/"></meta></head></html>';
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response(challenge, { status: 200 })),
		);

		const res = await onRequestGet({
			request: requestFor("https://lemire.me/blog/feed/"),
		});
		expect(res.status).toBe(502);
		expect(((await res.json()) as { error: string }).error).toMatch(/bot check/);
	});

	it("sends an identifying User-Agent", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response("<rss></rss>", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		await onRequestGet({ request: requestFor("https://example.com/rss.xml") });
		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect(new Headers(init.headers).get("User-Agent")).toMatch(/^RssReader\//);
	});
});

describe("looksLikeHtmlPage", () => {
	it("spots an HTML document however it opens", () => {
		expect(looksLikeHtmlPage("<!DOCTYPE html><html></html>")).toBe(true);
		expect(looksLikeHtmlPage("\n  <html><body></body></html>")).toBe(true);
	});

	it("leaves feeds alone, including ones with a leading XML declaration", () => {
		expect(looksLikeHtmlPage('<?xml version="1.0"?><rss></rss>')).toBe(false);
		expect(looksLikeHtmlPage("<feed xmlns=\"http://www.w3.org/2005/Atom\"></feed>")).toBe(false);
	});
});
