package io.github.serabin1.rssreader.core

import java.net.URI
import java.net.URISyntaxException

// Port of src/lib/subscriptions.ts — see the comments there for the reasoning.
// The normalized URL is also the sync key, so it must come out byte-for-byte
// the same as the web app's `new URL(...).toString()` for any URL a person
// would realistically subscribe to.

data class FeedAdditions(
    val added: List<Feed>,
    val alreadySubscribed: Int,
    val invalid: Int,
)

object Subscriptions {
    fun normalizeFeedUrl(raw: String): String? {
        val uri =
            try {
                URI(raw.trim())
            } catch (e: URISyntaxException) {
                return null
            }
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        val host =
            (uri.host ?: uri.rawAuthority?.substringAfterLast('@')?.substringBefore(':'))
                ?.lowercase()
                ?.ifEmpty { null } ?: return null

        return buildString {
            append(scheme).append("://")
            uri.rawUserInfo?.let { append(it).append('@') }
            append(host)
            val defaultPort = if (scheme == "https") 443 else 80
            if (uri.port != -1 && uri.port != defaultPort) append(':').append(uri.port)
            // Like the URL parser, an empty path is "/"; any other path is
            // kept exactly, since /feed and /feed/ can be different feeds.
            append(uri.rawPath.orEmpty().ifEmpty { "/" })
            uri.rawQuery?.let { append('?').append(it) }
        }
    }

    fun planAdditions(
        candidates: List<Feed>,
        existing: List<Feed>,
    ): FeedAdditions {
        val subscribed = existing.mapNotNull { normalizeFeedUrl(it.feedUrl) }.toSet()
        val added = mutableListOf<Feed>()
        val claimed = mutableSetOf<String>()
        var alreadySubscribed = 0
        var invalid = 0

        for (candidate in candidates) {
            val feedUrl = normalizeFeedUrl(candidate.feedUrl)
            when {
                feedUrl == null -> {
                    invalid++
                }

                feedUrl in subscribed || feedUrl in claimed -> {
                    alreadySubscribed++
                }

                else -> {
                    claimed += feedUrl
                    added += candidate.copy(feedUrl = feedUrl)
                }
            }
        }
        return FeedAdditions(added, alreadySubscribed, invalid)
    }

    fun describeImport(additions: FeedAdditions): String =
        buildList {
            val count = additions.added.size
            add("Imported $count feed${if (count == 1) "" else "s"}.")
            if (additions.alreadySubscribed > 0) add("${additions.alreadySubscribed} already subscribed.")
            if (additions.invalid > 0) add("${additions.invalid} skipped — not a valid URL.")
        }.joinToString(" ")
}
