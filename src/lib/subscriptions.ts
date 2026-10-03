// Deciding *which* feeds an add should write, kept separate from the DOM and
// IndexedDB wiring in app.ts so both add paths (one URL, or a whole OPML file)
// can be tested without a browser — same split as read-state.ts and
// sync-state.ts.

import type { Feed } from "./db";

export interface FeedAdditions {
	// New subscriptions, in the order given, each carrying its normalized URL.
	added: Feed[];
	// Candidates this device already has, at either scope. Nothing is written
	// for these — see planAdditions.
	alreadySubscribed: number;
	// Candidates that aren't an http(s) URL at all and can't be subscribed to.
	invalid: number;
}

// The canonical form a feed is stored and compared under. Two feeds are the
// same subscription when this matches, so a URL that differs only in ways the
// server cannot see — host case, a fragment copied along from the browser bar,
// surrounding whitespace — must not land as a second copy of one feed.
//
// The fragment is dropped rather than rejected: a fetch never sends it, and
// `/feed.xml#comments` names the same document as `/feed.xml`. The path is
// left exactly as given, since `/feed` and `/feed/` really can be two
// different feeds. Only http(s), because that's all /api/feed will fetch, so
// anything else is a typo rather than a feed this app can read.
export function normalizeFeedUrl(raw: string): string | null {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return null;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return null;
	url.hash = "";
	return url.toString();
}

// Splits candidates into the ones worth writing and the ones to leave alone.
// `existing` is every feed already on the device — personal *and* curated,
// since a curated feed is subscribed to on every load and a personal copy of
// one would only render twice.
//
// Purely additive by construction: an already-subscribed candidate is never
// returned in `added`, so callers save exactly the new feeds and no existing
// record is rewritten. That's what makes re-importing an OPML file a no-op
// rather than a second write of the same rows, and it also means the siteUrl
// discovered on a feed's first load survives every later import.
//
// Candidates are compared with each other too, since one OPML file routinely
// lists the same feed under two folders.
export function planAdditions(
	candidates: Feed[],
	existing: Feed[],
): FeedAdditions {
	// Normalized on this side too, not just the candidates': feeds stored
	// before normalization existed (an OPML's `xmlUrl` as-written) would
	// otherwise never match a candidate the user just pasted by hand, and the
	// one feed they'd most expect to already have would be added twice.
	const subscribed = new Set(
		existing
			.map((feed) => normalizeFeedUrl(feed.feedUrl))
			.filter((feedUrl) => feedUrl !== null),
	);
	const added: Feed[] = [];
	const claimed = new Set<string>();
	let alreadySubscribed = 0;
	let invalid = 0;

	for (const candidate of candidates) {
		const feedUrl = normalizeFeedUrl(candidate.feedUrl);
		if (feedUrl === null) {
			invalid++;
			continue;
		}
		if (subscribed.has(feedUrl) || claimed.has(feedUrl)) {
			alreadySubscribed++;
			continue;
		}
		claimed.add(feedUrl);
		added.push({ ...candidate, feedUrl });
	}

	return { added, alreadySubscribed, invalid };
}

// The single line of feedback an import produces. The counts of what it skipped
// are part of the message rather than console noise: a feed that silently
// didn't arrive is indistinguishable from a bug, and on a re-import of a file
// the device already has, "Imported 0 feeds" has to say whether that was
// correct or broken.
export function describeImport({
	added,
	alreadySubscribed,
	invalid,
}: FeedAdditions): string {
	const parts = [
		`Imported ${added.length} feed${added.length === 1 ? "" : "s"}.`,
	];
	if (alreadySubscribed > 0) {
		parts.push(`${alreadySubscribed} already subscribed.`);
	}
	if (invalid > 0) {
		parts.push(`${invalid} skipped — not a valid URL.`);
	}
	return parts.join(" ");
}
