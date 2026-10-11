package io.github.serabin1.rssreader.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FeedDatesTest {
    private fun iso(text: String) = FeedDates.parse(text)?.let(IsoTimestamp::format)

    @Test fun `RFC 822 variants feeds actually publish`() {
        val expected = "2026-08-24T09:00:00.000Z"
        assertEquals(expected, iso("Mon, 24 Aug 2026 09:00:00 GMT"))
        assertEquals(expected, iso("Mon, 24 Aug 2026 09:00:00 +0000"))
        assertEquals(expected, iso("24 Aug 2026 09:00:00 GMT"))
        assertEquals(expected, iso("Mon, 24 Aug 2026 09:00 GMT"))
        assertEquals(expected, iso("Mon, 24 Aug 2026 05:00:00 -0400"))
        assertEquals(expected, iso("  Mon,  24 Aug 2026 09:00:00 GMT\n"))
        assertEquals(expected, iso("mon, 24 aug 2026 09:00:00 gmt"))
    }

    @Test fun `RFC 3339 variants`() {
        assertEquals("2026-08-24T09:00:00.000Z", iso("2026-08-24T09:00:00Z"))
        assertEquals("2026-08-24T09:00:00.000Z", iso("2026-08-24T10:00:00+01:00"))
        // Truncated to the millisecond, as a JS Date would be.
        assertEquals("2026-08-24T09:00:00.123Z", iso("2026-08-24T09:00:00.123456Z"))
        assertEquals("2026-08-24T00:00:00.000Z", iso("2026-08-24"))
    }

    @Test fun `garbage is null, not a crash`() {
        assertNull(FeedDates.parse("yesterday"))
        assertNull(FeedDates.parse(""))
    }

    @Test fun `IsoTimestamp always writes three fractional digits`() {
        // Instant.toString() would write "2026-08-24T09:00:00Z", which sorts
        // *after* "2026-08-24T09:00:00.500Z" as text — the server's ordering.
        assertEquals("2026-08-24T09:00:00.000Z", IsoTimestamp.format(1787562000000))
    }
}
