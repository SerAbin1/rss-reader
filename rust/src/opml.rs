//! OPML 2.0 support — parse and write.
//!
//! Port of the web app's `src/lib/opml.ts` and the Kotlin `Opml.kt`. Matches
//! outlines at any nesting depth, so folders/categories are flattened. `xmlUrl`
//! is required (outlines without it are folders). `title` falls back to
//! `text`, then to the xmlUrl itself. The sample fixture has 48 feeds.

use crate::models::Feed;
use std::fmt;

#[derive(Debug)]
pub enum OpmlParseError {
    InvalidOpml(String),
}

impl fmt::Display for OpmlParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            OpmlParseError::InvalidOpml(msg) => write!(f, "Invalid OPML file: {msg}"),
        }
    }
}

impl std::error::Error for OpmlParseError {}

/// Parse an OPML file into the list of feeds it subscribes to.
pub fn parse_opml(xml_text: &str) -> Result<Vec<Feed>, OpmlParseError> {
    let doc = roxmltree::Document::parse(xml_text)
        .map_err(|_| OpmlParseError::InvalidOpml("Failed to parse XML".to_string()))?;

    let mut feeds = Vec::new();
    for outline in doc.descendants().filter(|node| node.is_element() && node.tag_name().name() == "outline") {
        let xml_url = outline
            .attribute("xmlUrl")
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let xml_url = match xml_url {
            Some(xml_url) => xml_url.to_string(),
            None => continue,
        };
        let title = outline
            .attribute("title")
            .or_else(|| outline.attribute("text"))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(&xml_url)
            .to_string();
        feeds.push(Feed { feedUrl: xml_url, title, siteUrl: None });
    }
    Ok(feeds)
}

/// Write an OPML 2.0 document subscribing to the given feeds. `siteUrl` is
/// written as `htmlUrl` only when known, and never as a copy of `xmlUrl` —
/// that habit of exporters is what links readers at raw XML instead of the
/// site.
pub fn write_opml(feeds: &[Feed], title: &str) -> String {
    let mut result = String::new();
    result.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    result.push_str("<opml version=\"2.0\">\n");
    result.push_str("  <head>\n");
    result.push_str(&format!("    <title>{}</title>\n", escape_xml(title)));
    result.push_str("  </head>\n");
    result.push_str("  <body>\n");

    for feed in feeds {
        result.push_str("    <outline type=\"rss\"");
        result.push_str(&format!(" text=\"{}\"", escape_xml(&feed.title)));
        result.push_str(&format!(" title=\"{}\"", escape_xml(&feed.title)));
        result.push_str(&format!(" xmlUrl=\"{}\"", escape_xml(&feed.feedUrl)));
        if let Some(site_url) = &feed.siteUrl {
            result.push_str(&format!(" htmlUrl=\"{}\"", escape_xml(site_url)));
        }
        result.push_str(" />\n");
    }

    result.push_str("  </body>\n</opml>\n");
    result
}

/// Escape text for XML content or attribute values (both use the same five
/// entities). Ampersand first, so the entities aren't double-escaped.
fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = include_str!("__fixtures__/sample.opml");

    #[test]
    fn flattens_nested_folders() {
        let feeds = parse_opml(SAMPLE).unwrap();
        assert_eq!(feeds.len(), 48);
    }

    #[test]
    fn extracts_feed_url_and_title() {
        let feeds = parse_opml(SAMPLE).unwrap();
        assert!(feeds.iter().any(|feed| feed.feedUrl == "https://jvns.ca/atom.xml" && feed.title == "Julia Evans"));
    }

    #[test]
    fn folder_outlines_without_xml_url_are_skipped() {
        let feeds = parse_opml(SAMPLE).unwrap();
        assert!(!feeds.iter().any(|feed| feed.title == "Films"));
    }

    #[test]
    fn malformed_xml_throws() {
        assert!(parse_opml("<opml><body><outline").is_err());
    }

    #[test]
    fn roundtrip_preserves_feeds() {
        let feeds = parse_opml(SAMPLE).unwrap();
        let written = write_opml(&feeds, "Subscriptions");
        let reparsed = parse_opml(&written).unwrap();
        assert_eq!(reparsed, feeds);
    }

    #[test]
    fn writes_html_url_only_when_present() {
        let feeds = vec![Feed {
            feedUrl: "https://example.com/feed.xml".to_string(),
            title: "Example".to_string(),
            siteUrl: Some("https://example.com/".to_string()),
        }];
        let output = write_opml(&feeds, "Test");
        assert!(output.contains("htmlUrl=\"https://example.com/\""));
    }

    #[test]
    fn escapes_special_characters() {
        let feeds = vec![Feed {
            feedUrl: "https://example.com/feed.xml?a=1&b=2".to_string(),
            title: "A & B".to_string(),
            siteUrl: None,
        }];
        let output = write_opml(&feeds, "Title <with> & things");
        assert!(output.contains("A &amp; B"));
        assert!(output.contains("?a=1&amp;b=2"));
        assert!(output.contains("Title &lt;with&gt; &amp; things"));
    }
}
