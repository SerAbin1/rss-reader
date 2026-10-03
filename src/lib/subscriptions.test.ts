// Pure logic, no DOM or IndexedDB — see the module comment in subscriptions.ts.
import { describe, expect, it } from "vitest";
import type { Feed } from "./db";
import {
	describeImport,
	normalizeFeedUrl,
	planAdditions,
} from "./subscriptions";

const feed = (feedUrl: string, title = feedUrl): Feed => ({ feedUrl, title });

describe("normalizeFeedUrl", () => {
	it("keeps a plain feed URL as given", () => {
		expect(normalizeFeedUrl("https://example.com/feed.xml")).toBe(
			"https://example.com/feed.xml",
		);
	});

	it("trims surrounding whitespace from a pasted URL", () => {
		expect(normalizeFeedUrl("  https://example.com/feed.xml\n")).toBe(
			"https://example.com/feed.xml",
		);
	});

	it("lowercases the host so a feed isn't stored twice", () => {
		expect(normalizeFeedUrl("https://Example.COM/feed.xml")).toBe(
			"https://example.com/feed.xml",
		);
	});

	it("drops the fragment, which a fetch never sends anyway", () => {
		// Copied straight out of a browser bar, the #comments is a link to a
		// post, not to the feed — and keeping it would make this a second
		// subscription to a feed that's already there.
		expect(normalizeFeedUrl("https://example.com/feed.xml#comments")).toBe(
			"https://example.com/feed.xml",
		);
	});

	it("preserves the path, including a trailing slash", () => {
		// /feed and /feed/ really can be two different feeds on one host, so
		// these are deliberately not folded together.
		expect(normalizeFeedUrl("https://example.com/feed")).not.toBe(
			normalizeFeedUrl("https://example.com/feed/"),
		);
	});

	it("preserves the query string, which many feeds put the format in", () => {
		expect(normalizeFeedUrl("https://example.com/blog?format=rss")).toBe(
			"https://example.com/blog?format=rss",
		);
	});

	it("rejects a URL with no scheme", () => {
		// Guessing https:// here would fail later, on a host that only serves
		// http, with a fetch error that says nothing about the real mistake.
		expect(normalizeFeedUrl("example.com/feed.xml")).toBeNull();
	});

	it("rejects a scheme /api/feed can't fetch", () => {
		expect(normalizeFeedUrl("ftp://example.com/feed.xml")).toBeNull();
		expect(normalizeFeedUrl("javascript:alert(1)")).toBeNull();
	});

	it("rejects an empty string", () => {
		expect(normalizeFeedUrl("   ")).toBeNull();
	});
});

describe("planAdditions", () => {
	it("adds a feed the device doesn't have", () => {
		const { added, alreadySubscribed } = planAdditions(
			[feed("https://example.com/new.xml", "New")],
			[feed("https://other.com/old.xml")],
		);
		expect(added).toEqual([
			{ feedUrl: "https://example.com/new.xml", title: "New" },
		]);
		expect(alreadySubscribed).toBe(0);
	});

	it("adds nothing when re-importing a file it already has", () => {
		const existing = [feed("https://a.com/f.xml"), feed("https://b.com/f.xml")];
		const { added, alreadySubscribed } = planAdditions(
			[feed("https://a.com/f.xml"), feed("https://b.com/f.xml")],
			existing,
		);
		expect(added).toEqual([]);
		expect(alreadySubscribed).toBe(2);
	});

	it("leaves an existing feed's record untouched, siteUrl and all", () => {
		// The whole point of the additive rule: re-importing must not write the
		// row again, or the homepage discovered on the feed's first load (and
		// the title the user has been reading since) is silently reset.
		const existing: Feed[] = [
			{ feedUrl: "https://a.com/f.xml", title: "A", siteUrl: "https://a.com/" },
		];
		const { added } = planAdditions(
			[feed("https://a.com/f.xml", "A renamed by the exporter")],
			existing,
		);
		expect(added).toEqual([]);
		expect(existing).toEqual([
			{ feedUrl: "https://a.com/f.xml", title: "A", siteUrl: "https://a.com/" },
		]);
	});

	it("counts a curated feed as already subscribed", () => {
		// The caller passes curated and personal feeds together: a curated feed
		// is subscribed to on every load, so a personal copy of one would only
		// render twice.
		const { added, alreadySubscribed } = planAdditions(
			[feed("https://curated.com/f.xml")],
			[feed("https://curated.com/f.xml")],
		);
		expect(added).toEqual([]);
		expect(alreadySubscribed).toBe(1);
	});

	it("recognises an existing feed written before normalization existed", () => {
		// An OPML's xmlUrl is stored as-written, so a row can carry a
		// capitalized host or a copied-along fragment. Matching on the raw
		// string would add the same feed a second time.
		const { added, alreadySubscribed } = planAdditions(
			[feed("https://example.com/f.xml")],
			[feed("https://Example.com/f.xml#comments")],
		);
		expect(added).toEqual([]);
		expect(alreadySubscribed).toBe(1);
	});

	it("stores the normalized URL for a new feed", () => {
		const { added } = planAdditions([feed("https://Example.com/f.xml#x")], []);
		expect(added).toEqual([
			{ feedUrl: "https://example.com/f.xml", title: "https://Example.com/f.xml#x" },
		]);
	});

	it("adds only the genuinely new feeds from a partly-overlapping file", () => {
		const { added, alreadySubscribed } = planAdditions(
			[
				feed("https://a.com/f.xml"),
				feed("https://new.com/f.xml", "New"),
				feed("https://b.com/f.xml"),
			],
			[feed("https://a.com/f.xml"), feed("https://b.com/f.xml")],
		);
		expect(added).toEqual([
			{ feedUrl: "https://new.com/f.xml", title: "New" },
		]);
		expect(alreadySubscribed).toBe(2);
	});

	it("adds a repeated feed in the same file only once", () => {
		// Real OPML exports list one feed under every folder it was filed in.
		const { added, alreadySubscribed } = planAdditions(
			[feed("https://a.com/f.xml", "First"), feed("https://a.com/f.xml", "Second")],
			[],
		);
		expect(added).toEqual([
			{ feedUrl: "https://a.com/f.xml", title: "First" },
		]);
		expect(alreadySubscribed).toBe(1);
	});

	it("skips a candidate that isn't a usable URL, and counts it", () => {
		const { added, invalid } = planAdditions(
			[feed("not a url"), feed("ftp://example.com/f.xml"), feed("https://a.com/f.xml")],
			[],
		);
		expect(added).toEqual([{ feedUrl: "https://a.com/f.xml", title: "https://a.com/f.xml" }]);
		expect(invalid).toBe(2);
	});
});

describe("describeImport", () => {
	it("pluralizes the imported count", () => {
		const imported = (count: number) =>
			describeImport({
				added: Array.from({ length: count }, (_, i) => feed(`https://${i}.com/f.xml`)),
				alreadySubscribed: 0,
				invalid: 0,
			});
		expect(imported(0)).toBe("Imported 0 feeds.");
		expect(imported(1)).toBe("Imported 1 feed.");
		expect(imported(48)).toBe("Imported 48 feeds.");
	});

	it("says what a re-import skipped, rather than just 'Imported 0 feeds'", () => {
		// The re-import case: zero is the correct answer, and the count of
		// already-subscribed feeds is what makes it obviously correct rather
		// than a broken import.
		expect(
			describeImport({ added: [], alreadySubscribed: 48, invalid: 0 }),
		).toBe("Imported 0 feeds. 48 already subscribed.");
	});

	it("reports unusable entries too", () => {
		expect(
			describeImport({
				added: [feed("https://a.com/f.xml")],
				alreadySubscribed: 2,
				invalid: 1,
			}),
		).toBe("Imported 1 feed. 2 already subscribed. 1 skipped — not a valid URL.");
	});
});
