package io.github.serabin1.rssreader.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

// Wire shapes for the Rust crate's JSON boundary — never used by the app
// directly. Field names are aligned byte-for-byte with the crate's serde
// output (Post.publishedAt is an ISO string here, epoch millis in the app).
internal object Wire {
    val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    @Serializable
    data class Feed(val feedUrl: String, val title: String, val siteUrl: String? = null)

    @Serializable
    data class Post(
        val feedUrl: String,
        val guid: String,
        val title: String,
        val link: String,
        val publishedAt: String,
    )

    @Serializable
    data class ParsedFeed(val title: String?, val siteUrl: String?, val posts: List<Post>)

    @Serializable
    data class SyncedFeed(
        val feedUrl: String,
        val title: String,
        val updatedAt: Long,
        val deletedAt: Long? = null,
    )

    @Serializable
    data class PairCode(val expiresAt: Long, val claimedAt: Long? = null)

    @Serializable
    data class RemoteFeed(val feedUrl: String, val title: String, val deleted: Boolean)

    @Serializable
    data class FeedAdditions(val added: List<Feed>, val alreadySubscribed: Int, val invalid: Int)

    @Serializable
    data class ReconcilePush(val additions: List<Feed>, val retractions: List<String>)

    @Serializable
    data class ReconcileResult(val live: List<Feed>, val removed: List<String>)
}
