package io.github.serabin1.rssreader.core

import io.github.serabin1.rssreader.core.Xml.attr
import org.w3c.dom.Element

class OpmlParseException(message: String, cause: Throwable? = null) : Exception(message, cause)

object Opml {
    // Port of src/lib/opml.ts: matches outlines at any nesting depth, so
    // folders/categories are flattened.
    fun parse(text: String): List<Feed> {
        val doc = try {
            Xml.parse(text)
        } catch (e: Exception) {
            throw OpmlParseException("Invalid OPML file", e)
        }
        val outlines = doc.getElementsByTagName("outline")
        return (0 until outlines.length).mapNotNull { i ->
            val outline = outlines.item(i) as Element
            val feedUrl = outline.attr("xmlUrl")?.ifEmpty { null } ?: return@mapNotNull null
            val title = outline.attr("title") ?: outline.attr("text") ?: feedUrl
            Feed(feedUrl, title)
        }
    }

    // htmlUrl is written only when the feed's own homepage is known, and never
    // as a copy of xmlUrl — the exporter habit FeedParser's comment complains
    // about.
    fun write(feeds: List<Feed>, title: String): String = buildString {
        append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
        append("<opml version=\"2.0\">\n")
        append("  <head>\n    <title>").append(escape(title)).append("</title>\n  </head>\n")
        append("  <body>\n")
        for (feed in feeds) {
            append("    <outline type=\"rss\"")
            append(" text=\"").append(escape(feed.title)).append('"')
            append(" title=\"").append(escape(feed.title)).append('"')
            append(" xmlUrl=\"").append(escape(feed.feedUrl)).append('"')
            feed.siteUrl?.let { append(" htmlUrl=\"").append(escape(it)).append('"') }
            append(" />\n")
        }
        append("  </body>\n</opml>\n")
    }

    private fun escape(value: String): String = value
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
}
