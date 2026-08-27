// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseOpml } from "./opml";

// Tried `readFileSync(new URL("./__fixtures__/sample.opml", import.meta.url))` first.
// Failed: "The URL must be of scheme file". The DOM-environment global `URL` (jsdom/happy-dom)
// resolves relative URLs against a fake page location instead of the file:// base, so the
// result was `http://localhost:3000/...`, not a real file path. fileURLToPath + path.join
// below bypass that global and resolve the path with plain Node APIs instead.
const sampleOpml = readFileSync(
	join(dirname(fileURLToPath(import.meta.url)), "__fixtures__/sample.opml"),
	"utf-8",
);

describe("parseOpml", () => {
	it("flattens every feed out of nested OPML folders", () => {
		const feeds = parseOpml(sampleOpml);
		expect(feeds).toHaveLength(48);
	});

	it("extracts feedUrl and title for a given feed", () => {
		const feeds = parseOpml(sampleOpml);
		expect(feeds).toContainEqual({
			feedUrl: "https://jvns.ca/atom.xml",
			title: "Julia Evans",
		});
	});

	it("skips folder outlines that have no xmlUrl", () => {
		const feeds = parseOpml(sampleOpml);
		expect(feeds.some((feed) => feed.title === "Films")).toBe(false);
	});

	it("throws on malformed XML", () => {
		expect(() => parseOpml("<opml><body><outline")).toThrow();
	});
});
