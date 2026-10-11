package io.github.serabin1.rssreader.core

import io.github.serabin1.rssreader.core.Xml.attr
import io.github.serabin1.rssreader.core.Xml.child
import io.github.serabin1.rssreader.core.Xml.childElements
import io.github.serabin1.rssreader.core.Xml.childText
import org.w3c.dom.Document
import org.w3c.dom.Element

class FeedParseException(message: String, cause: Throwable? = null) : Exception(message, cause)

// Port of the web app's src/lib/feed-parser.ts. What counts as a post is kept
// identical — the same required fields, the same date fallbacks — because the
// watermark is shared: a post one client shows and the other silently drops
// would make "read up to here" mean different things on each device.
object FeedParser {
    fun parse(bytes: ByteArray, feedUrl: String): ParsedFeed =
        parse(feedUrl) { Xml.parse(bytes) }

    fun parse(text: String, feedUrl: String): ParsedFeed =
        parse(feedUrl) { Xml.parse(text) }

    private fun parse(feedUrl: String, load: () -> Document): ParsedFeed {
        val doc = try {
            load()
        } catch (e: Exception) {
            throw FeedParseException("Invalid feed XML", e)
        }
        val root = doc.documentElement
        return when (root?.localName) {
            "rss" -> parseRss(root, feedUrl)
            "feed" -> parseAtom(root, feedUrl)
            else -> throw FeedParseException("Unrecognized feed format (not RSS or Atom)")
        }
    }

    private fun parseRss(root: Element, feedUrl: String): ParsedFeed {
        val channel = root.child("channel")
            ?: return ParsedFeed(title = null, siteUrl = null, posts = emptyList())

        val posts = channel.childElements().filter { it.localName == "item" }.mapNotNull { item ->
            val title = item.childText("title") ?: return@mapNotNull null
            val link = item.childText("link") ?: return@mapNotNull null
            val guid = item.childText("guid") ?: link
            val publishedAt = item.childText("pubDate")?.let(FeedDates::parse) ?: return@mapNotNull null
            Post(feedUrl, guid, title, link, publishedAt)
        }.toList()

        // No fallback (e.g. the feed URL's origin) when a feed declares no
        // link: a guessed origin is wrong for anything served off an
        // aggregator's domain, and a missing link is better than a wrong one.
        return ParsedFeed(
            title = channel.childText("title"),
            siteUrl = channel.childText("link"),
            posts = posts,
        )
    }

    // Namespaced lookups use the root's own namespace rather than assuming
    // Atom's, so a feed that forgot its xmlns still parses.
    private fun parseAtom(root: Element, feedUrl: String): ParsedFeed {
        val ns = root.namespaceURI
        val posts = root.childElements().filter { it.localName == "entry" }.mapNotNull { entry ->
            val title = entry.childText("title", ns) ?: return@mapNotNull null
            val link = alternateLink(entry, ns) ?: return@mapNotNull null
            val guid = entry.childText("id", ns) ?: link
            val dateText = entry.childText("published", ns) ?: entry.childText("updated", ns)
            val publishedAt = dateText?.let(FeedDates::parse) ?: return@mapNotNull null
            Post(feedUrl, guid, title, link, publishedAt)
        }.toList()

        return ParsedFeed(
            title = root.childText("title", ns),
            siteUrl = alternateLink(root, ns),
            posts = posts,
        )
    }

    // Atom entries can carry several <link> elements (self, alternate, ...);
    // the article URL is the one with rel="alternate", or no rel at all (the
    // spec default). Direct children only, so a feed's own link never picks
    // up an entry's.
    private fun alternateLink(element: Element, ns: String?): String? =
        element.childElements()
            .filter { it.localName == "link" && it.namespaceURI == ns }
            .firstOrNull { it.attr("rel").let { rel -> rel.isNullOrEmpty() || rel == "alternate" } }
            ?.attr("href")?.trim()?.ifEmpty { null }
}
