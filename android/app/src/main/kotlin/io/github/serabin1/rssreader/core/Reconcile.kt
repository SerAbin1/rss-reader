package io.github.serabin1.rssreader.core

// The decisions in app.ts's reconcileFeeds, split out from the network and
// database calls so they can be tested alone. Two steps around one request:
// work out what to tell the group, then — given the group's answer — work out
// what to keep locally. The server owns the timestamps, so it alone decides
// last-write-wins; this device only reports what the group doesn't know.

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
    fun planPush(
        personal: List<Feed>,
        curatedUrls: Set<String>,
        remote: List<RemoteFeed>,
    ): ReconcilePush {
        val remoteUrls = remote.map { it.feedUrl }.toSet()
        return ReconcilePush(
            additions =
                personal
                    .filter { it.feedUrl !in remoteUrls && it.feedUrl !in curatedUrls }
                    .map { Feed(it.feedUrl, it.title) },
            retractions = remote.filter { !it.deleted && it.feedUrl in curatedUrls }.map { it.feedUrl },
        )
    }

    // Curated feeds are never touched by the group: they're kept whatever the
    // group says, and never adopted as personal.
    fun applyGroup(
        group: List<RemoteFeed>,
        curatedUrls: Set<String>,
    ): ReconcileResult =
        ReconcileResult(
            live = group.filter { !it.deleted && it.feedUrl !in curatedUrls }.map { Feed(it.feedUrl, it.title) },
            removed = group.filter { it.deleted && it.feedUrl !in curatedUrls }.map { it.feedUrl },
        )
}
