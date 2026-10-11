package io.github.serabin1.rssreader.core

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeFormatterBuilder
import java.time.temporal.ChronoUnit
import java.util.Locale

// The watermark crosses the wire as an ISO 8601 string, and the server orders
// watermarks by comparing those strings as text. That's only sound if every
// device writes the exact shape JS's Date.toISOString() does — always three
// fractional digits, always "Z" — so it is fixed here rather than left to
// Instant.toString(), which drops the fraction when it is zero.
object IsoTimestamp {
    private val FORMAT = DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT)
        .withZone(ZoneOffset.UTC)

    fun format(epochMillis: Long): String = FORMAT.format(Instant.ofEpochMilli(epochMillis))

    fun parse(text: String): Long? = FeedDates.parse(text)
}

// Feed dates are famously loose — RFC 822 in RSS, RFC 3339 in Atom, and every
// variation feeds in the wild get wrong. The browser's Date parser is lenient
// about all of them; this tries the shapes it accepts, most common first.
object FeedDates {
    private fun pattern(p: String): DateTimeFormatter = DateTimeFormatterBuilder()
        .parseCaseInsensitive()
        .appendPattern(p)
        .toFormatter(Locale.ENGLISH)

    private val zoned = listOf(
        DateTimeFormatter.RFC_1123_DATE_TIME,
        pattern("[EEE, ]d MMM yyyy HH:mm[:ss] Z"),
        pattern("[EEE, ]d MMM yyyy HH:mm[:ss] z"),
        pattern("[EEE, ]d MMM yy HH:mm[:ss] Z"),
        pattern("[EEE, ]d MMM yy HH:mm[:ss] z"),
        DateTimeFormatter.ISO_OFFSET_DATE_TIME,
        DateTimeFormatter.ISO_ZONED_DATE_TIME,
    )

    fun parse(raw: String): Long? {
        val text = raw.trim().replace(Regex("\\s+"), " ")
        if (text.isEmpty()) return null

        for (formatter in zoned) {
            val instant = runCatching { ZonedDateTime.parse(text, formatter).toInstant() }.getOrNull()
                ?: runCatching { OffsetDateTime.parse(text, formatter).toInstant() }.getOrNull()
            if (instant != null) return instant.truncatedTo(ChronoUnit.MILLIS).toEpochMilli()
        }
        // No offset at all. JS reads a bare date as UTC midnight; a bare
        // date-time it reads as local, which would make the same post sort
        // differently on two devices — UTC for both keeps them identical.
        runCatching { LocalDateTime.parse(text, DateTimeFormatter.ISO_LOCAL_DATE_TIME) }.getOrNull()
            ?.let { return it.toInstant(ZoneOffset.UTC).truncatedTo(ChronoUnit.MILLIS).toEpochMilli() }
        runCatching { LocalDate.parse(text, DateTimeFormatter.ISO_LOCAL_DATE) }.getOrNull()
            ?.let { return it.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() }
        return null
    }
}
