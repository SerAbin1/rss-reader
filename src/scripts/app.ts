import { type Feed, getAllFeeds, saveFeeds } from "../lib/db";
import { parseFeed, type Post } from "../lib/feed-parser";
import { parseOpml } from "../lib/opml";

const fileInput = document.querySelector<HTMLInputElement>("#opml-input")!;
const feedListEl = document.querySelector<HTMLUListElement>("#feed-list")!;
const postListEl = document.querySelector<HTMLUListElement>("#post-list")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const postsStatusEl =
	document.querySelector<HTMLParagraphElement>("#posts-status")!;

function renderFeeds(feeds: Feed[]): void {
	feedListEl.replaceChildren(
		...feeds.map((feed) => {
			const li = document.createElement("li");
			li.textContent = feed.title;
			return li;
		}),
	);
}

function renderPosts(posts: Post[], feedTitleByUrl: Map<string, string>): void {
	postListEl.replaceChildren(
		...posts.map((post) => {
			const li = document.createElement("li");

			const link = document.createElement("a");
			link.href = post.link;
			link.textContent = post.title;
			link.target = "_blank";
			link.rel = "noopener noreferrer";

			const meta = document.createElement("span");
			const feedTitle = feedTitleByUrl.get(post.feedUrl) ?? post.feedUrl;
			meta.textContent = ` — ${feedTitle} — ${new Date(post.publishedAt).toLocaleString()}`;

			li.append(link, meta);
			return li;
		}),
	);
}

async function fetchPosts(feed: Feed): Promise<Post[]> {
	const res = await fetch(`/api/feed?url=${encodeURIComponent(feed.feedUrl)}`);
	if (!res.ok) {
		throw new Error(`${feed.title}: request failed (${res.status})`);
	}
	return parseFeed(await res.text(), feed.feedUrl);
}

async function loadPosts(feeds: Feed[]): Promise<void> {
	if (feeds.length === 0) {
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

	posts.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

	const feedTitleByUrl = new Map(feeds.map((feed) => [feed.feedUrl, feed.title]));
	renderPosts(posts, feedTitleByUrl);

	postsStatusEl.textContent =
		failures > 0
			? `Loaded ${posts.length} post(s). ${failures} feed(s) failed to load — see console.`
			: `Loaded ${posts.length} post(s).`;
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
