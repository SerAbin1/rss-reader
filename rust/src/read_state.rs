//! Pure watermark logic, kept separate from the DOM/IndexedDB wiring so it's
//! testable in isolation. See the Obsidian decision log for why read/unread is
//! a single date rather than per-post state.
//!
//! Identical to the web app's `src/lib/read-state.ts` and the Android app's
//! `android/.../core/ReadState.kt`. The web app compares ISO strings; every
//! date that reaches here has been normalised by `timestamps::parse_iso_millis`
//! to the same shape, so string ordering and timestamp ordering agree.

/// Whether a post is read based on the watermark.
///
/// Returns true if `last_read_at` is not None and `published_at <= last_read_at`.
pub fn is_read(published_at: &str, last_read_at: Option<&str>) -> bool {
    last_read_at.is_some_and(|last_read_at| published_at <= last_read_at)
}

/// Find the index of the first post that is NOT read.
///
/// Equivalent to the web app's `findFirstUnreadIndex()`. `posts` must be
/// sorted ascending by publishedAt. Returns None when everything is read
/// (the TS version returns -1).
pub fn find_first_unread_index(posts: &[&str], last_read_at: Option<&str>) -> Option<usize> {
    posts
        .iter()
        .position(|published_at| !is_read(published_at, last_read_at))
}

/// The watermark only advances when `clicked_index` is exactly the next unread
/// post in order. Returns the new lastReadAt, or None if it shouldn't change
/// (clicking ahead reads just that one post without marking skipped ones
/// read).
pub fn watermark_after_click(
    posts: &[&str],
    last_read_at: Option<&str>,
    clicked_index: usize,
) -> Option<String> {
    if Some(clicked_index) != find_first_unread_index(posts, last_read_at) {
        return None;
    }
    posts.get(clicked_index).map(|published_at| published_at.to_string())
}

/// "Mark read up to here" is forward-only. Moving the watermark backwards is
/// the one non-monotonic write this app could otherwise produce, and it stops
/// being harmless once reading state syncs: the server merges with max(), so a
/// rewind would be discarded server-side, linger locally until the next load,
/// then silently vanish — indistinguishable from a bug. Marking exists to
/// skip ahead, which is always forward, so rejecting a backwards jump costs
/// nothing real. Returns the new lastReadAt, or None if it wouldn't advance.
pub fn watermark_after_mark_up_to(last_read_at: Option<&str>, published_at: &str) -> Option<String> {
    if last_read_at.is_some_and(|last_read_at| published_at <= last_read_at) {
        return None;
    }
    Some(published_at.to_string())
}

/// Whether a post is still shown. A post read during this load stays listed,
/// greyed out, rather than vanishing the moment it's opened; it's dropped on
/// the next load. `listed_after` is the watermark as that load began (and as
/// it settled after pulling from sync), so posts read before then are gone.
pub fn is_listed(published_at: &str, listed_after: Option<&str>) -> bool {
    !is_read(published_at, listed_after)
}

/// The identity a favourite is stored under: a guid is only unique within its
/// own feed. `\u0000` is the same separator the web app uses.
pub fn favourite_key(feed_url: &str, guid: &str) -> String {
    format!("{feed_url}\0{guid}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Post;

    const POSTS: [&str; 3] = [
        "2026-01-01T00:00:00.000Z",
        "2026-01-02T00:00:00.000Z",
        "2026-01-03T00:00:00.000Z",
    ];

    #[test]
    fn is_read_unread_when_null() {
        assert!(!is_read(POSTS[0], None));
    }

    #[test]
    fn is_read_at_or_before_watermark() {
        assert!(is_read(POSTS[0], Some(POSTS[0])));
        assert!(is_read(POSTS[0], Some(POSTS[1])));
    }

    #[test]
    fn is_read_after_watermark_is_false() {
        assert!(!is_read(POSTS[1], Some(POSTS[0])));
    }

    #[test]
    fn find_first_unread_returns_zero_when_nothing_read() {
        assert_eq!(find_first_unread_index(&POSTS, None), Some(0));
    }

    #[test]
    fn find_first_unread_returns_index_after_watermark() {
        assert_eq!(find_first_unread_index(&POSTS, Some(POSTS[0])), Some(1));
    }

    #[test]
    fn find_first_unread_is_none_when_all_read() {
        assert_eq!(find_first_unread_index(&POSTS, Some(POSTS[2])), None);
    }

    #[test]
    fn watermark_after_click_advances_for_next_unread() {
        assert_eq!(watermark_after_click(&POSTS, None, 0).as_deref(), Some(POSTS[0]));
        assert_eq!(
            watermark_after_click(&POSTS, Some(POSTS[0]), 1).as_deref(),
            Some(POSTS[1])
        );
    }

    #[test]
    fn watermark_after_click_does_not_advance_when_clicking_ahead() {
        assert_eq!(watermark_after_click(&POSTS, None, 2), None);
    }

    #[test]
    fn watermark_after_click_does_not_advance_when_clicking_read() {
        assert_eq!(watermark_after_click(&POSTS, Some(POSTS[1]), 0), None);
    }

    #[test]
    fn watermark_after_mark_up_to_advances() {
        assert_eq!(
            watermark_after_mark_up_to(None, POSTS[1]).as_deref(),
            Some(POSTS[1])
        );
        assert_eq!(
            watermark_after_mark_up_to(Some(POSTS[0]), POSTS[2]).as_deref(),
            Some(POSTS[2])
        );
    }

    #[test]
    fn watermark_after_mark_up_to_refuses_to_go_backwards() {
        assert_eq!(watermark_after_mark_up_to(Some(POSTS[2]), POSTS[0]), None);
    }

    #[test]
    fn watermark_after_mark_up_to_refuses_equal_watermark() {
        assert_eq!(watermark_after_mark_up_to(Some(POSTS[1]), POSTS[1]), None);
    }

    #[test]
    fn is_listed_everything_if_nothing_read_before_load() {
        assert!(is_listed(POSTS[0], None));
    }

    #[test]
    fn is_listed_drops_posts_read_before_load() {
        let listed_after = Some(POSTS[0]);
        assert!(!is_listed(POSTS[0], listed_after));
        assert!(is_listed(POSTS[1], listed_after));
    }

    #[test]
    fn favourite_key_separates_same_guid_across_feeds() {
        assert_ne!(favourite_key("https://a.com/f", "1"), favourite_key("https://b.com/f", "1"));
    }

    // Mirrors the TS tests, which call favouriteKey with a post object. Keep a
    // helper of the same shape for callers ported to Rust.
    #[test]
    fn favourite_key_for_post() {
        let post = Post {
            feedUrl: "https://a.com/f".to_string(),
            guid: "1".to_string(),
            title: "x".to_string(),
            link: "y".to_string(),
            publishedAt: "2026-01-01T00:00:00.000Z".to_string(),
        };
        assert_eq!(favourite_key(&post.feedUrl, &post.guid), "https://a.com/f\u{0}1");
    }
}
