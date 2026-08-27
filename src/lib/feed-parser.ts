export interface Post {
	feedUrl: string;
	guid: string;
	title: string;
	link: string;
	publishedAt: string; // ISO 8601
}

export function parseFeed(xmlText: string, feedUrl: string): Post[] {
	const doc = new DOMParser().parseFromString(xmlText, "text/xml");
	if (doc.querySelector("parsererror")) {
		throw new Error("Invalid feed XML");
	}

	const rootName = doc.documentElement?.localName;
	if (rootName === "rss" || doc.querySelector("rss")) {
		return parseRss(doc, feedUrl);
	}
	if (rootName === "feed") {
		return parseAtom(doc, feedUrl);
	}
	throw new Error("Unrecognized feed format (not RSS or Atom)");
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
