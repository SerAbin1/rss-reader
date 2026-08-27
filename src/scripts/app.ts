import {
	type Feed,
	getAllFeeds,
	getLastReadAt,
	saveFeeds,
	setLastReadAt,
} from "../lib/db";
import { parseFeed, type Post } from "../lib/feed-parser";
import { parseOpml } from "../lib/opml";
import { isRead, watermarkAfterClick } from "../lib/read-state";

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
let currentFeedTitleByUrl = new Map<string, string>();
let lastReadAt: string | null = null;

function renderFeeds(feeds: Feed[]): void {
	feedListEl.replaceChildren(
		...feeds.map((feed) => {
			const li = document.createElement("li");
			li.textContent = feed.title;
			return li;
		}),
	);
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
	if (!confirm(`Mark everything before ${dateValue} as read?`)) return;

	await markRead(cutoff);
});

async function fetchPosts(feed: Feed): Promise<Post[]> {
	const res = await fetch(`/api/feed?url=${encodeURIComponent(feed.feedUrl)}`);
	if (!res.ok) {
		throw new Error(`${feed.title}: request failed (${res.status})`);
	}
	return parseFeed(await res.text(), feed.feedUrl);
}

function updateLoadStatus(
	totalFeeds: number,
	settledFeeds: number,
	failures: number,
): void {
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
	currentFeedTitleByUrl = new Map(feeds.map((feed) => [feed.feedUrl, feed.title]));

	if (feeds.length === 0) {
		postListEl.replaceChildren();
		postsStatusEl.textContent = "No feeds subscribed yet.";
		return;
	}

	lastReadAt = await getLastReadAt();
	renderPosts();

	let settledFeeds = 0;
	let failures = 0;
	updateLoadStatus(feeds.length, settledFeeds, failures);

	await Promise.allSettled(
		feeds.map(async (feed) => {
			try {
				const posts = await fetchPosts(feed);
				currentPosts.push(...posts);
				currentPosts.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
				renderPosts();
			} catch (err) {
				failures++;
				console.error(err);
			} finally {
				settledFeeds++;
				updateLoadStatus(feeds.length, settledFeeds, failures);
			}
		}),
	);
}

async function refresh(): Promise<void> {
	const feeds = await getAllFeeds();
	renderFeeds(feeds);
	await loadPosts(feeds);
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
