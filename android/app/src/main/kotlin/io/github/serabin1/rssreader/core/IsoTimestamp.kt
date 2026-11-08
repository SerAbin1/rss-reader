package io.github.serabin1.rssreader.core

// ISO 8601 in the exact shape JS's Date.toISOString() writes — the shape both
// the server and the web app compare as text (always three fractional
// digits, always Z). Both functions run in the shared Rust crate, so a
// watermark written here and read there is byte-identical.
object IsoTimestamp {
    fun format(epochMillis: Long): String = RssReaderCore.isoFromMillis(epochMillis)

    // The crate accepts both RFC 3339/RFC 1123 and the localized variants the
    // way it accepts them everywhere — returns null when the string is not a
    // timestamp at all.
    fun parse(text: String): Long? =
        if (RssReaderCore.millisFromIso(text) >= 0) RssReaderCore.millisFromIso(text) else null
}
