package io.github.serabin1.rssreader.core

import kotlinx.serialization.encodeToString

// Port of the web app's subscription planning — backed by the shared Rust
// crate. The normalised URL is also the sync key, so every device agrees on
// what "the same feed" means byte-for-byte.
object Subscriptions {
    fun normalizeFeedUrl(raw: String): String? = RssReaderCore.normalizeFeedUrl(raw)

    // Purely additive by construction: an already-subscribed candidate is
    // never returned in `added`, so callers save exactly the new feeds and no
    // existing record is rewritten.
    fun planAdditions(
        candidates: List<Feed>,
        existing: List<Feed>,
    ): FeedAdditions {
        val json = RssReaderCore.planAdditionsJson(
            Wire.json.encodeToString(candidates.map { Wire.Feed(it.feedUrl, it.title, it.siteUrl) }),
            Wire.json.encodeToString(existing.map { Wire.Feed(it.feedUrl, it.title, it.siteUrl) }),
        )
        val wire = Wire.json.decodeFromString<Wire.FeedAdditions>(json)
        return FeedAdditions(
            added = wire.added.map { Feed(it.feedUrl, it.title, it.siteUrl) },
            alreadySubscribed = wire.alreadySubscribed,
            invalid = wire.invalid,
        )
    }

    // The single line of feedback an import produces, with the counts of what
    // it skipped — a re-import of a file the device already has has to say
    // whether "0 feeds" was correct or broken.
    fun describeImport(additions: FeedAdditions): String =
        RssReaderCore.describeImport(
            Wire.json.encodeToString(
                Wire.FeedAdditions(
                    added = additions.added.map { Wire.Feed(it.feedUrl, it.title, it.siteUrl) },
                    alreadySubscribed = additions.alreadySubscribed,
                    invalid = additions.invalid,
                ),
            ),
        )
}
