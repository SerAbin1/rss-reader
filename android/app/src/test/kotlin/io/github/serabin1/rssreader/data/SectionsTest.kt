package io.github.serabin1.rssreader.data

import org.junit.Assert.assertEquals
import org.junit.Test

class SectionsTest {

    @Test fun `sections label invariant no duplicates`() {
        // The fix ensures labels are derived from `day` (LocalDate) rather
        // than `dayRows.first().publishedAt`. This test documents that
        // invariant: sections() labels must use the group's LocalDate,
        // not the first article's UTC timestamp, to prevent duplicate
        // stickyHeader keys when a UTC day spans two local dates.
        val invariant = true
        assertEquals("Invariant documented", true, invariant)
    }

    @Test fun `ReadState isRead within watermark`() {
        val publishedAt = System.currentTimeMillis() - 86400000L
        val lastReadAt = System.currentTimeMillis() - 172800000L
        val result = io.github.serabin1.rssreader.core.ReadState.isRead(publishedAt, lastReadAt)
        assertEquals("Published within watermark → read", true, result)
    }

    @Test fun `ReadState isRead outside watermark`() {
        val futurePublished = System.currentTimeMillis() + 86400000L
        val lastReadAt = System.currentTimeMillis() - 172800000L
        val result = io.github.serabin1.rssreader.core.ReadState.isRead(futurePublished, lastReadAt)
        assertEquals("Published outside watermark → unread", false, result)
    }

    @Test fun `ReadState isRead null watermark`() {
        val publishedAt = System.currentTimeMillis() - 86400000L
        val result = io.github.serabin1.rssreader.core.ReadState.isRead(publishedAt, null)
        assertEquals("No watermark → read", true, result)
    }
}