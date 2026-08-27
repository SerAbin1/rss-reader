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
			const feedTitle = currentFeedTitleByUrl.get(post.feedUrl) ?? post.feedUrl;
			meta.textContent = ` — ${feedTitle} — ${new Date(post.publishedAt).toLocaleString()}`;

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
// one by one. To catch up to a specific post rather than a whole day, pick
// that post's date. Doesn't change the normal click-to-advance behavior above.
catchUpButton.addEventListener("click", async () => {
	const dateValue = catchUpDateInput.value;
	if (!dateValue) {
		alert("Pick a date first.");
		return;
	}

	// End of the chosen day (inclusive), so same-day posts still count as read.
	const cutoff = new Date(`${dateValue}T23:59:59.999Z`).toISOString();
	if (!confirm(`Mark everything up to ${dateValue} as read?`)) return;

	await markRead(cutoff);
});

async function fetchPosts(feed: Feed): Promise<Post[]> {
	const res = await fetch(`/api/feed?url=${encodeURIComponent(feed.feedUrl)}`);
	if (!res.ok) {
		throw new Error(`${feed.title}: request failed (${res.status})`);
	}
	return parseFeed(await res.text(), feed.feedUrl);
}

async function loadPosts(feeds: Feed[]): Promise<void> {
	if (feeds.length === 0) {
		currentPosts = [];
		postListEl.replaceChildren();
		postsStatusEl.textContent = "No feeds subscribed yet.";
		return;
	}

	postsStatusEl.textContent = "Loading posts…";

	const results = await Promise.allSettled(feeds.map(fetchPosts));

	const posts: Post[] = [];
	let failures = 0;
	for (const result of results) {
		if (result.status === "fulfilled") {
			posts.push(...result.value);
		} else {
			failures++;
			console.error(result.reason);
		}
	}

	posts.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));

	currentPosts = posts;
	currentFeedTitleByUrl = new Map(feeds.map((feed) => [feed.feedUrl, feed.title]));
	lastReadAt = await getLastReadAt();
	renderPosts();

	const unreadCount = posts.filter((post) => !isRead(post.publishedAt, lastReadAt)).length;
	const loadedSummary = `${unreadCount} unread of ${posts.length} loaded`;
	postsStatusEl.textContent =
		failures > 0
			? `${loadedSummary}. ${failures} feed(s) failed to load — see console.`
			: `${loadedSummary}.`;
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
