//! Pure watermark logic, kept separate from app.ts's DOM/IndexedDB wiring so it's
//! testable in isolation. See the Obsidian decision log for why read/unread is a
//! single date rather than per-post state.

use crate::models::Post;

// Watermark / read-state logic — identical semantics to the web app's
// `src/lib/read-state.ts` and the Android app's `android/core/ReadState.kt`.

/// A post must have a `publishedAt` date for read-state logic.
pub trait Dated {
    /// Return the publishedAt string for this dated item.
    fn published_at(&self) -> &str;
}

/// Whether a post is read based on the watermark.
///
/// Returns `true` if `lastReadAt` is not None and `publishedAt <= lastReadAt`.
///
/// This is the pure function equivalent of the web app's `isRead()`.
pub fn isRead(publishedAt: &str, lastReadAt: Option<&str>) -> bool {
    lastReadAt != None && publishedAt <= lastReadAt.unwrap_or("")
}

/// Find the index of the first post that is NOT read.
///
/// Equivalent to the web app's `findFirstUnreadIndex()`.
/// Returns `Some(i)` where `i` is the index of the first unread post,
/// or `None` if all posts are read.
pub fn findFirstUnreadIndex<'a, P: Dated + ?Sized>(
    posts: &'a [P],
    lastReadAt: Option<&'a str>,
) -> Option<usize> {
    posts
        .iter()
        .position(|post| !isRead(post.published_at(), lastReadAt))
}

/// The watermark only advances when `clickedIndex` is exactly the next unread
// post in order. Returns the new lastReadAt, or null if it shouldn't change
// (clicking ahead reads just that one post without marking skipped ones read).
pub fn watermarkAfterClick(
    posts: &[impl Dated],
    lastReadAt: Option<&str>,
    clickedIndex: usize,
) -> Option<String> {
    let firstUnread = findFirstUnreadIndex(posts, lastReadAt);
    firstUnread.map(|i| posts[i].published_at().to_string())
}

/// "Mark read up to here" is forward-only. Moving the watermark backwards is
// the one non-monotonic write this app could otherwise produce, and it stops
// being harmless once reading state syncs: the server merges with max(), so a
// rewind would be discarded server-side, linger locally until the next load,
// then silently vanish — indistinguishable from a bug. Marking exists to skip
// ahead, which is always forward, so rejecting a backwards jump costs nothing
// real. Returns the new lastReadAt, or null if it wouldn't advance.
pub fn watermarkAfterMarkUpTo(
    lastReadAt: Option<&str>,
    publishedAt: &str,
) -> Option<String> {
    if lastReadAt != None && publishedAt <= lastReadAt.unwrap_or("") {
        None
    } else {
        Some(publishedAt.to_string())
    }
}

/// Whether a post is still shown. A post read during this load stays listed,
// greyed out, rather than vanishing the moment it's opened; it's dropped on
// the next load. `listedAfter` is the watermark as that load began (and as it
// settled after pulling from sync), so posts read before then are gone.
pub fn isListed(publishedAt: &str, listedAfter: Option<&str>) -> bool {
    !isRead(publishedAt, listedAfter)
}

// Convenience: adapt a `Post` to the `Dated` trait
impl Dated for Post {
    fn published_at(&self) -> &str {
        &self.publishedAt
    }
}