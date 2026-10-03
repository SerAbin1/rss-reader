export interface Post {
	feedUrl: string;
	guid: string;
	title: string;
	link: string;
	publishedAt: string; // ISO 8601
}

// A feed document carries channel-level metadata as well as items, so parsing
// one yields both. `title` is the feed's own name (RSS <channel><title>, Atom's
// feed-level <title>) — what a manually added feed is listed as, since a
// hand-typed URL has no better label. `siteUrl` is the feed's own homepage —
// the human-readable site, not the XML. Both are null when the document
// doesn't declare them.
export interface ParsedFeed {
	title: string | null;
	siteUrl: string | null;
	posts: Post[];
}

export function parseFeed(xmlText: string, feedUrl: string): ParsedFeed {
	const doc = new DOMParser().parseFromString(xmlText, "text/xml");
	if (doc.querySelector("parsererror")) {
		throw new Error("Invalid feed XML");
	}

	const rootName = doc.documentElement?.localName;
	if (rootName === "rss" || doc.querySelector("rss")) {
		return {
			title: rssTitle(doc),
			siteUrl: rssSiteUrl(doc),
			posts: parseRss(doc, feedUrl),
		};
	}
	if (rootName === "feed") {
		return {
			title: atomTitle(doc),
			siteUrl: atomSiteUrl(doc),
			posts: parseAtom(doc, feedUrl),
		};
	}
	throw new Error("Unrecognized feed format (not RSS or Atom)");
}

// Child combinator, not a bare `title`: every <item> has one too.
function rssTitle(doc: Document): string | null {
	return doc.querySelector("channel > title")?.textContent?.trim() || null;
}

// The feed document is the authoritative source for its own homepage. OPML's
// htmlUrl deliberately isn't used for this: exporters routinely copy the feed
// URL into it — all 48 feeds in __fixtures__/sample.opml have htmlUrl identical
// to xmlUrl — which would link the reader at raw XML instead of the site.
//
// No fallback (e.g. the feed URL's origin) when a feed declares no link: a
// guessed origin is wrong for anything served off an aggregator's domain, and a
// missing link is better than a wrong one. RSS 2.0 requires channel > link and
// Atom recommends rel="alternate", so real feeds almost always have it.
function rssSiteUrl(doc: Document): string | null {
	// Child combinator, not a bare `link`: every <item> has one too.
	return doc.querySelector("channel > link")?.textContent?.trim() || null;
}

// Walked like atomSiteUrl below, and for the same reason: every <entry> has
// its own <title>, and that title names the entry rather than the feed.
function atomTitle(doc: Document): string | null {
	const root = doc.documentElement;
	if (!root) return null;
	for (const child of root.children) {
		if (child.localName === "title") return child.textContent?.trim() || null;
	}
	return null;
}

function atomSiteUrl(doc: Document): string | null {
	const root = doc.documentElement;
	if (!root) return null;
	// Feed-level links only — walking children directly rather than querying,
	// so <entry>'s own <link> elements can never match.
	for (const child of root.children) {
		if (child.localName !== "link") continue;
		const rel = child.getAttribute("rel");
		if (!rel || rel === "alternate") {
			return child.getAttribute("href")?.trim() || null;
		}
	}
	return null;
}

function parseRss(doc: Document, feedUrl: string): Post[] {
	const posts: Post[] = [];
	for (const item of doc.querySelectorAll("item")) {
		const title = item.querySelector("title")?.textContent?.trim();
		const link = item.querySelector("link")?.textContent?.trim();
		const guid = item.querySelector("guid")?.textContent?.trim() || link;
		const pubDateText = item.querySelector("pubDate")?.textContent?.trim();
		const publishedAt = pubDateText ? toIsoDate(pubDateText) : undefined;

		if (!title || !link || !guid || !publishedAt) continue;
		posts.push({ feedUrl, guid, title, link, publishedAt });
	}
	return posts;
}

function parseAtom(doc: Document, feedUrl: string): Post[] {
	const posts: Post[] = [];
	for (const entry of doc.querySelectorAll("entry")) {
		const title = entry.querySelector("title")?.textContent?.trim();
		const link = atomAlternateLink(entry);
		const guid = entry.querySelector("id")?.textContent?.trim() || link;
		const dateText =
			entry.querySelector("published")?.textContent?.trim() ||
			entry.querySelector("updated")?.textContent?.trim();
		const publishedAt = dateText ? toIsoDate(dateText) : undefined;

		if (!title || !link || !guid || !publishedAt) continue;
		posts.push({ feedUrl, guid, title, link, publishedAt });
	}
	return posts;
}

// Atom entries can carry several <link> elements (self, alternate, ...);
// the article URL is the one with rel="alternate", or no rel at all (the spec default).
function atomAlternateLink(entry: Element): string | undefined {
	for (const link of entry.querySelectorAll("link")) {
		const rel = link.getAttribute("rel");
		if (!rel || rel === "alternate") {
			return link.getAttribute("href")?.trim() || undefined;
		}
	}
	return undefined;
}

function toIsoDate(dateText: string): string | undefined {
	const date = new Date(dateText);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
