use crate::models::{ParsedFeed, Post};
use crate::timestamps::format_iso_millis;
use roxmltree::Node;
use std::fmt;

// Port of the web app's src/lib/feed-parser.ts (and the Kotlin
// FeedParser.kt). What counts as a post is kept identical — the same required
// fields, the same date fallbacks — because the watermark is shared: a post
// one client shows and the other silently drops would make "read up to here"
// mean different things on each device.
//
// Field order in `Post` mirrors the web app's interface (guid before title is
// NOT the order there; this is the same order the Kotlin data class uses).

#[derive(Debug)]
pub enum FeedParseError {
    InvalidFeedXml(String),
    UnrecognizedFeedFormat(String),
    MissingRequiredField(String),
}

impl fmt::Display for FeedParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FeedParseError::InvalidFeedXml(msg) => write!(f, "Invalid feed XML: {msg}"),
            FeedParseError::UnrecognizedFeedFormat(msg) => write!(f, "Unrecognized feed format: {msg}"),
            FeedParseError::MissingRequiredField(msg) => write!(f, "Missing required field: {msg}"),
        }
    }
}

impl std::error::Error for FeedParseError {}

/// Parse an RSS or Atom feed, returning both channel-level metadata (`title`,
/// `siteUrl`) and the posts. `title` is the feed's own name — what a manually
/// added feed is listed as, since a hand-typed URL has no better label.
/// `siteUrl` is the feed's own homepage — the human-readable site, not the
/// XML. Both are None when the document doesn't declare them.
pub fn parse_feed(xml_text: &str, feed_url: &str) -> Result<ParsedFeed, FeedParseError> {
    let doc = roxmltree::Document::parse(xml_text)
        .map_err(|_| FeedParseError::InvalidFeedXml("Failed to parse XML".to_string()))?;
    let root_name = doc.root_element().tag_name().name();
    match root_name {
        "rss" => parse_rss(&doc, feed_url),
        "feed" => parse_atom(&doc, feed_url),
        _ => Err(FeedParseError::UnrecognizedFeedFormat(format!(
            "not RSS or Atom (root element: {root_name})"
        ))),
    }
}

fn parse_rss(doc: &roxmltree::Document, feed_url: &str) -> Result<ParsedFeed, FeedParseError> {
    find_child_by_local_name(doc.root_element(), "channel")
        .ok_or_else(|| FeedParseError::MissingRequiredField("channel".to_string()))?;

    // The feed's title is the channel title, not an item's — the items have
    // their own. Direct children only.
    let title = child_text(doc.root_element(), "channel/title")
        .map(|t| t);

    // The feed is authoritative for its own homepage: OPML's htmlUrl is
    // unreliable (exporters copy the feed URL into it), so it's never used
    // for this. RSS 2.0 requires channel > link.
    let site_url = child_text(doc.root_element(), "channel/link")
        .map(|t| t);

    let mut posts = Vec::new();
    for item in doc.descendants().filter(|node| node.is_element() && node.tag_name().name() == "item") {
        let title = match child_text_of(item, "title") {
            Some(value) => value,
            None => continue,
        };
        let link = match child_text_of(item, "link") {
            Some(value) => value,
            None => continue,
        };
        let guid = child_text_of(item, "guid").unwrap_or_else(|| link.clone());
        let pub_date = match child_text_of(item, "pubDate") {
            Some(text) => match crate::timestamps::parse_iso_millis(&text) {
                Some(millis) => format_iso_millis(millis),
                None => continue,
            },
            None => continue,
        };
        posts.push(Post {
            feedUrl: feed_url.to_string(),
            guid,
            title,
            link,
            publishedAt: pub_date,
        });
    }

    Ok(ParsedFeed {
        title,
        siteUrl: site_url,
        posts,
    })
}

fn parse_atom(doc: &roxmltree::Document, feed_url: &str) -> Result<ParsedFeed, FeedParseError> {
    let ns = doc.root_element().tag_name().namespace().map(String::from);

    let title = find_child_with_namespace(doc.root_element(), "title", ns.as_deref())
        .and_then(|node| node.text())
        .map(|text| text.trim().to_string());

    let site_url = atom_alternate_link(doc.root_element(), ns.as_deref());

    let mut posts = Vec::new();
    for entry in doc.descendants().filter(|node| node.is_element() && node.tag_name().name() == "entry") {
        let title = match child_text_with_ns(entry, "title", ns.as_deref()) {
            Some(value) => value,
            None => continue,
        };
        let link = match atom_alternate_link(entry, ns.as_deref()) {
            Some(value) => value,
            None => continue,
        };
        let guid = child_text_with_ns(entry, "id", ns.as_deref()).unwrap_or_else(|| link.clone());
        // <updated> fallback: published, then updated — both RFC 3339.
        let published = child_text_with_ns(entry, "published", ns.as_deref())
            .or_else(|| child_text_with_ns(entry, "updated", ns.as_deref()));
        let published_at = match published {
            Some(text) => match crate::timestamps::parse_iso_millis(&text) {
                Some(millis) => format_iso_millis(millis),
                None => continue,
            },
            None => continue,
        };
        posts.push(Post {
            feedUrl: feed_url.to_string(),
            guid,
            title,
            link,
            publishedAt: published_at,
        });
    }

    Ok(ParsedFeed {
        title,
        siteUrl: site_url,
        posts,
    })
}

// --- helpers ---------------------------------------------------------------

// Direct children only, matched on local name — a bare `title` would otherwise
// catch an item/entry title, and so on.
fn find_child_by_local_name<'a>(parent: Node<'a, 'a>, local_name: &str) -> Option<Node<'a, 'a>> {
    parent
        .children()
        .find(|child| child.is_element() && child.tag_name().name() == local_name)
}

fn child_text(parent: Node, path: &str) -> Option<String> {
    let mut current = parent;
    for part in path.split('/') {
        current = find_child_by_local_name(current, part)?;
    }
    current.text().map(|text| text.trim().to_string()).filter(|text| !text.is_empty())
}

fn child_text_of(parent: Node, local_name: &str) -> Option<String> {
    find_child_by_local_name(parent, local_name)
        .and_then(|node| node.text())
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn find_child_with_namespace<'a>(parent: Node<'a, 'a>, local_name: &str, ns: Option<&str>) -> Option<Node<'a, 'a>> {
    parent.children().find(|child| {
        child.is_element()
            && child.tag_name().name() == local_name
            && match ns {
                None => true,
                Some(ns) => child.tag_name().namespace() == Some(ns),
            }
    })
}

fn child_text_with_ns(parent: Node, local_name: &str, ns: Option<&str>) -> Option<String> {
    find_child_with_namespace(parent, local_name, ns)
        .and_then(|node| node.text())
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

// Atom entries can carry several <link> elements (self, alternate, ...);
// the article URL is the one with rel="alternate", or no rel at all (the spec
// default). Direct children only, so a feed's own link never picks up an
// entry's. The feed-level alternate is what this also returns when called on
// <feed> itself, which is why the same function serves both.
fn atom_alternate_link(parent: Node, ns: Option<&str>) -> Option<String> {
    for child in parent.children() {
        if !child.is_element() || child.tag_name().name() != "link" {
            continue;
        }
        if let Some(ns) = ns {
            if child.tag_name().namespace() != Some(ns) {
                continue;
            }
        }
        let rel = child.attribute("rel");
        let href = child.attribute("href");
        let is_alternate = rel.map(|rel| rel == "alternate" || rel.is_empty()).unwrap_or(true);
        if is_alternate {
            if let Some(href) = href {
                let href = href.trim();
                if !href.is_empty() {
                    return Some(href.to_string());
                }
            }
        }
    }
    None
}

/// Same name as the web app's `parseFeed`, exposed for callers in TS and
/// Kotlin that will call through WASM/JNI.
pub fn parse_feed_from_bytes(bytes: &[u8], feed_url: &str) -> Result<ParsedFeed, FeedParseError> {
    let xml_text = std::str::from_utf8(bytes)
        .map_err(|_| FeedParseError::InvalidFeedXml("Invalid UTF-8 in feed".to_string()))?;
    parse_feed(xml_text, feed_url)
}

// Namespace-qualified helpers for consumers that pass a namespace explicitly.
// These accept the namespace URI directly (e.g. "http://www.w3.org/2005/Atom").

#[allow(dead_code)]
fn find_child_text_direct_ns(parent: Node, local_name: &str, ns: Option<&str>) -> Option<String> {
    child_text_with_ns(parent, local_name, ns)
}

#[allow(dead_code)]
fn find_link_direct_ns(parent: Node, ns: Option<&str>) -> Option<String> {
    atom_alternate_link(parent, ns)
}

#[cfg(test)]
mod tests {
    use super::*;

    const RSS: &str = include_str!("__fixtures__/sample-rss.xml");
    const ATOM: &str = include_str!("__fixtures__/sample-atom.xml");

    #[test]
    fn rss_parses_items_skipping_missing_fields() {
        let ParsedFeed { posts, .. } = parse_feed(RSS, "https://example.com/rss.xml").unwrap();
        assert_eq!(posts.len(), 2);
    }

    #[test]
    fn rss_extracts_fields_and_iso_date() {
        let ParsedFeed { posts, .. } = parse_feed(RSS, "https://example.com/rss.xml").unwrap();
        assert_eq!(
            posts[0],
            Post {
                feedUrl: "https://example.com/rss.xml".to_string(),
                guid: "https://example.com/first-post".to_string(),
                title: "First post".to_string(),
                link: "https://example.com/first-post".to_string(),
                publishedAt: "2026-08-24T09:00:00.000Z".to_string(),
            }
        );
    }

    #[test]
    fn rss_site_url_is_channel_link_not_item_link() {
        let ParsedFeed { siteUrl, .. } = parse_feed(RSS, "https://example.com/rss.xml").unwrap();
        assert_eq!(siteUrl.as_deref(), Some("https://example.com/"));
    }

    #[test]
    fn rss_title_is_channel_title_not_item_title() {
        let ParsedFeed { title, .. } = parse_feed(RSS, "https://example.com/rss.xml").unwrap();
        assert_eq!(title.as_deref(), Some("Sample RSS Blog"));
    }

    #[test]
    fn rss_guid_used_even_when_not_a_url() {
        let ParsedFeed { posts, .. } = parse_feed(RSS, "https://example.com/rss.xml").unwrap();
        assert_eq!(posts[1].guid, "urn:uuid:second-post");
    }

    #[test]
    fn atom_parses_entries_skipping_missing_fields() {
        let ParsedFeed { posts, .. } = parse_feed(ATOM, "https://example.org/atom.xml").unwrap();
        assert_eq!(posts.len(), 2);
    }

    #[test]
    fn atom_prefers_alternate_over_self() {
        let ParsedFeed { posts, .. } = parse_feed(ATOM, "https://example.org/atom.xml").unwrap();
        assert_eq!(posts[0].link, "https://example.org/first-entry");
    }

    #[test]
    fn atom_site_url_is_feed_alternate_not_self_or_entry_alternate() {
        let ParsedFeed { siteUrl, .. } = parse_feed(ATOM, "https://example.org/atom.xml").unwrap();
        assert_eq!(siteUrl.as_deref(), Some("https://example.org/"));
    }

    #[test]
    fn atom_title_is_feed_title_not_entry_title() {
        let ParsedFeed { title, .. } = parse_feed(ATOM, "https://example.org/atom.xml").unwrap();
        assert_eq!(title.as_deref(), Some("Sample Atom Blog"));
    }

    #[test]
    fn atom_updated_is_used_when_published_absent() {
        let ParsedFeed { posts, .. } = parse_feed(ATOM, "https://example.org/atom.xml").unwrap();
        assert_eq!(posts[1].publishedAt, "2026-08-25T09:00:00.000Z");
    }

    #[test]
    fn malformed_xml_throws() {
        assert!(parse_feed("<rss><channel", "https://example.com/rss.xml").is_err());
    }

    #[test]
    fn non_feed_document_throws() {
        assert!(parse_feed("<html><body>not a feed</body></html>", "https://example.com/x").is_err());
    }
}
