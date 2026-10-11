package io.github.serabin1.rssreader.core

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

// Port of src/lib/relative-date.ts: relative inside the last week, the full
// date beyond it or for anything dated in the future.
object RelativeDate {
    private const val MINUTE = 60_000L
    private const val HOUR = 60 * MINUTE
    private const val DAY = 24 * HOUR
    private const val WEEK = 7 * DAY

    fun formatPostDate(
        publishedAt: Long,
        now: Long,
        zone: ZoneId = ZoneId.systemDefault(),
        locale: Locale = Locale.getDefault(),
    ): String {
        val elapsed = now - publishedAt
        if (elapsed in 0 until WEEK) {
            return when {
                elapsed < MINUTE -> "just now"
                elapsed < HOUR -> "${elapsed / MINUTE}m ago"
                elapsed < DAY -> "${elapsed / HOUR}h ago"
                else -> "${elapsed / DAY}d ago"
            }
        }
        return formatFullDate(publishedAt, zone, locale)
    }

    fun formatFullDate(
        epochMillis: Long,
        zone: ZoneId = ZoneId.systemDefault(),
        locale: Locale = Locale.getDefault(),
    ): String = fullDateFormatter(zone, locale).format(Instant.ofEpochMilli(epochMillis))

    // Building a localized formatter is far costlier than using one, and a
    // long list formats hundreds of dates — so the last one is kept.
    @Volatile private var cached: Triple<ZoneId, Locale, DateTimeFormatter>? = null

    private fun fullDateFormatter(zone: ZoneId, locale: Locale): DateTimeFormatter {
        cached?.let { (z, l, f) -> if (z == zone && l == locale) return f }
        return DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale).withZone(zone)
            .also { cached = Triple(zone, locale, it) }
    }
}
