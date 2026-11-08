package io.github.serabin1.rssreader.core

// The app-facing shapes, matching the Rust crate's `models.rs` one-to-one
// (publishedAt is epoch milliseconds here vs ISO elsewhere, matching how the
// shared watermark is persisted as millis and compared on the JVM).

data class Feed(
    val feedUrl: String,
    val title: String,
    // The feed's own homepage, as the feed document declares it. Never OPML's
    // htmlUrl — see FeedParser.
    val siteUrl: String? = null,
)

data class Post(
    val feedUrl: String,
    val guid: String,
    val title: String,
    val link: String,
    val publishedAt: Long,
)

data class ParsedFeed(
    val title: String?,
    val siteUrl: String?,
    val posts: List<Post>,
)

// The result of planning a batch of feed additions — the same shape the web
// app uses for its import flow.
data class FeedAdditions(
    val added: List<Feed>,
    val alreadySubscribed: Int,
    val invalid: Int,
)
