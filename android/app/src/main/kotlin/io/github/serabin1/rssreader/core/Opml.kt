package io.github.serabin1.rssreader.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// Port of the web app's OPML parse/write — backed by the shared Rust crate via
// JNI, so imports/exports behave identically on every platform.

class OpmlParseException(
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause)

object Opml {
    // Flattens outlines at any nesting depth. A malformed document throws.
    fun parse(text: String): List<Feed> {
        val json = RssReaderCore.parseOpmlJson(text)
        val element = runCatching { Wire.json.parseToJsonElement(json) }.getOrElse {
            throw OpmlParseException("Invalid OPML file", it)
        }
        // The crate reports errors as a {"error": "..."} envelope.
        (element as? kotlinx.serialization.json.JsonObject)?.get("error")?.let {
            throw OpmlParseException(it.jsonPrimitive.content)
        }
        return element.jsonArray
            .map { item -> Wire.json.decodeFromString<Wire.Feed>(item.toString()) }
            .map { Feed(it.feedUrl, it.title, it.siteUrl) }
    }

    // htmlUrl is written only when the feed's own homepage is known, and never
    // as a copy of xmlUrl — the exporter habit that links readers at raw XML.
    fun write(
        feeds: List<Feed>,
        title: String,
    ): String =
        RssReaderCore.writeOpml(
            Wire.json.encodeToString(feeds.map { Wire.Feed(it.feedUrl, it.title, it.siteUrl) }),
            title,
        )
}
