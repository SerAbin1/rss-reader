package io.github.serabin1.rssreader.core

// Loading the shared Rust crate ("rss-reader-core"). Built by the
// `cargoBuildRssReaderCore` Gradle task into jniLibs, so every function matches
// the web app's WASM build one-to-one — same semantics, same tests.
//
// Wire format across the boundary is JSON strings for structured values and
// scalars for the rest; the crate's serde output and this file's DTOs are
// aligned byte-for-byte (see Wire.kt).
object RssReaderCore {
    init {
        System.loadLibrary("rss_reader_core")
    }

    @JvmStatic external fun parseFeedJson(xmlText: String, feedUrl: String): String
    @JvmStatic external fun parseOpmlJson(xmlText: String): String
    @JvmStatic external fun writeOpml(feedsJson: String, title: String): String
    @JvmStatic external fun normalizeFeedUrl(raw: String): String?
    @JvmStatic external fun planAdditionsJson(candidatesJson: String, existingJson: String): String
    @JvmStatic external fun describeImport(additionsJson: String): String
    @JvmStatic external fun isRead(publishedAtIso: String, lastReadAtIso: String?): Boolean
    // Returns -1 when everything is read (mirrors the TS -1 sentinel).
    @JvmStatic external fun findFirstUnreadIndexJson(datesJson: String, lastReadAtIso: String?): Long
    @JvmStatic external fun watermarkAfterClickJson(datesJson: String, lastReadAtIso: String?, clickedIndex: Long): String?
    @JvmStatic external fun watermarkAfterMarkUpTo(lastReadAtIso: String?, publishedAtIso: String): String?
    @JvmStatic external fun isListed(publishedAtIso: String, listedAfterIso: String?): Boolean
    @JvmStatic external fun favouriteKey(feedUrl: String, guid: String): String
    @JvmStatic external fun mergeWatermark(aIso: String?, bIso: String?): String?
    @JvmStatic external fun isPairCodeUsableJson(codeJson: String, now: Long): Boolean
    @JvmStatic external fun formatPairCode(code: String): String
    @JvmStatic external fun mergeFeedsJson(aJson: String, bJson: String): String
    @JvmStatic external fun liveFeedsJson(feedsJson: String): String
    @JvmStatic external fun planPushJson(personalJson: String, curatedUrlsJson: String, remoteJson: String): String
    @JvmStatic external fun applyGroupJson(groupJson: String, curatedUrlsJson: String): String
    @JvmStatic external fun formatPostDate(publishedAtIso: String, nowMillis: Long): String
    @JvmStatic external fun formatFullDate(publishedAtIso: String): String

    // The watermark is ISO Zulu strings on this side, fixed three-fraction
    // digits — the shape both the server and the web app compare as text.
    @JvmStatic external fun isoFromMillis(millis: Long): String
    @JvmStatic external fun millisFromIso(iso: String): Long
}
