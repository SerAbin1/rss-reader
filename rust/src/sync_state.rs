//! Sync merge/validation logic for cross-device sync.
//! Kept separate from the D1 queries in functions/api/sync/ and the DOM+IndexedDB
//! wiring in app.ts, so it can be tested without a database or a browser.

use crate::models::{Feed, SyncedFeed};
use std::collections::HashMap;

// Server-stamped, never client-stamped: with tombstones, feed membership is
// resolved by comparing timestamps, so a device with a skewed clock would win
// arguments it should lose. One clock, in the endpoint.

/// A feed that has been synced from the server, carrying epoch-millisecond
/// timestamps for merge logic.
#[derive(Debug, Clone)]
pub struct SyncedFeed {
    /// The feed URL, used as the key for merging.
    pub feedUrl: String,
    /// The feed's title.
    pub title: String,
    /// Server stamp (epoch ms) — when this feed was last updated on the server.
    pub updatedAt: u64,
    /// Tombstone flag: `true` if this feed was deleted on the server.
    /// `None` means the feed is live; `Some(...)` means it was deleted.
    pub deletedAt: Option<u64>,
}

// A structure for pair code handling
#[derive(Debug, Clone)]
pub struct PairCode {
    /// Epoch ms when this code was generated; expires after this time.
    pub expiresAt: u64,
    /// Epoch ms when this code was claimed; 0 = not yet redeemed.
    pub claimedAt: u64,
}

// The reading watermark is monotonic, so max() is the whole conflict story.
// Not last-writer-wins: a device that last synced on Wednesday must not rewind
// one that has read to Friday. max() is commutative, associative and
// idempotent, which is what makes offline devices converge regardless of who
// reconnects first, and makes a duplicate push a no-op.

/// Merge two watermarks using the `max()` strategy.
/// The watermark is monotonic, so the maximum of the two is the resolved value.
///
/// # Arguments
/// * `a` - Watermark from one device (ISO 8601 string or None)
/// * `b` - Watermark from another device (ISO 8601 string or None)
///
/// Returns the maximum watermark, or `None` if both are `None`.
pub fn mergeWatermark(a: Option<&str>, b: Option<&str>) -> Option<String> {
    match (a, b) {
        (None, _) => b,
        (_, None) => a,
        (Some(a), Some(b)) => {
            // String comparison of ISO 8601 dates works because they sort correctly
            if a >= b {
                Some(a.to_string())
            } else {
                Some(b.to_string())
            }
        }
    }
}

/// Check if a pair code is still usable (not claimed and not expired).
///
/// # Arguments
/// * `code` - The pair code structure
/// * `now` - Current epoch millis
pub fn isPairCodeUsable(code: &PairCode, now: u64) -> bool {
    code.claimedAt == 0 && code.expiresAt > now
}

/// Normalize a pair code for display: `ABCDE-FGHJK`.
/// The server strips non-alphanumerics before hashing, so the hyphen carries
/// no meaning and typing or pasting it back in is optional.
pub fn formatPairCode(code: &str) -> String {
    let code = code.as_str();
    if code.len() >= 10 {
        format!("{}-{}", &code[..5], &code[5..])
    } else {
        code.to_string()
    }
}

// Per-feed last-write-wins over the union of both sides, keyed by feedUrl.
// Unlike the watermark this is not a grow-only set — without tombstones a feed
// deleted on one device would be resurrected by the other on the next merge —
// so deletions travel as `deletedAt` records rather than as absent rows.

/// Merge two lists of synced feeds, applying last-write-wins per feedUrl.
/// Returns a `HashMap` keyed by feedUrl with the winning feed for each.
///
/// # Arguments
/// * `a` - First list of synced feeds
/// * `b` - Second list of synced feeds
pub fn mergeFeeds(a: &[SyncedFeed], b: &[SyncedFeed]) -> HashMap<String, SyncedFeed> {
    let mut merged: HashMap<String, SyncedFeed> = HashMap::new();

    for feed in a {
        upsertFeed(&mut merged, feed);
    }
    for feed in b {
        upsertFeed(&mut merged, feed);
    }

    merged
}

/// Insert or update a feed in the merged map using last-write-wins logic.
fn upsertFeed(merged: &mut HashMap<String, SyncedFeed>, feed: &SyncedFeed) {
    let key = &feed.feedUrl;
    let existing = merged.get(key);

    match existing {
        None => {
            merged.insert(key.clone(), feed.clone());
        }
        Some(incumbent) => {
            // "wins" check: candidate beats incumbent if:
            // 1. updatedAt is strictly greater, OR
            // 2. updatedAt is equal AND candidate has a tombstone (deletedAt) while incumbent doesn't
            if candidateWins(feed, incumbent) {
                merged.insert(key.clone(), feed.clone());
            }
        }
    }
}

/// Determine if `candidate` wins over `incumbent` per the merge rules.
fn candidateWins(candidate: &SyncedFeed, incumbent: &SyncedFeed) -> bool {
    if candidate.updatedAt != incumbent.updatedAt {
        return candidate.updatedAt > incumbent.updatedAt;
    }
    // Equal timestamps: tiebreak in favour of the tombstone (deletedAt).
    // Equal timestamps are possible (same millisecond, one server clock),
    // and the tiebreak has to be independent of argument order or the merge
    // stops being commutative and the two devices converge on different answers.
    // Tombstone wins: if candidate is deleted and incumbent is not, candidate wins.
    candidate.deletedAt.is_some() && incumbent.deletedAt.is_none()
}

// Tombstones stay in the synced set so deletions keep propagating, but the app
// only ever renders and fetches the live ones.

/// Return only the live (non-deleted) feeds, mapped to the simple `Feed` structure.
pub fn liveFeeds(feeds: &[SyncedFeed]) -> Vec<Feed> {
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