package io.github.serabin1.rssreader.core

import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// Port of the web app's feed parser — backed by the shared Rust crate via JNI
// (see RssReaderCore), so RSS/Atom handling matches the web app byte-for-byte.

class FeedParseException(
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause)

object FeedParser {
    fun parse(
        bytes: ByteArray,
        feedUrl: String,
    ): ParsedFeed = parse(feedUrl) { String(bytes, Charsets.UTF_8) }

    fun parse(
        text: String,
        feedUrl: String,
    ): ParsedFeed = parse(feedUrl) { text }

    // The crate reports errors as a {"error": "..."} envelope; on success the
    // post's publishedAt is its original raw feed date string — the crate's
    // parser has already validated and normalized it into an ISO timestamp.
    private fun parse(
        feedUrl: String,
        load: () -> String,
    ): ParsedFeed {
        val json = RssReaderCore.parseFeedJson(load(), feedUrl)
        val root = runCatching { Wire.json.parseToJsonElement(json).jsonObject }.getOrElse {
            throw FeedParseException("Invalid feed XML", it)
        }
        root["error"]?.let { throw FeedParseException(it.jsonPrimitive.content) }
        val wire = Wire.json.decodeFromString<Wire.ParsedFeed>(json)
        return ParsedFeed(
            title = wire.title,
            siteUrl = wire.siteUrl,
            posts = wire.posts.map { post ->
                Post(
                    feedUrl = post.feedUrl,
                    guid = post.guid,
                    title = post.title,
                    link = post.link,
                    publishedAt = post.publishedAt.toMillis(),
                )
            },
        )
    }
}
