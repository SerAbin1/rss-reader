use crate::models::Feed;
use std::str::FromStr;

// The canonical form a feed is stored and compared under. Two feeds are the
// same subscription when this matches, so a URL that differs only in ways the
// server cannot see — host case, a fragment copied along from the browser bar,
// surrounding whitespace — must not land as a second copy of one feed.

// The fragment is dropped rather than rejected: a fetch never sends it, and
// `/feed.xml#comments` names the same document as `/feed.xml`. The path is
// left exactly as given, since `/feed` and `/feed/` really can be two
// different feeds. Only http(s), because that's all /api/feed will fetch, so
// anything else is a typo rather than a feed this app can read.

/// Normalize a feed URL the same way the web app's `new URL(...).toString()` does.
/// This is also the sync key, so it must come out byte-for-byte the same as
// any URL a person would realistically subscribe to.
pub fn normalizeFeedUrl(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let url = std::net::Url::from_str(raw).ok()?;
    if url.protocol() != "http:" && url.protocol() != "https:" {
        return None;
    }
    // Drop the fragment: a fetch never sends it, and
    // `/feed.xml#comments` names the same document as `/feed.xml`.
    let mut url = url;
    url.set_fragment(None);
    // Also suppress default ports so that :80 on http and :443 on https
    // don't cause mismatches.
    if (url.protocol() == "http:" && url.port() == Some(80))
        || (url.protocol() == "https:" && url.port() == Some(443))
    {
        url.set_port(None);
    }
    Some(url.to_string())
}

// Splits candidates into the ones worth writing and the ones to leave alone.
// `existing` is every feed already on the device — personal *and* curated,
// since a curated feed is subscribed to on every load and a personal copy of
// one would only render twice.

// Purely additive by construction: an already-subscribed candidate is never
// returned in `added`, so callers save exactly the new feeds and no existing
// record is rewritten. That's what makes re-importing an OPML file a no-op
// rather than a second write of the same rows, and it also means the siteUrl
// discovered on a feed's first load survives every later import.

// Candidates are compared with each other too, since one OPML file routinely
// lists the same feed under two folders.
pub fn planAdditions(
    candidates: &[Feed],
    existing: &[Feed],
) -> FeedAdditions {
    // Normalized on this side too, not just the candidates': feeds stored
    // before normalization existed (an OPML's `xmlUrl` as-written) would
    // otherwise never match a candidate the user just pasted by hand, and the
    // one feed they'd most expect to already have would be added twice.
    let subscribed = existing
        .iter()
        .map(|feed| normalizeFeedUrl(&feed.feedUrl))
        .filter(|feedUrl| feedUrl.is_some())
        .map(|f| f.unwrap())
        .collect::<std::collections::HashSet<_>>();
    let mut added: Vec<Feed> = Vec::new();
    let mut claimed: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut alreadySubscribed = 0;
    let mut invalid = 0;

    for candidate in candidates {
        let feedUrl = normalizeFeedUrl(&candidate.feedUrl);
        if feedUrl.is_none() {
            invalid += 1;
            continue;
        }
        let feedUrl = feedUrl.unwrap();
        if subscribed.contains(&feedUrl) || claimed.contains(&feedUrl) {
            alreadySubscribed += 1;
            continue;
        }
        claimed.insert(feedUrl);
        added.push(Feed {
            feedUrl,
            title: candidate.title.clone(),
            siteUrl: candidate.siteUrl.clone(),
        });
    }

    FeedAdditions {
        added,
        alreadySubscribed,
        invalid,
    }
}

/// The single line of feedback an import produces. The counts of what it skipped
/// are part of the message rather than console noise: a feed that silently
/// didn't arrive is indistinguishable from a bug, and on a re-import of a file
/// the device already has, "Imported 0 feeds" has to say whether that was
/// correct or broken.
pub fn describeImport(additions: &FeedAdditions) -> String {
    let mut parts = Vec::new();
    let count = additions.added.len();
    parts.push(format!("Imported {count} feed{}", if count == 1 { "" } else { "s" }));
    if additions.alreadySubscribed > 0 {
        parts.push(format!("{} already subscribed.", additions.alreadySubscribed));
    }
    if additions.invalid > 0 {
        parts.push(format!("{} skipped — not a valid URL.", additions.invalid));
    }
    parts.join(" ")
}

/// The result of planning feed additions.
#[derive(Debug, Clone)]
pub struct FeedAdditions {
    /// New subscriptions, in the order given, each carrying its normalized URL.
    pub added: Vec<Feed>,
    /// Candidates this device already has, at either scope. Nothing is written
    // for these — see planAdditions.
    pub alreadySubscribed: usize,
    /// Candidates that aren't an http(s) URL at all and can't be subscribed to.
    pub invalid: usize,
}