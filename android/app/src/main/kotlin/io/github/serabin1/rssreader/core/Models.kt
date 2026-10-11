package io.github.serabin1.rssreader.core

// The same two records as the web app's src/lib/db.ts and feed-parser.ts.

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
    // Epoch milliseconds, truncated to the millisecond like a JS Date, so a
    // watermark round-tripped through the web app compares exactly.
    val publishedAt: Long,
)

data class ParsedFeed(
    val title: String?,
    val siteUrl: String?,
    val posts: List<Post>,
)
