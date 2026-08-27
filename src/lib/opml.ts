import type { Feed } from "./db";

export function parseOpml(xmlText: string): Feed[] {
	const doc = new DOMParser().parseFromString(xmlText, "text/xml");
	if (doc.querySelector("parsererror")) {
		throw new Error("Invalid OPML file");
	}

	const feeds: Feed[] = [];
	// Matches outlines at any nesting depth, so folders/categories are flattened.
	for (const outline of doc.querySelectorAll("outline[xmlUrl]")) {
		const feedUrl = outline.getAttribute("xmlUrl");
		if (!feedUrl) continue;
		const title =
			outline.getAttribute("title") ?? outline.getAttribute("text") ?? feedUrl;
		feeds.push({ feedUrl, title });
	}
	return feeds;
}
