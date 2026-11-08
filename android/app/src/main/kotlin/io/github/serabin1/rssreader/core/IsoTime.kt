package io.github.serabin1.rssreader.core

// ISO ↔ millis interop for the watermark. The watermark crosses the wire as
// the JS `Date.toISOString()` shape on every platform; the Android app keeps
// it in memory as epoch-millis Longs.
internal fun Long.toIso(): String = RssReaderCore.isoFromMillis(this)

// Invalid input maps to -1 at the crate boundary; the call sites decide
// whether that is an error or just "unknown".
internal fun String.toMillis(): Long = RssReaderCore.millisFromIso(this)

// JSON array literal of fixed-shape ISO strings — hand-built so no encoder
// allocation is needed per item on hot paths (list scroll).
internal fun isoDates(millis: List<Long>): String = buildString {
    append('[')
    millis.forEachIndexed { index, value ->
        if (index > 0) append(',')
        append('"').append(RssReaderCore.isoFromMillis(value)).append('"')
    }
    append(']')
}
