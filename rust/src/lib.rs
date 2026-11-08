// camelCase everywhere is deliberate: the crate mirrors the TS/Kotlin data
// shapes exactly so they cross WASM/JNI untouched.
#![allow(non_snake_case)]

//! rss-reader-core: Shared core logic for the RSS reader.
//!
//! Consumed by the Astro web app (via WASM) and the Android app (via JNI).
//! Every module here is pure logic — no I/O, no DOM, no framework APIs — so it
//! can be compiled once and unit-tested on the host; the two apps wrap the
//! output for their own environments.

mod models;
mod timestamps;

pub mod feed_parser;
pub mod opml;
pub mod read_state;
pub mod reconcile;
pub mod relative_date;
pub mod subscriptions;
pub mod sync_state;

// Re-export the data types and everything both apps need to see.
pub use feed_parser::{parse_feed, parse_feed_from_bytes, FeedParseError};
pub use models::{Feed, ParsedFeed, Post};
pub use opml::{parse_opml, write_opml, OpmlParseError};
pub use reconcile::{apply_group, plan_push, ReconcilePush, ReconcileResult, RemoteFeed};
pub use timestamps::{format_iso_millis, parse_iso_millis};
pub use read_state::{favourite_key, find_first_unread_index, is_listed, is_read, watermark_after_click, watermark_after_mark_up_to};
pub use relative_date::{format_full_date, format_post_date};
pub use subscriptions::{describe_import, normalize_feed_url, plan_additions, FeedAdditions};
pub use sync_state::{format_pair_code, is_pair_code_usable, live_feeds, merge_feeds, merge_watermark, PairCode, SyncedFeed};
