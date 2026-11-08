package io.github.serabin1.rssreader.core

import kotlinx.serialization.encodeToString

// Port of the web app's watermark and sync-merge logic — backed by the
// shared Rust crate via JNI (see RssReaderCore). The crate's unit tests cover
// the semantics; the wrappers exist so the data layer and UI call it the same
// way they did before.

// Watermark: a post is read when it was published at or before lastReadAt.
// On this side the watermark is epoch millis and the crate compares ISO
// strings between the two devices of a sync group; the wire is always the
// ISO shape.
object ReadState {
    fun isRead(
        publishedAt: Long,
        lastReadAt: Long?,
    ): Boolean = RssReaderCore.isRead(publishedAt.toIso(), lastReadAt?.toIso())

    // A post swiped back to unread stays unread in the UI even though the
    // watermark has moved past it — the watermark can't move back (sync
    // merges with max()), so the override is local state alongside it.
    fun isRead(
        publishedAt: Long,
        lastReadAt: Long?,
        overrideUnread: Boolean,
    ): Boolean = !overrideUnread && isRead(publishedAt, lastReadAt)

    // `posts` must be sorted ascending by publishedAt. -1 if everything is read.
    fun findFirstUnreadIndex(
        posts: List<Long>,
        lastReadAt: Long?,
    ): Int =
        RssReaderCore.findFirstUnreadIndexJson(isoDates(posts), lastReadAt?.toIso()).toInt()

    // The watermark only advances when the opened post is exactly the next
    // unread one in order; opening one further ahead reads just that post.
    fun watermarkAfterOpen(
        posts: List<Long>,
        lastReadAt: Long?,
        openedIndex: Int,
    ): Long? =
        RssReaderCore.watermarkAfterClickJson(isoDates(posts), lastReadAt?.toIso(), openedIndex.toLong())
            ?.let(RssReaderCore::millisFromIso)

    // Forward-only — a rewind would be discarded by sync's max() merge and
    // then silently vanish.
    fun watermarkAfterMarkUpTo(
        lastReadAt: Long?,
        publishedAt: Long,
    ): Long? =
        RssReaderCore.watermarkAfterMarkUpTo(lastReadAt?.toIso(), publishedAt.toIso())?.let(RssReaderCore::millisFromIso)
}

// Client half of the sync-state merge rules.
object SyncState {
    // The watermark is monotonic, so max() is the whole conflict story.
    fun mergeWatermark(
        a: Long?,
        b: Long?,
    ): Long? = RssReaderCore.mergeWatermark(a?.toIso(), b?.toIso())?.let(RssReaderCore::millisFromIso)

    // Displayed grouped (ABCDE-FGHJK) purely for legibility; the server
    // strips everything but letters and digits before hashing.
    fun formatPairCode(code: String): String = RssReaderCore.formatPairCode(code)
}
