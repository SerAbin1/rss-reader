export interface Feed {
	feedUrl: string;
	title: string;
	// The feed's own homepage, discovered from the feed document on load and
	// cached here so later visits can link it without waiting for a fetch.
	// Optional: feeds imported before this existed won't have it until their
	// next successful load.
	siteUrl?: string;
}

const DB_NAME = "rss-reader";
const DB_VERSION = 2;
const FEEDS_STORE = "feeds";
const META_STORE = "meta";
const LAST_READ_AT_KEY = "lastReadAt";

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(FEEDS_STORE)) {
				db.createObjectStore(FEEDS_STORE, { keyPath: "feedUrl" });
			}
			if (!db.objectStoreNames.contains(META_STORE)) {
				// Out-of-line keys: just scalar values (e.g. lastReadAt), not
				// records with their own id, so no keyPath.
				db.createObjectStore(META_STORE);
			}
		};

		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

// Upserts by feedUrl, so re-importing the same OPML file doesn't create duplicates.
export async function saveFeeds(feeds: Feed[]): Promise<void> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(FEEDS_STORE, "readwrite");
		const store = tx.objectStore(FEEDS_STORE);
		for (const feed of feeds) {
			store.put(feed);
		}
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

export async function getAllFeeds(): Promise<Feed[]> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(FEEDS_STORE, "readonly");
		const request = tx.objectStore(FEEDS_STORE).getAll();
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

// Watermark, not per-post state: posts with publishedAt <= this are read.
// See the Obsidian decision log for why (single global date, not per-feed/per-post).
export async function getLastReadAt(): Promise<string | null> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(META_STORE, "readonly");
		const request = tx.objectStore(META_STORE).get(LAST_READ_AT_KEY);
		request.onsuccess = () => resolve(request.result ?? null);
		request.onerror = () => reject(request.error);
	});
}

export async function setLastReadAt(publishedAt: string): Promise<void> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(META_STORE, "readwrite");
		tx.objectStore(META_STORE).put(publishedAt, LAST_READ_AT_KEY);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}
