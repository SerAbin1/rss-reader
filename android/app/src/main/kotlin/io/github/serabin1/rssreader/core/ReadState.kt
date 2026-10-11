package io.github.serabin1.rssreader.core

// Port of src/lib/read-state.ts. One watermark, no per-post state: a post is
// read when it was published at or before lastReadAt. Timestamps are epoch
// milliseconds here rather than ISO strings, which compare the same way.
object ReadState {
    fun isRead(
        publishedAt: Long,
        lastReadAt: Long?,
    ): Boolean = lastReadAt != null && publishedAt <= lastReadAt

    // `posts` must be sorted ascending by publishedAt. -1 if everything is read.
    fun findFirstUnreadIndex(
        posts: List<Long>,
        lastReadAt: Long?,
    ): Int = posts.indexOfFirst { !isRead(it, lastReadAt) }

    // The watermark only advances when the opened post is exactly the next
    // unread one in order; opening one further ahead reads just that post.
    fun watermarkAfterOpen(
        posts: List<Long>,
        lastReadAt: Long?,
        openedIndex: Int,
    ): Long? = if (openedIndex != findFirstUnreadIndex(posts, lastReadAt)) null else posts[openedIndex]

    // Forward-only — a rewind would be discarded by sync's max() merge and
    // then silently vanish. Null if it wouldn't advance.
    fun watermarkAfterMarkUpTo(
        lastReadAt: Long?,
        publishedAt: Long,
    ): Long? = if (lastReadAt != null && publishedAt <= lastReadAt) null else publishedAt
}

// Client half of src/lib/sync-state.ts.
object SyncState {
    // The watermark is monotonic, so max() is the whole conflict story.
    fun mergeWatermark(
        a: Long?,
        b: Long?,
    ): Long? =
        when {
            a == null -> b
            b == null -> a
            else -> maxOf(a, b)
        }

    // Displayed grouped (ABCDE-FGHJK) purely for legibility; the server
    // strips everything but letters and digits before hashing.
    fun formatPairCode(code: String): String = "${code.take(5)}-${code.drop(5)}"
}
