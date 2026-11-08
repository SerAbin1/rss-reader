//! rss-reader-core: Shared core logic for RSS reader.
//! Consumed by: Web (WASM) + Android (JNI)

// Declare modules
mod models;

// Re-export public types
pub use models::{Feed, Post, ParsedFeed};