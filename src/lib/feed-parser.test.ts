// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseFeed } from "./feed-parser";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const rssXml = readFileSync(join(fixturesDir, "sample-rss.xml"), "utf-8");
const atomXml = readFileSync(join(fixturesDir, "sample-atom.xml"), "utf-8");

describe("parseFeed (RSS)", () => {
	it("parses items into posts, skipping ones missing required fields", () => {
		const { posts } = parseFeed(rssXml, "https://example.com/rss.xml");
		expect(posts).toHaveLength(2);
	});

	it("extracts title, link, guid, and an ISO published date", () => {
		const { posts } = parseFeed(rssXml, "https://example.com/rss.xml");
		expect(posts[0]).toEqual({
			feedUrl: "https://example.com/rss.xml",
			guid: "https://example.com/first-post",
			title: "First post",
			link: "https://example.com/first-post",
			publishedAt: "2026-08-24T09:00:00.000Z",
		});
	});

	it("reads the channel's own link as the site URL", () => {
		// Not OPML's htmlUrl: exporters routinely copy the feed URL into that
		// field, which would link at raw XML. The feed is authoritative here.
		expect(parseFeed(rssXml, "https://example.com/rss.xml").siteUrl).toBe(
			"https://example.com/",
		);
	});

	it("uses the guid element even when it isn't a URL", () => {
		const { posts } = parseFeed(rssXml, "https://example.com/rss.xml");
		expect(posts[1].guid).toBe("urn:uuid:second-post");
	});
});

describe("parseFeed (Atom)", () => {
	it("parses entries into posts, skipping ones missing required fields", () => {
		const { posts } = parseFeed(atomXml, "https://example.org/atom.xml");
		expect(posts).toHaveLength(2);
	});

	it("prefers the rel=alternate link over rel=self", () => {
		const { posts } = parseFeed(atomXml, "https://example.org/atom.xml");
		expect(posts[0].link).toBe("https://example.org/first-entry");
	});

	it("reads the feed-level rel=alternate link as the site URL", () => {
		// Must not pick up an <entry>'s own links, nor the feed's rel=self.
		expect(parseFeed(atomXml, "https://example.org/atom.xml").siteUrl).toBe(
			"https://example.org/",
		);
	});

	it("falls back to updated when published is absent", () => {
		const { posts } = parseFeed(atomXml, "https://example.org/atom.xml");
		expect(posts[1].publishedAt).toBe("2026-08-25T09:00:00.000Z");
	});
});

describe("parseFeed (errors)", () => {
	it("throws on malformed XML", () => {
		expect(() => parseFeed("<rss><channel", "https://example.com/rss.xml")).toThrow();
	});

	it("throws on a document that's neither RSS nor Atom", () => {
		expect(() =>
			parseFeed("<html><body>not a feed</body></html>", "https://example.com/x"),
		).toThrow();
	});
});
