package io.github.serabin1.rssreader.core

import io.github.serabin1.rssreader.core.RelativeDate.formatFullDate
import io.github.serabin1.rssreader.core.RelativeDate.formatPostDate
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.ZoneOffset
import java.util.Locale

// Port of src/lib/relative-date.test.ts.
class RelativeDateTest {
    private val now = FeedDates.parse("2026-10-03T12:00:00.000Z")!!
    private fun format(ago: Long) = formatPostDate(now - ago, now, ZoneOffset.UTC, Locale.US)
    private fun full(at: Long) = formatFullDate(at, ZoneOffset.UTC, Locale.US)

    @Test fun `just now under a minute`() = assertEquals("just now", format(30_000))

    @Test fun `minutes, hours and days within a week`() {
        assertEquals("5m ago", format(5 * 60_000L))
        assertEquals("3h ago", format(3 * 3_600_000L))
        assertEquals("6d ago", format(6 * 86_400_000L))
    }

    @Test fun `rounds down`() = assertEquals("59m ago", format(59 * 60_000L + 59_000))

    @Test fun `full date from a week on`() = assertEquals(full(now - 7 * 86_400_000L), format(7 * 86_400_000L))

    @Test fun `full date for a post dated in the future`() {
        val future = FeedDates.parse("2026-10-05T00:00:00.000Z")!!
        assertEquals(full(future), formatPostDate(future, now, ZoneOffset.UTC, Locale.US))
    }
}
