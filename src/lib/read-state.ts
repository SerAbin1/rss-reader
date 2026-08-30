// Pure watermark logic, kept separate from app.ts's DOM/IndexedDB wiring so it's testable
// in isolation. See the Obsidian decision log for why read/unread is a single date rather
// than per-post state.

interface Dated {
	publishedAt: string;
}

export function isRead(publishedAt: string, lastReadAt: string | null): boolean {
	return lastReadAt !== null && publishedAt <= lastReadAt;
}

// `posts` must be sorted ascending by publishedAt. -1 if everything is read.
export function findFirstUnreadIndex(
	posts: Dated[],
	lastReadAt: string | null,
): number {
	return posts.findIndex((post) => !isRead(post.publishedAt, lastReadAt));
}

// The watermark only advances when `clickedIndex` is exactly the next unread
// post in order. Returns the new lastReadAt, or null if it shouldn't change
// (clicking ahead reads just that one post without marking skipped ones read).
export function watermarkAfterClick(
	posts: Dated[],
	lastReadAt: string | null,
	clickedIndex: number,
): string | null {
	if (clickedIndex !== findFirstUnreadIndex(posts, lastReadAt)) return null;
	return posts[clickedIndex].publishedAt;
}

// Catch-up is forward-only. Moving the watermark backwards is the one
// non-monotonic write this app could otherwise produce, and it stops being
// harmless once reading state syncs: the server merges with max(), so a rewind
// would be discarded server-side, linger locally until the next load, then
// silently vanish — indistinguishable from a bug. Catch-up exists to skip a
// backlog, which is always forward, so rejecting a backwards jump costs
// nothing real. Returns the new lastReadAt, or null if it wouldn't advance.
export function watermarkAfterCatchUp(
	lastReadAt: string | null,
	cutoff: string,
): string | null {
	if (lastReadAt !== null && cutoff <= lastReadAt) return null;
	return cutoff;
}
