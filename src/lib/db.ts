export interface Feed {
	feedUrl: string;
	title: string;
}

const DB_NAME = "rss-reader";
const DB_VERSION = 1;
const FEEDS_STORE = "feeds";

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(FEEDS_STORE)) {
				db.createObjectStore(FEEDS_STORE, { keyPath: "feedUrl" });
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
