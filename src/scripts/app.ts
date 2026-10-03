import QRCode from "qrcode";
import {
	deleteFeeds,
	type Feed,
	getAllFeeds,
	getDeviceToken,
	getLastReadAt,
	saveFeeds,
	setDeviceToken,
	setLastReadAt,
} from "../lib/db";
import { parseFeed, type ParsedFeed, type Post } from "../lib/feed-parser";
import { parseOpml } from "../lib/opml";
import { isOnline, onConnectivityChange, registerServiceWorker } from "../lib/pwa";
import { describeImport, normalizeFeedUrl, planAdditions } from "../lib/subscriptions";
import {
	pullFeeds,
	pullWatermark,
	pushFeedChanges,
	pushWatermark,
	startPairing,
} from "../lib/sync-client";
import { formatPairCode, mergeWatermark } from "../lib/sync-state";
import {
	isRead,
	watermarkAfterCatchUp,
	watermarkAfterClick,
} from "../lib/read-state";

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
const catchUpDateInput =
	document.querySelector<HTMLInputElement>("#catch-up-date")!;
const catchUpButton =
	document.querySelector<HTMLButtonElement>("#catch-up-button")!;
const syncBannerEl = document.querySelector<HTMLDivElement>("#sync-banner")!;
const syncBannerMessageEl =
	document.querySelector<HTMLParagraphElement>("#sync-banner-message")!;
const syncBannerPushButton =
	document.querySelector<HTMLButtonElement>("#sync-banner-push")!;
const syncBannerDismissButton =
	document.querySelector<HTMLButtonElement>("#sync-banner-dismiss")!;
const syncSetupButton =
	document.querySelector<HTMLButtonElement>("#sync-setup-button")!;
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

// Registers the installed app's service worker (a no-op in dev — see lib/pwa).
// /pair's script registers the same worker, so a first visit that lands there
// from a scanned QR still ends up with a worker covering "/".
registerServiceWorker();

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

// Whether the degraded-load banner has already been shown (or would have
// been) for the current load. markRead fires on every click, so without this
// a run of clicks against a degraded load would reopen the banner — or worse,
// silently re-decide it — after the user already dismissed it once.
let degradedBannerPrompted = false;

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
	// A failed feed only misleads this device — until sync. Pushing from here
	// would make that watermark authoritative on a device where those feeds
	// loaded fine, marking posts read that were never shown anywhere. Ask
	// first, via the banner, rather than silently refusing or silently pushing.
	if (failures > 0) {
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
		const result = await startPairing(syncToken, lastReadAt);
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
	// Leads, because offline is the reason most or all of those failures
	// happened, and a row of "feed(s) failed" on its own reads like a broken
	// app rather than a phone in a tunnel.
	const offlineNote = online ? "" : "Offline — ";
	postsStatusEl.textContent = `${offlineNote}${loadedSummary}.${progress}${failureNote}`;
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
				failures++;
				console.error(err);
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
	syncToken = await getDeviceToken();
	updateSyncSetupButton();
	feedsReconciled = false;
	degradedBannerPrompted = false;
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
