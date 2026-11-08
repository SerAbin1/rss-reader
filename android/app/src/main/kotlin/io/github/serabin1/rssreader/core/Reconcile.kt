package io.github.serabin1.rssreader.core

import kotlinx.serialization.encodeToString

// The decisions in app.ts's reconcileFeeds, backed by the shared Rust crate.
// Two steps around one request: work out what to tell the group, then — given
// the group's answer — work out what to keep locally. The server owns the
// timestamps, so it alone decides last-write-wins; this device only reports
// what the group doesn't know.

data class RemoteFeed(
    val feedUrl: String,
    val title: String,
    val deleted: Boolean,
)

data class ReconcilePush(
    // Personal feeds the group has never heard of: adds made before pairing
    // or offline. A feed the group knows only as a tombstone is not one —
    // it was removed elsewhere, and is deleted here instead.
    val additions: List<Feed>,
    // Live in the group but curated now: retracted, or every paired device's
    // next pull would resurrect it as a personal feed.
    val retractions: List<String>,
) {
    val isEmpty get() = additions.isEmpty() && retractions.isEmpty()
}

data class ReconcileResult(
    val live: List<Feed>,
    val removed: List<String>,
)

object Reconcile {
    // `personal` — every live personal subscription on this device.
    // `curatedUrls` — the normalised URLs of the curated feeds.
    // `remote` — the feeds the group knows about, live or tombstoned.
    fun planPush(
        personal: List<Feed>,
        curatedUrls: Set<String>,
        remote: List<RemoteFeed>,
    ): ReconcilePush {
        val json = RssReaderCore.planPushJson(
            Wire.json.encodeToString(personal.map { Wire.Feed(it.feedUrl, it.title, it.siteUrl) }),
            Wire.json.encodeToString(curatedUrls.toList()),
            Wire.json.encodeToString(remote.map { Wire.RemoteFeed(it.feedUrl, it.title, it.deleted) }),
        )
        val wire = Wire.json.decodeFromString<Wire.ReconcilePush>(json)
        return ReconcilePush(
            additions = wire.additions.map { Feed(it.feedUrl, it.title, it.siteUrl) },
            retractions = wire.retractions,
        )
    }

    // Curated feeds are never touched by the group: they're kept whatever the
    // group says, and never adopted as personal.
    fun applyGroup(
        group: List<RemoteFeed>,
        curatedUrls: Set<String>,
    ): ReconcileResult {
        val json = RssReaderCore.applyGroupJson(
            Wire.json.encodeToString(group.map { Wire.RemoteFeed(it.feedUrl, it.title, it.deleted) }),
            Wire.json.encodeToString(curatedUrls.toList()),
        )
        val wire = Wire.json.decodeFromString<Wire.ReconcileResult>(json)
        return ReconcileResult(
            live = wire.live.map { Feed(it.feedUrl, it.title, it.siteUrl) },
            removed = wire.removed,
        )
    }
}
