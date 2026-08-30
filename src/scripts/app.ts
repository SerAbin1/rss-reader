import {
	deleteFeeds,
	type Feed,
	getAllFeeds,
	getDeviceToken,
	getLastReadAt,
	saveFeeds,
	setLastReadAt,
} from "../lib/db";
import { parseFeed, type ParsedFeed, type Post } from "../lib/feed-parser";
import { parseOpml } from "../lib/opml";
import {
	pullFeeds,
	pullWatermark,
	pushFeedChanges,
	pushWatermark,
} from "../lib/sync-client";
import { mergeWatermark } from "../lib/sync-state";
import {
	isRead,
	watermarkAfterCatchUp,
	watermarkAfterClick,
} from "../lib/read-state";

const fileInput = document.querySelector<HTMLInputElement>("#opml-input")!;
const feedListEl = document.querySelector<HTMLUListElement>("#feed-list")!;
const postListEl = document.querySelector<HTMLUListElement>("#post-list")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const postsStatusEl =
	document.querySelector<HTMLParagraphElement>("#posts-status")!;
const catchUpDateInput =
	document.querySelector<HTMLInputElement>("#catch-up-date")!;
const catchUpButton =
	document.querySelector<HTMLButtonElement>("#catch-up-button")!;

// Module state so a click handler (see markReadIfNext below) can re-render
// without refetching every feed.
let currentPosts: Post[] = [];
let currentFeeds: Feed[] = [];
let currentFeedTitleByUrl = new Map<string, string>();
let lastReadAt: string | null = null;

// Load progress, module-scoped so the push gate below can read the *final*
// failure count rather than a provisional one.
let totalFeeds = 0;
let settledFeeds = 0;
let failures = 0;

// Null means this device never opted into sync; it then never touches the
// network and behaves exactly as before.
let syncToken: string | null = null;

// Whether this load managed to confirm its feed set against the group. The
// watermark is never pushed while this is false: a device whose feed list is
// unconfirmed may be missing a feed another device added, and pushing from
// that view marks posts read that were never shown anywhere.
let feedsReconciled = false;

function renderFeeds(feeds: Feed[]): void {
	feedListEl.replaceChildren(
		...feeds.map((feed) => {
			const li = document.createElement("li");
			// Plain text until the feed's homepage is known — see rememberSiteUrl.
			if (feed.siteUrl === undefined) {
				li.textContent = feed.title;
				return li;
			}

			const link = document.createElement("a");
			link.href = feed.siteUrl;
			link.textContent = feed.title;
			link.target = "_blank";
			link.rel = "noopener noreferrer";
			li.append(link);
			return li;
		}),
	);
}

// The feed list renders straight from IndexedDB, before any feed is fetched, so
// on the very first load links appear one by one as each feed resolves.
// Persisting what we learn means every later visit has them immediately.
function rememberSiteUrl(feed: Feed, siteUrl: string | null): void {
	if (siteUrl === null || feed.siteUrl === siteUrl) return;

	const updated: Feed = { ...feed, siteUrl };
	currentFeeds = currentFeeds.map((existing) =>
		existing.feedUrl === feed.feedUrl ? updated : existing,
	);
	renderFeeds(currentFeeds);
	void saveFeeds([updated]);
}

// Posts are sorted ascending (earliest first), and read/unread is derived from
// `lastReadAt` rather than stored per-post — see src/lib/read-state.ts and the
// Obsidian decision log.
function renderPosts(): void {
	// Read posts aren't dimmed, they're not rendered at all — `index` below is
	// each post's position in the *full* currentPosts array (not the filtered
	// list), since watermarkAfterClick's index semantics are defined against
	// the full array.
	const unread = currentPosts
		.map((post, index) => ({ post, index }))
		.filter(({ post }) => !isRead(post.publishedAt, lastReadAt));

	postListEl.replaceChildren(
		...unread.map(({ post, index }) => {
			const li = document.createElement("li");

			const link = document.createElement("a");
			link.href = post.link;
			link.textContent = post.title;
			link.target = "_blank";
			link.rel = "noopener noreferrer";
			link.addEventListener("click", () => {
				const newLastReadAt = watermarkAfterClick(currentPosts, lastReadAt, index);
				if (newLastReadAt !== null) {
					void markRead(newLastReadAt);
				}
			});

			const meta = document.createElement("span");
			meta.className = "meta";

			const feedName = document.createElement("span");
			feedName.className = "feed-name";
			feedName.textContent = currentFeedTitleByUrl.get(post.feedUrl) ?? post.feedUrl;

			const date = document.createElement("span");
			date.className = "date";
			date.textContent = new Date(post.publishedAt).toLocaleDateString(undefined, {
				year: "numeric",
				month: "short",
				day: "numeric",
			});

			meta.append(feedName, date);
			li.append(link, meta);
			return li;
		}),
	);
}

async function markRead(publishedAt: string): Promise<void> {
	lastReadAt = publishedAt;
	await setLastReadAt(publishedAt);
	renderPosts();
	void pushWatermarkIfAllowed();
}

// Local state is authoritative and already saved by the time this runs; the
// push is best-effort. Nothing is queued on failure — max() means the next
// successful push carries the accumulated watermark in one go.
async function pushWatermarkIfAllowed(): Promise<void> {
	if (syncToken === null || lastReadAt === null) return;
	// Not while feeds are still arriving: a click at second one would see
	// failures === 0 while a feed is still in flight and about to fail.
	if (settledFeeds < totalFeeds) return;
	if (!feedsReconciled) return;
	// Step 6 turns this into a prompt rather than a silent refusal.
	if (failures > 0) return;

	try {
		const winner = await pushWatermark(syncToken, lastReadAt);
		// The server applies max(), so a push carrying a lower value comes back
		// with the stored higher one. Adopt it rather than believing our own.
		applyWatermark(mergeWatermark(lastReadAt, winner));
	} catch (err) {
		console.error(err);
	}
}

function applyWatermark(next: string | null): void {
	if (next === null || next === lastReadAt) return;
	lastReadAt = next;
	void setLastReadAt(next);
	renderPosts();
}

// One-time escape hatch: jumps the watermark straight to a date you pick, so
// a backlog you have no intention of reading in order (e.g. right after
// importing an OPML with years of history) doesn't have to be clicked through
// one by one. Excludes the chosen date itself (see cutoff below) — a plain
// date input can't express a time of day, so "before the chosen day" is the
// only unambiguous reading. Doesn't change the normal click-to-advance
// behavior above.
catchUpButton.addEventListener("click", async () => {
	const dateValue = catchUpDateInput.value;
	if (!dateValue) {
		alert("Pick a date first.");
		return;
	}

	// The instant *before* the chosen day starts, so the chosen date itself
	// stays unread — "up to but not including" rather than "up to and including".
	const cutoff = new Date(
		new Date(`${dateValue}T00:00:00.000Z`).getTime() - 1,
	).toISOString();
	// Forward-only. Catching up to a date already behind the watermark would
	// move it backwards — harmless locally, but it's the one non-monotonic
	// write this app can produce, and once reading state syncs the server's
	// max() merge discards it: the rewind would survive until the next load
	// and then silently undo itself. Rejected outright instead.
	if (watermarkAfterCatchUp(lastReadAt, cutoff) === null) {
		alert(`Everything before ${dateValue} is already marked read.`);
		return;
	}

	if (!confirm(`Mark everything before ${dateValue} as read?`)) return;

	await markRead(cutoff);
});

async function fetchPosts(feed: Feed): Promise<ParsedFeed> {
	const res = await fetch(`/api/feed?url=${encodeURIComponent(feed.feedUrl)}`);
	if (!res.ok) {
		throw new Error(`${feed.title}: request failed (${res.status})`);
	}
	return parseFeed(await res.text(), feed.feedUrl);
}

function updateLoadStatus(): void {
	const unreadCount = currentPosts.filter(
		(post) => !isRead(post.publishedAt, lastReadAt),
	).length;
	const loadedSummary = `${unreadCount} unread of ${currentPosts.length} loaded`;
	const progress = settledFeeds < totalFeeds ? ` (${settledFeeds}/${totalFeeds} feeds)` : "";
	const failureNote = failures > 0 ? ` ${failures} feed(s) failed to load — see console.` : "";
	postsStatusEl.textContent = `${loadedSummary}.${progress}${failureNote}`;
}

// Renders each feed's posts as soon as that one feed resolves, merged into the
// running sorted list, rather than waiting for every feed (there can be dozens)
// to finish before showing anything.
async function loadPosts(feeds: Feed[]): Promise<void> {
	currentPosts = [];
	currentFeedTitleByUrl = new Map();
	totalFeeds = 0;
	settledFeeds = 0;
	failures = 0;

	if (feeds.length === 0) {
		postListEl.replaceChildren();
		postsStatusEl.textContent = "No feeds subscribed yet.";
		return;
	}

	lastReadAt = await getLastReadAt();
	renderPosts();
	await loadInto(feeds);
}

// Loads a batch of feeds into the running list without resetting it, so feeds
// that arrive late from a sync reconcile merge into the same sorted view that
// the local ones are already rendering into.
async function loadInto(feeds: Feed[]): Promise<void> {
	totalFeeds += feeds.length;
	for (const feed of feeds) {
		currentFeedTitleByUrl.set(feed.feedUrl, feed.title);
	}
	updateLoadStatus();

	await Promise.allSettled(
		feeds.map(async (feed) => {
			try {
				const { siteUrl, posts } = await fetchPosts(feed);
				rememberSiteUrl(feed, siteUrl);
				currentPosts.push(...posts);
				currentPosts.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
				renderPosts();
			} catch (err) {
				failures++;
				console.error(err);
			} finally {
				settledFeeds++;
				updateLoadStatus();
			}
		}),
	);
}

// Reconciles this device's feed list with the group's. Returns the feeds that
// were not known locally, so their posts can be loaded into the view that is
// already rendering.
//
// The server is authoritative: it owns the timestamps and therefore the
// last-write-wins outcome. This device only reports what it has that the group
// does not, and then adopts the result.
async function reconcileFeeds(token: string): Promise<Feed[]> {
	const remote = await pullFeeds(token);
	const remoteUrls = new Set(remote.map((feed) => feed.feedUrl));

	// Local-only feeds are adds this device made before pairing or while
	// offline. (There is no local delete yet, so a feed missing here can only
	// mean "never pushed", never "deleted locally" — revisit when removal
	// lands, since the two become indistinguishable.)
	const additions = currentFeeds.filter((feed) => !remoteUrls.has(feed.feedUrl));
	const group =
		additions.length > 0 ? await pushFeedChanges(token, additions) : remote;

	const live = group.filter((feed) => feed.deletedAt === null);
	const tombstoned = group
		.filter((feed) => feed.deletedAt !== null)
		.map((feed) => feed.feedUrl);

	const localUrls = new Set(currentFeeds.map((feed) => feed.feedUrl));
	const arrived = live.filter((feed) => !localUrls.has(feed.feedUrl));

	await saveFeeds(live.map(({ feedUrl, title }) => ({ feedUrl, title })));
	await deleteFeeds(tombstoned);

	currentFeeds = await getAllFeeds();
	renderFeeds(currentFeeds);
	return arrived.map(({ feedUrl, title }) => ({ feedUrl, title }));
}

async function refresh(): Promise<void> {
	syncToken = await getDeviceToken();
	feedsReconciled = false;
	currentFeeds = await getAllFeeds();
	renderFeeds(currentFeeds);

	// Reconcile runs alongside the first paint rather than gating it: the common
	// case is that nothing changed, and making every load wait on a round trip
	// would trade the app's one genuinely fast moment for nothing. Feeds the
	// reconcile turns up are loaded straight into the list that is already
	// rendering — incremental rendering merges late arrivals anyway.
	const reconciling =
		syncToken === null ? null : reconcileFeeds(syncToken).catch((err) => {
			console.error(err);
			return null;
		});

	await loadPosts(currentFeeds);

	if (reconciling !== null) {
		const arrived = await reconciling;
		if (arrived !== null) {
			feedsReconciled = true;
			if (arrived.length > 0) await loadInto(arrived);
		}
	}

	if (syncToken !== null) {
		await pullWatermarkIntoLocal(syncToken);
		await pushWatermarkIfAllowed();
	}
}

// Pulling is safe even from a degraded load: max() can only move the watermark
// forward, and the remote value is another device's claim from a load that may
// well have been complete. Only the push is ever gated.
async function pullWatermarkIntoLocal(token: string): Promise<void> {
	try {
		applyWatermark(mergeWatermark(lastReadAt, await pullWatermark(token)));
	} catch (err) {
		console.error(err);
	}
}

fileInput.addEventListener("change", async () => {
	const file = fileInput.files?.[0];
	if (!file) return;

	try {
		const feeds = parseOpml(await file.text());
		if (feeds.length === 0) {
			statusEl.textContent = "No feeds found in that OPML file.";
			return;
		}
		await saveFeeds(feeds);
		statusEl.textContent = `Imported ${feeds.length} feed(s).`;
		await refresh();
	} catch (err) {
		console.error(err);
		statusEl.textContent =
			err instanceof Error ? err.message : "Failed to import OPML file.";
	} finally {
		fileInput.value = "";
	}
});

refresh();
