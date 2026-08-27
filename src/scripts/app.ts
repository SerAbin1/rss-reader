import { type Feed, getAllFeeds, saveFeeds } from "../lib/db";
import { parseOpml } from "../lib/opml";

const fileInput = document.querySelector<HTMLInputElement>("#opml-input")!;
const feedListEl = document.querySelector<HTMLUListElement>("#feed-list")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;

function renderFeeds(feeds: Feed[]): void {
	feedListEl.replaceChildren(
		...feeds.map((feed) => {
			const li = document.createElement("li");
			li.textContent = feed.title;
			return li;
		}),
	);
}

async function refresh(): Promise<void> {
	renderFeeds(await getAllFeeds());
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
