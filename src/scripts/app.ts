import QRCode from "qrcode";
import {
	deleteFavourite,
	deleteFeeds,
	type Favourite,
	type Feed,
	getFavourites,
	getAllFeeds,
	getDeviceToken,
	getLastReadAt,
	saveFavourite,
	saveFeeds,
	setDeviceToken,
	setLastReadAt,
} from "../lib/db";
import { parseFeed, type ParsedFeed, type Post } from "../lib/feed-parser";
import { parseOpml } from "../lib/opml";
import { isOnline, onConnectivityChange } from "../lib/connectivity";
import { describeImport, normalizeFeedUrl, planAdditions } from "../lib/subscriptions";
import {
	leaveSync,
	type PairResponse,
	pullFeeds,
	pullWatermark,
	pushFeedChanges,
	pushWatermark,
	startPairing,
	SyncError,
} from "../lib/sync-client";
import { formatPairCode, mergeWatermark } from "../lib/sync-state";
import {
	favouriteKey,
	isListed,
	isRead,
	watermarkAfterClick,
	watermarkAfterMarkUpTo,
} from "../lib/read-state";
import { formatFullDate, formatPostDate } from "../lib/relative-date";

const fileInput = document.querySelector<HTMLInputElement>("#opml-input")!;
const addFeedForm = document.querySelector<HTMLFormElement>("#add-feed-form")!;
const feedUrlInput = document.querySelector<HTMLInputElement>("#feed-url")!;
const addFeedButton =
	document.querySelector<HTMLButtonElement>("#add-feed-button")!;
const feedListEl = document.querySelector<HTMLUListElement>("#feed-list")!;
const postListEl = document.querySelector<HTMLUListElement>("#post-list")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const postsStatusEl =
	document.querySelector<HTMLParagraphElement>("#posts-status")!;
const feedErrorsEl =
	document.querySelector<HTMLDetailsElement>("#feed-errors")!;
const feedErrorsSummaryEl =
	document.querySelector<HTMLElement>("#feed-errors-summary")!;
const feedErrorListEl =
	document.querySelector<HTMLUListElement>("#feed-error-list")!;
const syncBannerEl = document.querySelector<HTMLDivElement>("#sync-banner")!;
const syncBannerMessageEl =
	document.querySelector<HTMLParagraphElement>("#sync-banner-message")!;
const syncBannerPushButton =
	document.querySelector<HTMLButtonElement>("#sync-banner-push")!;
const syncBannerDismissButton =
	document.querySelector<HTMLButtonElement>("#sync-banner-dismiss")!;
const syncSetupButton =
	document.querySelector<HTMLButtonElement>("#sync-setup-button")!;
const syncUnpairButton =
	document.querySelector<HTMLButtonElement>("#sync-unpair-button")!;
const syncSetupStatusEl =
	document.querySelector<HTMLParagraphElement>("#sync-setup-status")!;
const pairingPanelEl =
	document.querySelector<HTMLDivElement>("#pairing-panel")!;
const pairingQrCanvas =
	document.querySelector<HTMLCanvasElement>("#pairing-qr")!;
const pairingUrlEl = document.querySelector<HTMLElement>("#pairing-url")!;
const pairingCodeEl = document.querySelector<HTMLElement>("#pairing-code")!;
const pairingExpiryEl =
	document.querySelector<HTMLParagraphElement>("#pairing-expiry")!;
const pairingDoneButton =
	document.querySelector<HTMLButtonElement>("#pairing-done")!;
const refreshButton = document.querySelector<HTMLButtonElement>("#refresh-button")!;
const unreadTab = document.querySelector<HTMLButtonElement>("#view-unread")!;
const favouritesTab = document.querySelector<HTMLButtonElement>("#view-favourites")!;
const feedTab = document.querySelector<HTMLButtonElement>("#view-feed")!;

// Re-rendered on every connectivity change: the feed failures below say what
// happened, and "Offline" says why, which is the part a user can't infer.
let online = isOnline();
onConnectivityChange((next) => {
	online = next;
	updateLoadStatus();
});

// Module state so a click handler (see markReadIfNext below) can re-render
// without refetching every feed.
let currentPosts: Post[] = [];
let currentFeeds: Feed[] = [];
// The site's own feed list: ships with the build, fetched fresh every load,
// identical for every visitor. Never written to IndexedDB or pushed to a
// sync group — see the Obsidian decision log's curated-feed-list entry.
let curatedFeeds: Feed[] = [];
let currentFeedTitleByUrl = new Map<string, string>();
let lastReadAt: string | null = null;
// The watermark as this load began (and as it settled after the sync pull).
// Posts read before it aren't shown; posts read since stay, greyed out, until
// the next load — see isListed.
let listedAfter: string | null = null;
// Favourites by favouriteKey, and which list is showing.
let favourites = new Map<string, Favourite>();
let view: "unread" | "favourites" | "feed" = "unread";
// The feed whose posts the "feed" view shows.
let viewedFeedUrl: string | null = null;

// Load progress, module-scoped so the push gate below can read the *final*
// failure count rather than a provisional one.
let totalFeeds = 0;
let settledFeeds = 0;
// Every feed that failed this load, by URL, with the reason shown to the user.
// Its size is the failure count; a retry or removal takes an entry out.
let feedErrors = new Map<string, string>();

// Null means this device never opted into sync; it then never touches the
// network and behaves exactly as before.
let syncToken: string | null = null;

// Whether this load managed to confirm its feed set against the group. The
// watermark is never pushed while this is false: a device whose feed list is
// unconfirmed may be missing a feed another device added, and pushing from
// that view marks posts read that were never shown anywhere.
let feedsReconciled = false;

// Whether the degraded-load banner has already been shown (or would have
// been) for the current load. markRead fires on every click, so without this
// a run of clicks against a degraded load would reopen the banner — or worse,
// silently re-decide it — after the user already dismissed it once.
let degradedBannerPrompted = false;

// Whether the watermark advanced while some feed was failing. A retry that
// brings every feed back only gets to push on its own if this is false: a
// watermark moved against a view with feeds missing may already sit past
// posts that were never shown, which is the banner's question to ask.
let readWhileDegraded = false;

function renderFeeds(feeds: Feed[]): void {
	const curated = curatedUrls();
	feedListEl.replaceChildren(
		...feeds.map((feed) => {
			const li = document.createElement("li");
			const error = feedErrors.get(feed.feedUrl);
			if (error !== undefined) {
				li.className = "failed";
				li.title = `Failed to load: ${error}`;
				const mark = document.createElement("span");
				mark.className = "failed-mark";
				mark.textContent = "⚠";
				mark.setAttribute("aria-label", "Failed to load:");
				li.append(mark);
			}

			const openButton = document.createElement("button");
			openButton.type = "button";
			openButton.className = "feed-open";
			openButton.textContent = feed.title;
			openButton.addEventListener("click", () => showFeed(feed));
			li.append(openButton);

			// Only once the feed's homepage is known — see rememberSiteUrl.
			if (feed.siteUrl !== undefined) {
				const link = document.createElement("a");
				link.href = feed.siteUrl;
				link.className = "site-link";
				link.textContent = "↗";
				link.title = `Open ${feed.title}'s site`;
				link.setAttribute("aria-label", `Open ${feed.title}'s site`);
				link.target = "_blank";
				link.rel = "noopener noreferrer";
				li.append(link);
			}

			// Your own feeds only: a curated feed ships with the site, so
			// dropping one is an edit to curated-feeds.opml.
			if (!curated.has(feed.feedUrl)) {
				const removeButton = document.createElement("button");
				removeButton.type = "button";
				removeButton.className = "remove-feed";
				removeButton.textContent = "×";
				removeButton.title = `Unsubscribe from ${feed.title}`;
				removeButton.setAttribute("aria-label", `Unsubscribe from ${feed.title}`);
				removeButton.addEventListener("click", () => {
					void removeFeed(feed);
				});
				li.append(removeButton);
			}
			return li;
		}),
	);
}

function renderAllFeeds(): void {
	renderFeeds([...curatedFeeds, ...currentFeeds]);
}

// The feed list renders straight from IndexedDB/the curated fetch, before any
// feed is fetched, so on the very first load links appear one by one as each
// feed resolves. Curated feeds aren't persisted here — they're re-fetched
// fresh every load, so there's nowhere for the discovery to usefully live
// beyond this session; personal feeds persist to IndexedDB so later visits
// have them immediately.
function rememberSiteUrl(feed: Feed, siteUrl: string | null): void {
	if (siteUrl === null || feed.siteUrl === siteUrl) return;

	const updated: Feed = { ...feed, siteUrl };
	if (curatedFeeds.some((existing) => existing.feedUrl === feed.feedUrl)) {
		curatedFeeds = curatedFeeds.map((existing) =>
			existing.feedUrl === feed.feedUrl ? updated : existing,
		);
	} else {
		currentFeeds = currentFeeds.map((existing) =>
			existing.feedUrl === feed.feedUrl ? updated : existing,
		);
		void saveFeeds([updated]);
	}
	renderAllFeeds();
}

// Posts are sorted ascending (earliest first), and read/unread is derived from
// `lastReadAt` rather than stored per-post — see src/lib/read-state.ts and the
// Obsidian decision log.
function renderPosts(): void {
	if (view === "favourites") {
		renderFavourites();
		updateLoadStatus();
		return;
	}
	if (view === "feed" && viewedFeedUrl !== null) {
		renderFeedPosts(viewedFeedUrl);
		updateLoadStatus();
		return;
	}

	// `index` is each post's position in the *full* currentPosts array (not
	// the filtered list), since watermarkAfterClick's index semantics are
	// defined against the full array.
	const listed = currentPosts
		.map((post, index) => ({ post, index }))
		.filter(({ post }) => isListed(post.publishedAt, listedAfter));

	const now = new Date();
	postListEl.replaceChildren(
		...listed.map(({ post, index }) => {
			const read = isRead(post.publishedAt, lastReadAt);
			const li = postItem(post, currentFeedTitleByUrl.get(post.feedUrl) ?? post.feedUrl, now, () => {
				const newLastReadAt = watermarkAfterClick(currentPosts, lastReadAt, index);
				if (newLastReadAt !== null) {
					void markRead(newLastReadAt);
				}
			});
			// Read but not yet cleared: still there to find again, visibly done.
			li.classList.toggle("read", read);
			if (!read) {
				const markButton = document.createElement("button");
				markButton.type = "button";
				markButton.className = "mark-read";
				markButton.textContent = "✓";
				markButton.title = "Mark read up to here";
				markButton.setAttribute("aria-label", `Mark read up to "${post.title}"`);
				markButton.addEventListener("click", () => {
					void markReadUpTo(post);
				});
				li.append(markButton);
			}
			return li;
		}),
	);
	updateLoadStatus();
}

// Newest first, like Read You's starred list: favourites are a collection
// to come back to, not a queue to work through.
function renderFavourites(): void {
	const sorted = [...favourites.values()].sort((a, b) =>
		b.publishedAt.localeCompare(a.publishedAt),
	);
	if (sorted.length === 0) {
		const empty = document.createElement("li");
		empty.className = "empty";
		empty.textContent = "No favourites yet. ♡ a post to keep it here after it's read.";
		postListEl.replaceChildren(empty);
		return;
	}
	const now = new Date();
	postListEl.replaceChildren(
		...sorted.map((favourite) => {
			// The same watermark rule as the main list: opening the very next
			// unread post advances it, from wherever it's opened.
			const index = currentPosts.findIndex(
				(post) => favouriteKey(post) === favourite.key,
			);
			return postItem(favourite, favourite.feedTitle, now, () => {
				if (index === -1) return;
				const next = watermarkAfterClick(currentPosts, lastReadAt, index);
				if (next !== null) void markRead(next);
			});
		}),
	);
}

// Newest first, read posts included: everything this load fetched from the
// feed, to browse rather than work through. Unlike the unread list, nothing
// here is hidden by listedAfter.
function renderFeedPosts(feedUrl: string): void {
	const listed = currentPosts
		.map((post, index) => ({ post, index }))
		.filter(({ post }) => post.feedUrl === feedUrl)
		.reverse();
	if (listed.length === 0) {
		const empty = document.createElement("li");
		empty.className = "empty";
		empty.textContent = feedErrors.get(feedUrl) ?? "No posts loaded from this feed yet.";
		postListEl.replaceChildren(empty);
		return;
	}
	const now = new Date();
	postListEl.replaceChildren(
		...listed.map(({ post, index }) => {
			// The same watermark rule as the main list.
			const li = postItem(post, currentFeedTitleByUrl.get(feedUrl) ?? feedUrl, now, () => {
				const next = watermarkAfterClick(currentPosts, lastReadAt, index);
				if (next !== null) void markRead(next);
			});
			li.classList.toggle("read", isRead(post.publishedAt, lastReadAt));
			return li;
		}),
	);
}

// One post row — link, feed · date, and the favourite toggle — shared by
// every list. The caller adds whatever else its list needs.
function postItem(
	post: Post,
	feedTitle: string,
	now: Date,
	onOpen: () => void,
): HTMLLIElement {
	const li = document.createElement("li");

	const link = document.createElement("a");
	link.href = post.link;
	link.textContent = post.title;
	link.target = "_blank";
	link.rel = "noopener noreferrer";
	link.addEventListener("click", onOpen);

	const meta = document.createElement("span");
	meta.className = "meta";

	const feedName = document.createElement("span");
	feedName.className = "feed-name";
	feedName.textContent = feedTitle;

	// The exact date stays one hover away once the label goes relative.
	const date = document.createElement("time");
	date.className = "date";
	date.dateTime = post.publishedAt;
	date.title = formatFullDate(new Date(post.publishedAt));
	date.textContent = formatPostDate(post.publishedAt, now);

	meta.append(feedName, date);

	const body = document.createElement("div");
	body.className = "post-body";
	body.append(link, meta);

	const key = favouriteKey(post);
	const isFavourite = favourites.has(key);
	const favouriteButton = document.createElement("button");
	favouriteButton.type = "button";
	favouriteButton.className = "favourite";
	favouriteButton.textContent = isFavourite ? "♥" : "♡";
	favouriteButton.setAttribute("aria-pressed", String(isFavourite));
	favouriteButton.title = isFavourite ? "Remove from favourites" : "Add to favourites";
	favouriteButton.addEventListener("click", () => {
		void toggleFavourite(post, feedTitle);
	});

	li.append(body, favouriteButton);
	return li;
}

async function toggleFavourite(post: Post, feedTitle: string): Promise<void> {
	const key = favouriteKey(post);
	if (favourites.has(key)) {
		favourites.delete(key);
		await deleteFavourite(key);
	} else {
		const favourite: Favourite = {
			key,
			feedTitle,
			feedUrl: post.feedUrl,
			guid: post.guid,
			title: post.title,
			link: post.link,
			publishedAt: post.publishedAt,
		};
		favourites.set(key, favourite);
		await saveFavourite(favourite);
	}
	renderPosts();
}

function showView(next: typeof view): void {
	view = next;
	unreadTab.setAttribute("aria-pressed", String(next === "unread"));
	favouritesTab.setAttribute("aria-pressed", String(next === "favourites"));
	feedTab.hidden = next !== "feed";
	renderPosts();
}

function showFeed(feed: Feed): void {
	viewedFeedUrl = feed.feedUrl;
	feedTab.textContent = feed.title;
	showView("feed");
	// The feed list sits below the posts, so its posts would load out of sight.
	feedTab.scrollIntoView({ block: "start" });
}

unreadTab.addEventListener("click", () => showView("unread"));
favouritesTab.addEventListener("click", () => showView("favourites"));

async function markRead(publishedAt: string): Promise<void> {
	if (feedErrors.size > 0) readWhileDegraded = true;
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
	// A failed feed only misleads this device — until sync. Pushing from here
	// would make that watermark authoritative on a device where those feeds
	// loaded fine, marking posts read that were never shown anywhere. Ask
	// first, via the banner, rather than silently refusing or silently pushing.
	if (feedErrors.size > 0) {
		showDegradedBanner();
		return;
	}

	await pushWatermarkNow();
}

async function pushWatermarkNow(): Promise<void> {
	if (syncToken === null || lastReadAt === null) return;
	try {
		const winner = await pushWatermark(syncToken, lastReadAt);
		// The server applies max(), so a push carrying a lower value comes back
		// with the stored higher one. Adopt it rather than believing our own.
		applyWatermark(mergeWatermark(lastReadAt, winner));
	} catch (err) {
		console.error(err);
	}
}

// Shown at most once per load (see degradedBannerPrompted): by the time this
// runs, feeds have settled and reconciled, so every later click this load
// would ask the identical question. Declining costs nothing — the value stays
// local, and the next clean load pushes the whole accumulated watermark on
// its own — so the message says that, to make "keep local" an easy choice.
function showDegradedBanner(): void {
	if (degradedBannerPrompted) return;
	degradedBannerPrompted = true;

	const failures = feedErrors.size;
	syncBannerMessageEl.textContent =
		`${failures} feed${failures === 1 ? "" : "s"} failed to load, so this ` +
		"device's reading position wasn't sent to your other devices. It's " +
		"saved locally either way — the next load that succeeds will sync it " +
		"automatically.";
	syncBannerEl.hidden = false;
}

function hideDegradedBanner(): void {
	syncBannerEl.hidden = true;
}

syncBannerPushButton.addEventListener("click", async () => {
	hideDegradedBanner();
	await pushWatermarkNow();
});

syncBannerDismissButton.addEventListener("click", () => {
	hideDegradedBanner();
});

// Ticks the countdown on the open pairing panel; cleared whenever the panel
// is hidden or replaced with a fresh code, so at most one runs at a time.
let pairingExpiryTimer: ReturnType<typeof setInterval> | undefined;

function updateSyncSetupButton(): void {
	syncSetupButton.textContent =
		syncToken === null ? "Set up sync" : "Add another device";
	syncUnpairButton.hidden = syncToken === null;
}

// A group holds two devices. Asked only when the server says it's full: the
// other device may be one that's gone (lost, wiped, reinstalled) and can't
// unpair itself, so this is the way to take its place back.
async function startPairingOrReplace(): Promise<PairResponse | null> {
	try {
		return await startPairing(syncToken, lastReadAt);
	} catch (err) {
		if (!(err instanceof SyncError && err.status === 409)) throw err;
		const replace = confirm(
			"This sync group already has two devices. Replace the other one? " +
				"It stops syncing, and would need a new code to rejoin.",
		);
		return replace ? await startPairing(syncToken, lastReadAt, true) : null;
	}
}

function updatePairingExpiry(expiresAt: number): void {
	clearInterval(pairingExpiryTimer);
	const tick = () => {
		const secondsLeft = Math.round((expiresAt - Date.now()) / 1000);
		if (secondsLeft <= 0) {
			pairingExpiryEl.textContent = "This code has expired.";
			clearInterval(pairingExpiryTimer);
			return;
		}
		const minutesLeft = Math.ceil(secondsLeft / 60);
		pairingExpiryEl.textContent = `Expires in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.`;
	};
	tick();
	pairingExpiryTimer = setInterval(tick, 1000);
}

function showPairingPanel(pairCode: string, expiresAt: number): void {
	pairingCodeEl.textContent = formatPairCode(pairCode);
	pairingUrlEl.textContent = `${location.origin}/pair`;
	pairingPanelEl.hidden = false;
	updatePairingExpiry(expiresAt);
	// The code travels in the URL fragment, never the query string or path, so
	// it never reaches a server access log — see the Obsidian decision log.
	void QRCode.toCanvas(pairingQrCanvas, `${location.origin}/pair#${pairCode}`, {
		width: 200,
	});
}

function hidePairingPanel(): void {
	pairingPanelEl.hidden = true;
	clearInterval(pairingExpiryTimer);
}

syncSetupButton.addEventListener("click", async () => {
	syncSetupButton.disabled = true;
	syncSetupStatusEl.textContent = "";
	try {
		const result = await startPairingOrReplace();
		if (result === null) return;
		if (result.deviceToken !== undefined) {
			await setDeviceToken(result.deviceToken);
			syncToken = result.deviceToken;
			updateSyncSetupButton();
			// First pairing: this device's feeds and watermark have never been
			// pushed anywhere. Reuse the normal load sequence rather than
			// re-deriving reconcile-then-push here — refresh() already does
			// exactly that whenever syncToken is non-null.
			void refresh();
		}
		showPairingPanel(result.pairCode, result.expiresAt);
	} catch (err) {
		console.error(err);
		syncSetupStatusEl.textContent = "Couldn't start pairing. Try again.";
	} finally {
		syncSetupButton.disabled = false;
	}
});

pairingDoneButton.addEventListener("click", hidePairingPanel);

// Leaves on the server first, so the group's place is actually freed; only
// then is the token forgotten here. A 401 means the server already let this
// device go (replaced from the other one), so there's nothing left to free.
syncUnpairButton.addEventListener("click", async () => {
	if (syncToken === null) return;
	if (!confirm("Unpair this device? Its feeds and reading position stay here.")) return;
	syncUnpairButton.disabled = true;
	syncSetupStatusEl.textContent = "";
	try {
		await leaveSync(syncToken);
	} catch (err) {
		if (!(err instanceof SyncError && err.status === 401)) {
			console.error(err);
			syncSetupStatusEl.textContent = "Couldn't reach the server to unpair. Try again.";
			syncUnpairButton.disabled = false;
			return;
		}
	}
	await setDeviceToken(null);
	syncToken = null;
	feedsReconciled = false;
	hideDegradedBanner();
	hidePairingPanel();
	updateSyncSetupButton();
	syncUnpairButton.disabled = false;
	syncSetupStatusEl.textContent =
		"This device no longer syncs. Its feeds and reading position stay here.";
});

function applyWatermark(next: string | null): void {
	if (next === null || next === lastReadAt) return;
	lastReadAt = next;
	void setLastReadAt(next);
	renderPosts();
}

// Replaces click-to-advance's one-post-at-a-time rule when you mean to skip:
// everything up to and including this post is marked read, whether or not it
// was opened. Asks first only when that skips more than the one post, since a
// marked post can't be brought back — the watermark is forward-only and, once
// synced, max()-merged on every device.
async function markReadUpTo(post: Post): Promise<void> {
	const next = watermarkAfterMarkUpTo(lastReadAt, post.publishedAt);
	if (next === null) return;

	const marked = currentPosts.filter(
		(candidate) =>
			!isRead(candidate.publishedAt, lastReadAt) &&
			isRead(candidate.publishedAt, next),
	).length;
	if (marked > 1 && !confirm(`Mark ${marked} posts as read?`)) return;

	await markRead(next);
}

async function fetchPosts(feed: Feed): Promise<ParsedFeed> {
	const res = await fetch(`/api/feed?url=${encodeURIComponent(feed.feedUrl)}`);
	if (!res.ok) {
		throw new Error(await proxyErrorMessage(res));
	}
	return parseFeed(await res.text(), feed.feedUrl);
}

// /api/feed explains its failures in a JSON body ("Feed responded with 404."),
// which says far more than the proxy's own status, always 400 or 502.
async function proxyErrorMessage(res: Response): Promise<string> {
	try {
		const body = (await res.json()) as { error?: unknown };
		if (typeof body.error === "string") return body.error;
	} catch {
		// Not JSON, e.g. a platform error page — fall through to the status.
	}
	return `Request failed (${res.status}).`;
}

// What a failed feed shows the user. A fetch that never got a response is a
// TypeError with a browser-specific message ("Failed to fetch", "Load
// failed"), so it's named here instead.
function describeFeedError(err: unknown): string {
	if (err instanceof TypeError) return "Couldn't reach the server.";
	return err instanceof Error ? err.message : String(err);
}

function updateLoadStatus(): void {
	const unreadCount = currentPosts.filter(
		(post) => !isRead(post.publishedAt, lastReadAt),
	).length;
	const loadedSummary = `${unreadCount} unread of ${currentPosts.length} loaded`;
	const progress = settledFeeds < totalFeeds ? ` (${settledFeeds}/${totalFeeds} feeds)` : "";
	// Leads, because offline is the reason most or all of those failures
	// happened, and a row of "feed(s) failed" on its own reads like a broken
	// app rather than a phone in a tunnel.
	const offlineNote = online ? "" : "Offline — ";
	postsStatusEl.textContent = `${offlineNote}${loadedSummary}.${progress}`;
	showUnreadCount(unreadCount);
}

// The tab title, so the count is visible without switching to the tab.
function showUnreadCount(count: number): void {
	document.title = count > 0 ? `(${count}) RSS Reader` : "RSS Reader";
}

// The failure count, expandable into the list of failed feeds with a way to
// retry each — and, for a feed of your own, to unsubscribe from one that keeps
// failing. Curated feeds can't be removed here: they ship with the build, so
// dropping one is an edit to curated-feeds.opml.
function renderFeedErrors(): void {
	const failures = feedErrors.size;
	feedErrorsEl.hidden = failures === 0;
	if (failures === 0) {
		feedErrorsEl.open = false;
		feedErrorListEl.replaceChildren();
		return;
	}

	feedErrorsSummaryEl.textContent = `${failures} feed${failures === 1 ? "" : "s"} failed to load`;
	const curated = curatedUrls();
	const failed = [...curatedFeeds, ...currentFeeds].filter((feed) =>
		feedErrors.has(feed.feedUrl),
	);

	feedErrorListEl.replaceChildren(
		...failed.map((feed) => {
			const li = document.createElement("li");

			const name = document.createElement("span");
			name.className = "feed-error-name";
			name.textContent = feed.title;

			const reason = document.createElement("span");
			reason.className = "feed-error-reason";
			reason.textContent = feedErrors.get(feed.feedUrl) ?? "";

			const actions = document.createElement("span");
			actions.className = "feed-error-actions";

			const retryButton = document.createElement("button");
			retryButton.type = "button";
			retryButton.textContent = "Retry";
			retryButton.addEventListener("click", () => {
				retryButton.disabled = true;
				retryButton.textContent = "Retrying…";
				void retryFeed(feed);
			});
			actions.append(retryButton);

			if (curated.has(feed.feedUrl)) {
				const note = document.createElement("span");
				note.className = "feed-error-note";
				note.textContent = "Curated";
				note.title = "Ships with the site — remove it from curated-feeds.opml";
				actions.append(note);
			} else {
				const removeButton = document.createElement("button");
				removeButton.type = "button";
				removeButton.textContent = "Remove";
				removeButton.addEventListener("click", () => {
					void removeFeed(feed);
				});
				actions.append(removeButton);
			}

			li.append(name, reason, actions);
			return li;
		}),
	);
}

// Re-renders everything a change in feedErrors shows up in.
function feedErrorsChanged(): void {
	renderFeedErrors();
	renderAllFeeds();
	updateLoadStatus();
}

// The failed feed has no posts in the list, so a success just merges them in
// like any late arrival. When that clears the last failure the load is no
// longer degraded, and the watermark push it was holding back can go — unless
// you read while it was degraded, which stays the banner's question.
async function retryFeed(feed: Feed): Promise<void> {
	try {
		const { siteUrl, posts } = await fetchPosts(feed);
		feedErrors.delete(feed.feedUrl);
		rememberSiteUrl(feed, siteUrl);
		appendPosts(feed, posts);
	} catch (err) {
		console.error(`${feed.title}:`, err);
		feedErrors.set(feed.feedUrl, describeFeedError(err));
	}
	feedErrorsChanged();

	if (feedErrors.size === 0 && !readWhileDegraded) {
		hideDegradedBanner();
		void pushWatermarkIfAllowed();
	}
}

// Unsubscribes from one of your own feeds. On a synced device the removal goes
// to the group first, and the local delete only follows once the group has it:
// there are no local tombstones, so a feed deleted here but still live in the
// group would be restored by the very next reconcile.
async function removeFeed(feed: Feed): Promise<void> {
	if (!confirm(`Unsubscribe from ${feed.title}?`)) return;

	if (syncToken !== null) {
		try {
			await pushFeedChanges(syncToken, [], [feed.feedUrl]);
		} catch (err) {
			console.error(err);
			alert(`Couldn't remove ${feed.title} from your synced devices. Try again when you're online.`);
			return;
		}
	}
	await deleteFeeds([feed.feedUrl]);

	currentFeeds = currentFeeds.filter((existing) => existing.feedUrl !== feed.feedUrl);
	currentPosts = currentPosts.filter((post) => post.feedUrl !== feed.feedUrl);
	renderAllFeeds();
	// It counted towards this load's progress as a settled feed; it no longer
	// counts at all.
	if (feedErrors.delete(feed.feedUrl)) {
		totalFeeds--;
		settledFeeds--;
	}
	if (viewedFeedUrl === feed.feedUrl && view === "feed") showView("unread");
	else renderPosts();
	feedErrorsChanged();
}

// Renders each feed's posts as soon as that one feed resolves, merged into the
// running sorted list, rather than waiting for every feed (there can be dozens)
// to finish before showing anything.
async function loadPosts(feeds: Feed[]): Promise<void> {
	currentPosts = [];
	currentFeedTitleByUrl = new Map();
	totalFeeds = 0;
	settledFeeds = 0;
	feedErrors = new Map();
	renderFeedErrors();

	if (feeds.length === 0) {
		postListEl.replaceChildren();
		postsStatusEl.textContent = "No feeds subscribed yet.";
		showUnreadCount(0);
		return;
	}

	lastReadAt = await getLastReadAt();
	listedAfter = lastReadAt;
	renderPosts();
	await loadInto(feeds);
}

// Merges one feed's posts into the running sorted list and re-renders, rather
// than waiting for every feed (there can be dozens) to finish before showing
// anything. Shared by the load below and the add-one-feed path, which already
// has its posts in hand from the fetch that validated the URL. The title is
// registered here rather than up front, since a post can only exist once the
// feed it came from has resolved.
function appendPosts(feed: Feed, posts: Post[]): void {
	currentFeedTitleByUrl.set(feed.feedUrl, feed.title);
	currentPosts.push(...posts);
	currentPosts.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
	renderPosts();
}

// Loads a batch of feeds into the running list without resetting it, so feeds
// that arrive late from a sync reconcile merge into the same sorted view that
// the local ones are already rendering into.
async function loadInto(feeds: Feed[]): Promise<void> {
	totalFeeds += feeds.length;
	updateLoadStatus();

	await Promise.allSettled(
		feeds.map(async (feed) => {
			try {
				const { siteUrl, posts } = await fetchPosts(feed);
				rememberSiteUrl(feed, siteUrl);
				appendPosts(feed, posts);
			} catch (err) {
				console.error(`${feed.title}:`, err);
				feedErrors.set(feed.feedUrl, describeFeedError(err));
				renderFeedErrors();
				renderAllFeeds();
			} finally {
				settledFeeds++;
				updateLoadStatus();
			}
		}),
	);
}

// Adds feeds to the rendered list. The in-memory half of subscribing, shared by
// both add paths: each caller has already written its feeds to IndexedDB.
function subscribeLocally(feeds: Feed[]): void {
	currentFeeds = [...currentFeeds, ...feeds];
	renderAllFeeds();
}

// Curated feeds ship with the build and are subscribed to by every visitor, so
// they count as already-subscribed for both add paths, and their URLs are what
// reconcileFeeds keys off to keep them out of the sync group.
function curatedUrls(): Set<string> {
	return new Set(curatedFeeds.map((feed) => feed.feedUrl));
}

// Reconciles this device's feed list with the group's. Returns the feeds that
// were not known locally, so their posts can be loaded into the view that is
// already rendering.
//
// The server is authoritative: it owns the timestamps and therefore the
// last-write-wins outcome. This device only reports what it has that the group
// does not, and then adopts the result.
async function reconcileFeeds(
	token: string,
	curatedUrls: Set<string>,
): Promise<Feed[]> {
	const remote = await pullFeeds(token);
	const remoteUrls = new Set(remote.map((feed) => feed.feedUrl));

	// Local-only feeds are adds this device made before pairing or while
	// offline. (There is no local delete yet, so a feed missing here can only
	// mean "never pushed", never "deleted locally" — revisit when removal
	// lands, since the two become indistinguishable.) Curated feeds are never
	// pushed as additions — they're identical for every group already.
	const additions = currentFeeds.filter(
		(feed) => !remoteUrls.has(feed.feedUrl) && !curatedUrls.has(feed.feedUrl),
	);
	// A feed that's curated as of this load but still sits live in the group's
	// delta predates the curated list (see the Obsidian decision log's
	// migration note) — retract it from the group too, in the same request, or
	// every paired device's next pull just resurrects it as "personal".
	const shadowedInGroup = remote
		.filter((feed) => feed.deletedAt === null && curatedUrls.has(feed.feedUrl))
		.map((feed) => feed.feedUrl);

	const group =
		additions.length > 0 || shadowedInGroup.length > 0
			? await pushFeedChanges(token, additions, shadowedInGroup)
			: remote;

	const live = group.filter(
		(feed) => feed.deletedAt === null && !curatedUrls.has(feed.feedUrl),
	);
	const tombstoned = group
		.filter((feed) => feed.deletedAt !== null)
		.map((feed) => feed.feedUrl);

	const localUrls = new Set(currentFeeds.map((feed) => feed.feedUrl));
	const arrived = live.filter((feed) => !localUrls.has(feed.feedUrl));

	await saveFeeds(live.map(({ feedUrl, title }) => ({ feedUrl, title })));
	await deleteFeeds(tombstoned);

	currentFeeds = await getAllFeeds();
	renderAllFeeds();
	return arrived.map(({ feedUrl, title }) => ({ feedUrl, title }));
}

// Fetched fresh every load — same-origin static asset, ships with the build,
// identical for every visitor. A fetch failure just means no curated feeds
// this load rather than a blocked page; see the Obsidian decision log.
async function loadCuratedFeeds(): Promise<Feed[]> {
	try {
		const res = await fetch("/curated-feeds.opml");
		if (!res.ok) return [];
		return parseOpml(await res.text());
	} catch (err) {
		console.error(err);
		return [];
	}
}

async function refresh(): Promise<void> {
	refreshButton.disabled = true;
	try {
		await refreshOnce();
	} finally {
		refreshButton.disabled = false;
	}
}

refreshButton.addEventListener("click", () => {
	void refresh();
});

async function refreshOnce(): Promise<void> {
	favourites = new Map((await getFavourites()).map((f) => [f.key, f]));
	syncToken = await getDeviceToken();
	updateSyncSetupButton();
	feedsReconciled = false;
	degradedBannerPrompted = false;
	readWhileDegraded = false;
	hideDegradedBanner();

	currentFeeds = await getAllFeeds();
	curatedFeeds = await loadCuratedFeeds();
	const curated = curatedUrls();

	// A feed that's curated as of this load but still sits in this device's
	// personal store predates the curated list — drop the personal copy so it
	// isn't rendered twice. reconcileFeeds below retracts it from the sync
	// group too, for any device paired to one.
	const shadowed = currentFeeds.filter((feed) => curated.has(feed.feedUrl));
	if (shadowed.length > 0) {
		await deleteFeeds(shadowed.map((feed) => feed.feedUrl));
		currentFeeds = currentFeeds.filter((feed) => !curated.has(feed.feedUrl));
	}

	renderAllFeeds();

	// Reconcile runs alongside the first paint rather than gating it: the common
	// case is that nothing changed, and making every load wait on a round trip
	// would trade the app's one genuinely fast moment for nothing. Feeds the
	// reconcile turns up are loaded straight into the list that is already
	// rendering — incremental rendering merges late arrivals anyway.
	const reconciling =
		syncToken === null ? null : reconcileFeeds(syncToken, curated).catch((err) => {
			console.error(err);
			return null;
		});

	await loadPosts([...curatedFeeds, ...currentFeeds]);

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
		// Posts another device read are dropped here, as at the start of a
		// load, rather than lingering greyed out.
		listedAfter = lastReadAt;
		renderPosts();
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

// One feed, by URL. Returns whether it was subscribed, so the caller knows
// whether to clear the field — a URL that turned out not to be a feed is worth
// keeping on screen to edit.
async function addSingleFeed(rawUrl: string): Promise<boolean> {
	// The form is type="url" and required, so the browser has already rejected
	// an empty field and anything it doesn't recognize as a URL at all. What
	// gets past that is still worth a second look: normalizeFeedUrl is also
	// what drops a copied-along fragment, and it refuses a scheme /api/feed
	// can't fetch (ftp:, file:, ...) that the browser considers a valid URL.
	const feedUrl = normalizeFeedUrl(rawUrl);
	if (feedUrl === null) {
		statusEl.textContent =
			"Enter a full feed URL, starting with http:// or https://.";
		return false;
	}

	// Asked before the fetch, not after: re-adding a feed you already have is
	// the one case where the answer is knowable without the network, and it
	// should say so immediately.
	const { added } = planAdditions(
		[{ feedUrl, title: feedUrl }],
		[...curatedFeeds, ...currentFeeds],
	);
	if (added.length === 0) {
		statusEl.textContent = "You're already subscribed to that feed.";
		return false;
	}

	addFeedButton.disabled = true;
	try {
		// Fetched before it's saved, so a URL that isn't a feed is reported
		// here rather than joining the list and failing on every load from then
		// on — and so the record is written complete, with the title and
		// homepage the document declares, instead of waiting for a later load
		// to fill them in. The same response is reused for the posts below, so
		// this costs one request, not two.
		const parsed = await fetchPosts(added[0]);
		const feed: Feed = {
			feedUrl,
			// A hand-typed URL has no label of its own, so the feed's declared
			// title is the only thing here worth calling it.
			title: parsed.title ?? feedUrl,
		};
		if (parsed.siteUrl !== null) feed.siteUrl = parsed.siteUrl;

		await saveFeeds([feed]);
		subscribeLocally([feed]);
		// Not loadInto: its counters and fetch belong to the batch a load
		// started, and this feed's posts are already in hand. Only the
		// unread-of-loaded summary is left to update.
		appendPosts(feed, parsed.posts);
		updateLoadStatus();
		statusEl.textContent = `Added ${feed.title}.`;
		void reconcileAddedFeeds();
		return true;
	} catch (err) {
		console.error(err);
		// The overwhelmingly common cause is pasting the site's homepage
		// instead of the feed's own URL, so say that rather than a bare
		// failure: the detail is in the console, as it is for every other feed
		// error in this app.
		statusEl.textContent =
			"Couldn't read that as a feed. Check the URL points at the feed itself, not the site's homepage.";
		return false;
	} finally {
		addFeedButton.disabled = false;
	}
}

// A feed the user just added is a real change, so it goes to the sync group now
// rather than on this device's next load — otherwise the other devices don't
// show it until they happen to reload. Reuses the same reconcile a first load
// runs, and is a no-op when this device never opted into sync.
async function reconcileAddedFeeds(): Promise<void> {
	if (syncToken === null) return;
	try {
		const arrived = await reconcileFeeds(syncToken, curatedUrls());
		feedsReconciled = true;
		if (arrived.length > 0) await loadInto(arrived);
	} catch (err) {
		// The feed is saved and rendering either way; the group catches up on
		// the next load, which reconciles the same way.
		console.error(err);
	}
}

fileInput.addEventListener("change", async () => {
	const file = fileInput.files?.[0];
	if (!file) return;

	try {
		// Additive by construction — see planAdditions. Re-importing a file the
		// device already has adds nothing and rewrites nothing, so the siteUrl
		// a feed's first load discovered survives it. An OPML listing 5 new
		// feeds against 40 existing ones loads only those 5, rather than
		// refetching the whole list as a full reload would.
		const { added, alreadySubscribed, invalid } = planAdditions(
			parseOpml(await file.text()),
			[...curatedFeeds, ...currentFeeds],
		);
		const summary = describeImport({ added, alreadySubscribed, invalid });
		if (added.length === 0) {
			statusEl.textContent = summary;
			return;
		}

		await saveFeeds(added);
		subscribeLocally(added);
		// Said before the load, not after: loadInto waits for every added feed
		// to settle, and an import that brought in 48 of them would otherwise
		// sit silent for as long as the slowest one takes.
		statusEl.textContent = summary;
		await loadInto(added);
		void reconcileAddedFeeds();
	} catch (err) {
		console.error(err);
		statusEl.textContent =
			err instanceof Error ? err.message : "Failed to import OPML file.";
	} finally {
		fileInput.value = "";
	}
});

addFeedForm.addEventListener("submit", async (event) => {
	// The page would otherwise navigate on submit, losing the reader's place.
	event.preventDefault();
	if (await addSingleFeed(feedUrlInput.value)) {
		feedUrlInput.value = "";
	}
});

refresh();
