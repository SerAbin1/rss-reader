//! The reconcile decisions for cross-device feed sync, split from the network
//! and database calls so they can be tested alone. The server owns the
//! timestamps, so it alone decides last-write-wins; this device only reports
//! what the group doesn't know yet.

use crate::models::Feed;

/// One feed as the group knows it (synced representation).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteFeed {
    pub feedUrl: String,
    pub title: String,
    /// true if the group tombstoned this feed.
    pub deleted: bool,
}

/// What this device must tell the group before it can consume its answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReconcilePush {
    /// Personal feeds the group has never heard of: adds made before pairing
    /// or offline. A feed the group knows only as a tombstone is not one — it
    /// was removed elsewhere, and is deleted here instead.
    pub additions: Vec<Feed>,
    /// Live in the group but curated now: retracted, or every paired device's
    /// next pull would resurrect it as a personal feed.
    pub retractions: Vec<String>,
}

impl ReconcilePush {
    pub fn is_empty(&self) -> bool {
        self.additions.is_empty() && self.retractions.is_empty()
    }
}

/// What this device should keep after it applies the group's answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReconcileResult {
    /// Live feeds in the group, minus the curated ones (shared with every
    /// device; never adopted as personal).
    pub live: Vec<Feed>,
    /// Tombstoned feeds in the group: remove them here too.
    pub removed: Vec<String>,
}

/// Work out what to tell the group.
///
/// `personal` — every live personal subscription on this device.
/// `curated_urls` — the normalised URLs of the curated feeds.
/// `remote` — the feeds the group knows about, live or tombstoned.
pub fn plan_push(personal: &[Feed], curated_urls: &[String], remote: &[RemoteFeed]) -> ReconcilePush {
    let remote_urls: std::collections::HashSet<&str> = remote.iter().map(|feed| feed.feedUrl.as_str()).collect();
    let curated: std::collections::HashSet<&str> = curated_urls.iter().map(String::as_str).collect();

    let additions = personal
        .iter()
        .filter(|feed| !remote_urls.contains(feed.feedUrl.as_str()) && !curated.contains(feed.feedUrl.as_str()))
        .cloned()
        .collect();

    let retractions = remote
        .iter()
        .filter(|feed| !feed.deleted && curated.contains(feed.feedUrl.as_str()))
        .map(|feed| feed.feedUrl.clone())
        .collect();

    ReconcilePush { additions, retractions }
}

/// Work out what to keep after the group answers.
///
/// Curated feeds are never touched by the group: they're kept whatever the
/// group says, and never adopted as personal.
pub fn apply_group(group: &[RemoteFeed], curated_urls: &[String]) -> ReconcileResult {
    let curated: std::collections::HashSet<&str> = curated_urls.iter().map(String::as_str).collect();

    let live = group
        .iter()
        .filter(|feed| !feed.deleted && !curated.contains(feed.feedUrl.as_str()))
        .map(|feed| Feed {
            feedUrl: feed.feedUrl.clone(),
            title: feed.title.clone(),
            siteUrl: None,
        })
        .collect();

    let removed = group
        .iter()
        .filter(|feed| feed.deleted && !curated.contains(feed.feedUrl.as_str()))
        .map(|feed| feed.feedUrl.clone())
        .collect();

    ReconcileResult { live, removed }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(url: &str) -> Feed {
        Feed { feedUrl: url.to_string(), title: url.to_string(), siteUrl: None }
    }

    fn live(url: &str) -> RemoteFeed {
        RemoteFeed { feedUrl: url.to_string(), title: url.to_string(), deleted: false }
    }

    fn dead(url: &str) -> RemoteFeed {
        RemoteFeed { feedUrl: url.to_string(), title: url.to_string(), deleted: true }
    }

    #[test]
    fn pushes_additions_the_group_never_heard_of() {
        let push = plan_push(
            &[feed("https://new.com/f"), feed("https://known.com/f")],
            &[],
            &[live("https://known.com/f")],
        );
        assert_eq!(push.additions, vec![feed("https://new.com/f")]);
    }

    #[test]
    fn does_not_push_feeds_group_knows_only_as_tombstone() {
        let push = plan_push(&[feed("https://dead.com/f")], &[], &[dead("https://dead.com/f")]);
        assert!(push.additions.is_empty());
        assert!(push.retractions.is_empty());
    }

    #[test]
    fn does_not_push_curated_feeds() {
        let push = plan_push(
            &[feed("https://curated.com/f")],
            &["https://curated.com/f".to_string()],
            &[],
        );
        assert!(push.additions.is_empty());
    }

    #[test]
    fn retracts_live_remote_feeds_that_became_curated() {
        let push = plan_push(
            &[],
            &["https://curated.com/f".to_string()],
            &[live("https://curated.com/f")],
        );
        assert_eq!(push.retractions, vec!["https://curated.com/f".to_string()]);
    }

    #[test]
    fn empty_push_when_nothing_to_do() {
        let push = plan_push(&[], &[], &[]);
        assert!(push.is_empty());
    }

    #[test]
    fn group_keeps_live_except_curated() {
        let result = apply_group(&[live("https://a.com/f"), live("https://curated.com/f")], &["https://curated.com/f".to_string()]);
        assert_eq!(result.live, vec![feed("https://a.com/f")]);
    }

    #[test]
    fn group_removes_tombstones_except_curated() {
        let result = apply_group(&[dead("https://a.com/f"), dead("https://curated.com/f")], &["https://curated.com/f".to_string()]);
        assert_eq!(result.removed, vec!["https://a.com/f".to_string()]);
    }
}
