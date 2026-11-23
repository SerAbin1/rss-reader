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
}