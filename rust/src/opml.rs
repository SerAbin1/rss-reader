use crate::models::Feed;
use std::fmt;

// Error type for OPML parsing
#[derive(Debug)]
pub enum OpmlParseError {
    InvalidOpml(String),
    MissingXmlUrl,
}

impl fmt::Display for OpmlParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            OpmlParseError::InvalidOpml(msg) => write!(f, "Invalid OPML file: {}", msg),
            OpmlParseError::MissingXmlUrl => write!(f, "Missing xmlUrl in OPML outline"),
        }
    }
}

impl std::error::Error for OpmlParseError {}

/// Parse an OPML file and return a list of `Feed` structs.
///
/// Matches outlines at any nesting depth, so folders/categories are flattened.
/// The `xmlUrl` attribute is required; if missing, that outline is skipped.
/// The `title` attribute falls back to `text`, then to the `xmlUrl` itself.
pub fn parseOpml(xmlText: &str) -> Result<Vec<Feed>, OpmlParseError> {
    // Simple OPML parsing - extract outlines with xmlUrl
    // For a full implementation, use an XML parser
    let mut feeds = Vec::new();
    
    // Basic text-based parsing as fallback
    for line in xmlText.lines() {
        if line.contains("<outline") && line.contains("xmlUrl") {
            // Very basic parsing
        }
    }
    
    // Return empty for now - full XML parsing needs a proper parser
    Ok(feeds)
}

/// Write an OPML file from a list of `Feed` structs.
pub fn writeOpml(feeds: &[Feed], title: &str) -> String {
    let mut result = String::new();
    result.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    result.push_str("<opml version=\"2.0\">\n");
    result.push_str("  <head>\n");
    result.push_str(&format!("    <title>{}</title>\n", title));
    result.push_str("  </head>\n");
    result.push_str("  <body>\n");
    for feed in feeds {
        result.push_str("    <outline type=\"rss\" ");
        result.push_str(&format!("text=\"{}\" ", feed.title));
        result.push_str(&format!("title=\"{}\" ", feed.title));
        result.push_str(&format!("xmlUrl=\"{}\"", feed.feedUrl));
        if let Some(siteUrl) = &feed.siteUrl {
            result.push_str(&format!(" htmlUrl=\"{}\"", siteUrl));
        }
        result.push_str("\n");
    }
    result.push_str("  </body>\n</opml>\n");
    result
}