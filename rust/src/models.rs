//! Mirrors the web app's `src/lib/db.ts` and the Kotlin `core/Models.kt`.
//! Field names are camelCase on purpose: they cross the WASM/JNI boundary and
//! land in JS/TS code that reads `feedUrl`, `siteUrl`, `publishedAt`, and in
//! the SQL/JSON sync payloads that use the same spellings.

use serde::{Deserialize, Serialize};

/// A feed subscription — the canonical form a feed is stored and compared
/// under. Two feeds are the same subscription when their normalized feedUrl
/// matches.
#[allow(non_snake_case)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Feed {
    /// The feed's URL (normalized: lowercased host, no fragment, default ports suppressed)
    pub feedUrl: String,
    /// The feed's own homepage or blog title, as declared on the feed document
    pub title: String,
    /// The feed's own homepage. Never OPML's htmlUrl copy — the feed document is authoritative.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub siteUrl: Option<String>,
}

impl Default for Feed {
    fn default() -> Self {
        Self {
            feedUrl: String::new(),
            title: String::new(),
            siteUrl: None,
        }
    }
}

/// A single RSS/Atom post/article.
#[allow(non_snake_case)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Post {
    /// The feed URL this post belongs to
    pub feedUrl: String,
    /// The GUID/permalink for this post — unique within its feed
    pub guid: String,
    /// The post title
    pub title: String,
    /// The article URL
    pub link: String,
    /// The post's publication date, as `new Date().toISOString()` would render it
    pub publishedAt: String,
}

impl Default for Post {
    fn default() -> Self {
        Self {
            feedUrl: String::new(),
            guid: String::new(),
            title: String::new(),
            link: String::new(),
            publishedAt: String::new(),
        }
    }
}

/// The result of parsing a feed document — channel-level metadata plus its posts.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedFeed {
    /// The feed's own name (RSS channel/title, Atom feed-level title)
    pub title: Option<String>,
    /// The feed's own homepage, as the feed document declares it
    pub siteUrl: Option<String>,
    /// The list of posts in this feed
    pub posts: Vec<Post>,
}
