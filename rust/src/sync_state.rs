//! Sync merge/validation logic for cross-device sync.
//!
//! Kept separate from the D1 queries in `functions/api/sync/` and the
//! DOM+IndexedDB wiring so it can be tested without a database or a browser.
//! See the Obsidian decision log for why these particular merge rules.
//!
//! Identical semantics to the web app's `src/lib/sync-state.ts` and the
//! Kotlin port used by the Android app:
//!
//! - **Watermark** is monotonic, so `max()` is the whole conflict story — not
//!   last-writer-wins. max() is commutative, associative and idempotent, which
//!   is what makes offline devices converge regardless of reconnection order.
//! - **Feeds** are per-feed last-write-wins over the union of both sides, keyed
//!   by feedUrl. Without tombstones a feed deleted on one device would be
//!   resurrected by the other on the next merge, so deletions travel as
//!   `deletedAt` records rather than as absent rows. Ties break in favour of
//!   the tombstone — and the tiebreak is argument-order independent so the
//!   merge is commutative.

use crate::models::Feed;

/// Server-stamped, never client-stamped: with tombstones, feed membership is
/// resolved by comparing timestamps, so a device with a skewed clock would win
/// arguments it should lose. One clock, in the endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncedFeed {
    pub feedUrl: String,
    pub title: String,
    /// Epoch ms — when this feed was last updated on the server.
    pub updatedAt: u64,
    /// Some(ms) if the server deleted this feed (tombstone), None if it is live.
    pub deletedAt: Option<u64>,
}

/// A pairing ticket. Single-use and short-lived: a pair code is only ever
/// exchangeable for a device token, never usable as one itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairCode {
    /// Epoch ms at which the code expires.
    pub expiresAt: u64,
    /// Epoch ms at which the code was claimed, or None if not yet redeemed.
    pub claimedAt: Option<u64>,
}

/// The watermark is monotonic, so max() is the whole conflict story.
/// Not last-writer-wins: a device that last synced on Wednesday must not
/// rewind one that has read to Friday.
pub fn merge_watermark(a: Option<&str>, b: Option<&str>) -> Option<String> {
    match (a, b) {
        (None, other) | (other, None) => other.map(str::to_string),
        (Some(a), Some(b)) => Some(if a >= b { a.to_string() } else { b.to_string() }),
    }
}

/// Whether a pair code can still be redeemed.
pub fn is_pair_code_usable(code: &PairCode, now: u64) -> bool {
    code.claimedAt.is_none() && code.expiresAt > now
}

/// Displayed grouped (ABCDE-FGHJK) purely for human legibility — the server's
/// normalizePairCode strips non-alphanumerics before hashing, so the hyphen
/// carries no meaning to it and typing or pasting it back in is optional.
pub fn format_pair_code(code: &str) -> String {
    if code.len() == 10 {
        format!("{}-{}", &code[..5], &code[5..])
    } else {
        code.to_string()
    }
}

/// Per-feed last-write-wins over the union of both sides, keyed by feedUrl.
///
/// Ties break in favour of the tombstone. Equal timestamps are possible (same
/// millisecond, one server clock), and the tiebreak has to be independent of
/// argument order or the merge stops being commutative and the two devices
/// converge on different answers.
///
/// Insertion order of the result matches the TS Map-based merge: feeds that
/// existed in `a` keep their position when they also appear in (or win from)
/// `b`; feeds only in `b` are appended. Tombstones stay in the set so
/// deletions keep propagating.
pub fn merge_feeds(a: &[SyncedFeed], b: &[SyncedFeed]) -> Vec<SyncedFeed> {
    let mut merged: Vec<SyncedFeed> = Vec::with_capacity(a.len() + b.len());

    for feed in a.iter().chain(b.iter()) {
        match merged.iter_mut().find(|existing| existing.feedUrl == feed.feedUrl) {
            None => merged.push(feed.clone()),
            Some(existing) => {
                if candidate_wins(feed, existing) {
                    *existing = feed.clone();
                }
            }
        }
    }
    merged
}

fn candidate_wins(candidate: &SyncedFeed, incumbent: &SyncedFeed) -> bool {
    if candidate.updatedAt == incumbent.updatedAt {
        // Tie: the tombstone wins.
        return candidate.deletedAt.is_some() && incumbent.deletedAt.is_none();
    }
    candidate.updatedAt > incumbent.updatedAt
}

/// The live feeds, with the sync bookkeeping stripped — what the app actually
/// renders and fetches. Tombstones stay out.
pub fn live_feeds(feeds: &[SyncedFeed]) -> Vec<Feed> {
    feeds
        .iter()
        .filter(|feed| feed.deletedAt.is_none())
        .map(|feed| Feed {
            feedUrl: feed.feedUrl.clone(),
            title: feed.title.clone(),
            siteUrl: None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const WED: &str = "2026-01-07T00:00:00.000Z";
    const FRI: &str = "2026-01-09T00:00:00.000Z";

    fn synced(feedUrl: &str, updatedAt: u64, deletedAt: Option<u64>) -> SyncedFeed {
        SyncedFeed {
            feedUrl: feedUrl.to_string(),
            title: feedUrl.to_string(),
            updatedAt,
            deletedAt,
        }
    }

    mod watermark {
        use super::*;

        #[test]
        fn takes_later_of_two() {
            assert_eq!(merge_watermark(Some(WED), Some(FRI)).as_deref(), Some(FRI));
        }

        #[test]
        fn stale_device_cannot_rewind() {
            assert_eq!(merge_watermark(Some(FRI), Some(WED)).as_deref(), Some(FRI));
        }

        #[test]
        fn null_is_nothing_read_yet() {
            assert_eq!(merge_watermark(None, Some(WED)).as_deref(), Some(WED));
            assert_eq!(merge_watermark(Some(WED), None).as_deref(), Some(WED));
            assert_eq!(merge_watermark(None, None), None);
        }

        #[test]
        fn idempotent() {
            assert_eq!(merge_watermark(Some(FRI), Some(FRI)).as_deref(), Some(FRI));
            let once = merge_watermark(Some(WED), Some(FRI));
            assert_eq!(merge_watermark(once.as_deref(), Some(FRI)).as_deref(), Some(FRI));
        }

        #[test]
        fn commutative() {
            assert_eq!(merge_watermark(Some(WED), Some(FRI)), merge_watermark(Some(FRI), Some(WED)));
        }
    }

    mod pair_code {
        use super::*;

        #[test]
        fn accepts_unclaimed_unexpired() {
            let code = PairCode { expiresAt: 2000, claimedAt: None };
            assert!(is_pair_code_usable(&code, 1000));
        }

        #[test]
        fn rejects_redeemed() {
            let code = PairCode { expiresAt: 2000, claimedAt: Some(1500) };
            assert!(!is_pair_code_usable(&code, 1000));
        }

        #[test]
        fn rejects_expired() {
            let code = PairCode { expiresAt: 2000, claimedAt: None };
            assert!(!is_pair_code_usable(&code, 3000));
        }

        #[test]
        fn rejects_exactly_at_expiry() {
            let code = PairCode { expiresAt: 2000, claimedAt: None };
            assert!(!is_pair_code_usable(&code, 2000));
        }

        #[test]
        fn formats_ten_char_code_grouped() {
            assert_eq!(format_pair_code("ABCDEFGHJK"), "ABCDE-FGHJK");
        }
    }

    mod merge {
        use super::*;

        #[test]
        fn unions_feeds_only_one_side_knows() {
            let merged = merge_feeds(&[synced("a", 1000, None)], &[synced("b", 1000, None)]);
            let urls: Vec<&str> = merged.iter().map(|f| f.feedUrl.as_str()).collect();
            assert_eq!(urls, vec!["a", "b"]);
        }

        #[test]
        fn keeps_more_recently_updated_record() {
            let merged = merge_feeds(
                &[synced("a", 1000, None)],
                &[SyncedFeed { updatedAt: 2000, ..synced("a", 0, None) }],
            );
            assert_eq!(merged[0].updatedAt, 2000);
        }

        #[test]
        fn propagates_deletion_instead_of_resurrecting() {
            let merged = merge_feeds(
                &[synced("a", 1000, None)],
                &[synced("a", 2000, Some(2000))],
            );
            assert_eq!(merged[0].deletedAt, Some(2000));
        }

        #[test]
        fn later_re_add_wins_over_earlier_deletion() {
            let merged = merge_feeds(
                &[synced("a", 1000, Some(1000))],
                &[synced("a", 2000, None)],
            );
            assert_eq!(merged[0].deletedAt, None);
        }

        #[test]
        fn timestamp_tie_breaks_for_tombstone_in_both_directions() {
            let live = synced("a", 1000, None);
            let dead = synced("a", 1000, Some(1000));
            assert_eq!(merge_feeds(&[live.clone()], &[dead.clone()])[0].deletedAt, Some(1000));
            assert_eq!(merge_feeds(&[dead], &[live])[0].deletedAt, Some(1000));
        }

        #[test]
        fn is_idempotent() {
            let feeds = vec![synced("a", 1000, None), synced("b", 1000, None)];
            assert_eq!(merge_feeds(&feeds, &feeds).len(), 2);
        }

        #[test]
        fn is_commutative() {
            // The TS merge uses a Map, so order is first-insertion: which side
            // is "a" picks the order of new feeds. What is argument-order
            // independent is the winning state per feedUrl — assert that.
            let a = vec![synced("a", 1000, None), synced("c", 1000, Some(1000))];
            let b = vec![synced("c", 1000, None), synced("b", 1000, None)];
            let ab = merge_feeds(&a, &b);
            let ba = merge_feeds(&b, &a);
            let mut ab_sorted = ab.clone();
            ab_sorted.sort_by(|x, y| x.feedUrl.cmp(&y.feedUrl));
            let mut ba_sorted = ba.clone();
            ba_sorted.sort_by(|x, y| x.feedUrl.cmp(&y.feedUrl));
            assert_eq!(ab_sorted, ba_sorted);
        }
    }

    mod live {
        use super::*;

        #[test]
        fn drops_tombstones_and_strips_bookkeeping() {
            let live = live_feeds(&[
                SyncedFeed { feedUrl: "a".into(), title: "A".into(), updatedAt: 1000, deletedAt: None },
                SyncedFeed { feedUrl: "b".into(), title: "B".into(), updatedAt: 2000, deletedAt: Some(2000) },
            ]);
            assert_eq!(live, vec![Feed { feedUrl: "a".into(), title: "A".into(), siteUrl: None }]);
        }
    }
}
