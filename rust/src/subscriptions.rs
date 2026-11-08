use crate::models::Feed;
use std::collections::HashSet;

// Deciding *which* feeds an add should write, kept separate from the DOM and
// IndexedDB wiring so both add paths (one URL, or a whole OPML file) can be
// tested without a browser — same split as read_state.rs and sync_state.rs.

// The canonical form a feed is stored and compared under. Two feeds are the
// same subscription when this matches, so a URL that differs only in ways the
// server cannot see — host case, a fragment copied along from the browser bar,
// surrounding whitespace — must not land as a second copy of one feed.
//
// The fragment is dropped rather than rejected: a fetch never sends it, and
// `/feed.xml#comments` names the same document as `/feed.xml`. The path is
// left exactly as given, since `/feed` and `/feed/` really can be two
// different feeds. Only http(s), because that's all /api/feed will fetch, so
// anything else is a typo rather than a feed this app can read.

/// The canonical form a feed URL is stored and compared under.
///
/// Kept byte-for-byte identical to the web app's `new URL(...).toString()` for
/// any URL a human would subscribe to. The URL parser already lowercases the
/// host, drops the fragment, and removes a default port — only the rules on
/// top of that (http/https, drop fragment) live here.
pub fn normalize_feed_url(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let mut url = url::Url::parse(raw).ok()?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return None;
    }
    // The fetch never sends the fragment, so `/feed.xml#comments` names the
    // same document as `/feed.xml`.
    url.set_fragment(None);
    Some(url.to_string())
}

/// Splits candidates into the ones worth writing and the ones to leave alone.
/// `existing` is every feed already on the device — personal *and* curated,
/// since a curated feed is subscribed to on every load and a personal copy of
/// one would only render twice.
///
/// Purely additive by construction: an already-subscribed candidate is never
/// returned in `added`, so callers save exactly the new feeds and no existing
/// record is rewritten. Candidates are compared with each other too, since
/// one OPML file routinely lists the same feed under two folders.
pub fn plan_additions(candidates: &[Feed], existing: &[Feed]) -> FeedAdditions {
    // Normalized on this side too, not just the candidates': feeds stored
    // before normalization existed (an OPML's xmlUrl as-written) would
    // otherwise never match a candidate the user just pasted by hand, and the
    // one feed they'd most expect to already have would be added twice.
    let subscribed: HashSet<String> = existing
        .iter()
        .filter_map(|feed| normalize_feed_url(&feed.feedUrl))
        .collect();

    let mut added: Vec<Feed> = Vec::new();
    let mut claimed: HashSet<String> = HashSet::new();
    let mut already_subscribed: usize = 0;
    let mut invalid: usize = 0;

    for candidate in candidates {
        let feed_url = match normalize_feed_url(&candidate.feedUrl) {
            Some(feed_url) => feed_url,
            None => {
                invalid += 1;
                continue;
            }
        };
        if subscribed.contains(&feed_url) || claimed.contains(&feed_url) {
            already_subscribed += 1;
            continue;
        }
        claimed.insert(feed_url.clone());
        added.push(Feed {
            feedUrl: feed_url,
            title: candidate.title.clone(),
            siteUrl: candidate.siteUrl.clone(),
        });
    }

    FeedAdditions {
        added,
        alreadySubscribed: already_subscribed,
        invalid,
    }
}

/// The single line of feedback an import produces. The counts of what it
/// skipped are part of the message rather than console noise: a feed that
/// silently didn't arrive is indistinguishable from a bug, and on a re-import
/// of a file the device already has, "Imported 0 feeds" has to say whether
/// that was correct or broken.
pub fn describe_import(additions: &FeedAdditions) -> String {
    let mut parts = Vec::new();
    let count = additions.added.len();
    parts.push(format!(
        "Imported {count} feed{}.",
        if count == 1 { "" } else { "s" }
    ));
    if additions.alreadySubscribed > 0 {
        parts.push(format!("{} already subscribed.", additions.alreadySubscribed));
    }
    if additions.invalid > 0 {
        parts.push(format!("{} skipped — not a valid URL.", additions.invalid));
    }
    parts.join(" ")
}

/// The result of planning feed additions.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FeedAdditions {
    /// New subscriptions, in the order given, each carrying its normalized URL.
    pub added: Vec<Feed>,
    /// Candidates this device already has, at either scope.
    pub alreadySubscribed: usize,
    /// Candidates that aren't an http(s) URL at all and can't be subscribed to.
    pub invalid: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(url: &str) -> Feed {
        Feed { feedUrl: url.to_string(), title: url.to_string(), siteUrl: None }
    }

    fn feed_with_title(url: &str, title: &str) -> Feed {
        Feed { feedUrl: url.to_string(), title: title.to_string(), siteUrl: None }
    }

    mod normalize {
        use super::*;

        #[test]
        fn keeps_plain_url_as_given() {
            assert_eq!(
                normalize_feed_url("https://example.com/feed.xml").as_deref(),
                Some("https://example.com/feed.xml")
            );
        }

        #[test]
        fn trims_surrounding_whitespace() {
            assert_eq!(
                normalize_feed_url("  https://example.com/feed.xml\n").as_deref(),
                Some("https://example.com/feed.xml")
            );
        }

        #[test]
        fn lowercases_host() {
            assert_eq!(
                normalize_feed_url("https://Example.COM/feed.xml").as_deref(),
                Some("https://example.com/feed.xml")
            );
        }

        #[test]
        fn drops_fragment() {
            assert_eq!(
                normalize_feed_url("https://example.com/feed.xml#comments").as_deref(),
                Some("https://example.com/feed.xml")
            );
        }

        #[test]
        fn preserves_path_trailing_slash() {
            assert_ne!(
                normalize_feed_url("https://example.com/feed"),
                normalize_feed_url("https://example.com/feed/")
            );
        }

        #[test]
        fn preserves_query_string() {
            assert_eq!(
                normalize_feed_url("https://example.com/blog?format=rss").as_deref(),
                Some("https://example.com/blog?format=rss")
            );
        }

        #[test]
        fn rejects_missing_scheme() {
            assert_eq!(normalize_feed_url("example.com/feed.xml"), None);
        }

        #[test]
        fn rejects_non_http_schemes() {
            assert_eq!(normalize_feed_url("ftp://example.com/feed.xml"), None);
            assert_eq!(normalize_feed_url("javascript:alert(1)"), None);
        }

        #[test]
        fn rejects_empty() {
            assert_eq!(normalize_feed_url("   "), None);
        }
    }

    mod plan {
        use super::*;

        #[test]
        fn adds_new_feed() {
            let (added, already) = {
                let result = plan_additions(
                    &[feed_with_title("https://example.com/new.xml", "New")],
                    &[feed("https://other.com/old.xml")],
                );
                (result.added, result.alreadySubscribed)
            };
            assert_eq!(added, vec![Feed { feedUrl: "https://example.com/new.xml".to_string(), title: "New".to_string(), siteUrl: None }]);
            assert_eq!(already, 0);
        }

        #[test]
        fn reimport_is_noop() {
            let existing = vec![feed("https://a.com/f.xml"), feed("https://b.com/f.xml")];
            let result = plan_additions(&existing, &existing);
            assert!(result.added.is_empty());
            assert_eq!(result.alreadySubscribed, 2);
        }

        #[test]
        fn existing_record_untouched() {
            let existing = vec![Feed { feedUrl: "https://a.com/f.xml".to_string(), title: "A".to_string(), siteUrl: Some("https://a.com/".to_string()) }];
            let result = plan_additions(&[feed_with_title("https://a.com/f.xml", "Renamed")], &existing);
            assert!(result.added.is_empty());
            assert_eq!(existing[0].siteUrl.as_deref(), Some("https://a.com/"));
        }

        #[test]
        fn curated_feed_counts_as_subscribed() {
            let result = plan_additions(&[feed("https://curated.com/f.xml")], &[feed("https://curated.com/f.xml")]);
            assert!(result.added.is_empty());
            assert_eq!(result.alreadySubscribed, 1);
        }

        #[test]
        fn recognises_pre_normalization_existing() {
            let result = plan_additions(&[feed("https://example.com/f.xml")], &[feed("https://Example.com/f.xml#comments")]);
            assert!(result.added.is_empty());
            assert_eq!(result.alreadySubscribed, 1);
        }

        #[test]
        fn stores_normalized_url_for_new() {
            let result = plan_additions(&[feed("https://Example.com/f.xml#x")], &[]);
            assert_eq!(result.added, vec![Feed { feedUrl: "https://example.com/f.xml".to_string(), title: "https://Example.com/f.xml#x".to_string(), siteUrl: None }]);
        }

        #[test]
        fn partially_overlapping_file() {
            let result = plan_additions(
                &[feed("https://a.com/f.xml"), feed_with_title("https://new.com/f.xml", "New"), feed("https://b.com/f.xml")],
                &[feed("https://a.com/f.xml"), feed("https://b.com/f.xml")],
            );
            assert_eq!(result.added, vec![Feed { feedUrl: "https://new.com/f.xml".to_string(), title: "New".to_string(), siteUrl: None }]);
            assert_eq!(result.alreadySubscribed, 2);
        }

        #[test]
        fn repeated_feed_in_file_added_once() {
            let result = plan_additions(
                &[feed_with_title("https://a.com/f.xml", "First"), feed_with_title("https://a.com/f.xml", "Second")],
                &[],
            );
            assert_eq!(result.added, vec![Feed { feedUrl: "https://a.com/f.xml".to_string(), title: "First".to_string(), siteUrl: None }]);
            assert_eq!(result.alreadySubscribed, 1);
        }

        #[test]
        fn invalid_urls_are_counted() {
            let result = plan_additions(
                &[feed("not a url"), feed("ftp://example.com/f.xml"), feed("https://a.com/f.xml")],
                &[],
            );
            assert_eq!(result.added, vec![Feed { feedUrl: "https://a.com/f.xml".to_string(), title: "https://a.com/f.xml".to_string(), siteUrl: None }]);
            assert_eq!(result.invalid, 2);
        }
    }

    mod describe {
        use super::*;

        #[test]
        fn pluralizes_count() {
            fn imported(count: usize) -> String {
                describe_import(&FeedAdditions {
                    added: (0..count).map(|i| feed(&format!("https://{i}.com/f.xml"))).collect(),
                    alreadySubscribed: 0,
                    invalid: 0,
                })
            }
            assert_eq!(imported(0), "Imported 0 feeds.");
            assert_eq!(imported(1), "Imported 1 feed.");
            assert_eq!(imported(48), "Imported 48 feeds.");
        }

        #[test]
        fn says_what_reimport_skipped() {
            let result = describe_import(&FeedAdditions { added: vec![], alreadySubscribed: 48, invalid: 0 });
            assert_eq!(result, "Imported 0 feeds. 48 already subscribed.");
        }

        #[test]
        fn reports_unusable_entries() {
            let result = describe_import(&FeedAdditions {
                added: vec![feed("https://a.com/f.xml")],
                alreadySubscribed: 2,
                invalid: 1,
            });
            assert_eq!(result, "Imported 1 feed. 2 already subscribed. 1 skipped — not a valid URL.");
        }
    }
}
