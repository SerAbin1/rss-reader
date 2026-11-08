package io.github.serabin1.rssreader.core

// Port of the web app's relative dates — backed by the shared Rust crate.
// Relative inside the last week ("3h ago"); the full date beyond it, where
// "4w ago" only makes you do the arithmetic back. A future-dated post (a
// scheduled article, a feed with a wrong clock) gets the full date too rather
// than "in 3d".
object RelativeDate {
    // Note: the fallback is formatted "MMM d, yyyy" in the crate. The Android
    // app used to render it with the device locale (java.time MEDIUM style);
    // the shared implementation is locale-independent across platforms and
    // now matches the web app exactly.
    fun formatPostDate(
        publishedAt: Long,
        now: Long,
    ): String = RssReaderCore.formatPostDate(publishedAt.toIso(), now)

    fun formatFullDate(epochMillis: Long): String =
        RssReaderCore.formatFullDate(epochMillis.toIso())
}
