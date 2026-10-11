package io.github.serabin1.rssreader.core

import org.junit.Assert.assertEquals
import org.junit.Test

// Port of src/lib/feed-parser.test.ts, against the same fixture files.
class FeedParserTest {
    private fun fixture(name: String): String =
        javaClass.classLoader!!.getResource(name)!!.readText()

    private val rss = FeedParser.parse(fixture("sample-rss.xml"), "https://example.com/rss.xml")
    private val atom = FeedParser.parse(fixture("sample-atom.xml"), "https://example.org/atom.xml")

    @Test fun `RSS skips items missing required fields`() = assertEquals(2, rss.posts.size)

    @Test fun `RSS extracts title, link, guid and an ISO published date`() {
        val post = rss.posts[0]
        assertEquals("https://example.com/rss.xml", post.feedUrl)
        assertEquals("https://example.com/first-post", post.guid)
        assertEquals("First post", post.title)
        assertEquals("https://example.com/first-post", post.link)
        assertEquals("2026-08-24T09:00:00.000Z", IsoTimestamp.format(post.publishedAt))
    }

    @Test fun `RSS reads the channel's own link as the site URL`() =
        assertEquals("https://example.com/", rss.siteUrl)

    @Test fun `RSS reads the channel title, not an item's`() =
        assertEquals("Sample RSS Blog", rss.title)

    @Test fun `RSS uses the guid element even when it isn't a URL`() =
        assertEquals("urn:uuid:second-post", rss.posts[1].guid)

    @Test fun `Atom skips entries missing required fields`() = assertEquals(2, atom.posts.size)

    @Test fun `Atom prefers the rel=alternate link over rel=self`() =
        assertEquals("https://example.org/first-entry", atom.posts[0].link)

    @Test fun `Atom reads the feed-level rel=alternate link as the site URL`() =
        assertEquals("https://example.org/", atom.siteUrl)

    @Test fun `Atom reads the feed-level title, not an entry's`() =
        assertEquals("Sample Atom Blog", atom.title)

    @Test fun `Atom falls back to updated when published is absent`() =
        assertEquals("2026-08-25T09:00:00.000Z", IsoTimestamp.format(atom.posts[1].publishedAt))

    @Test(expected = FeedParseException::class)
    fun `throws on malformed XML`() {
        FeedParser.parse("<rss><channel", "https://example.com/rss.xml")
    }

    @Test(expected = FeedParseException::class)
    fun `throws on a document that's neither RSS nor Atom`() {
        FeedParser.parse("<html><body>not a feed</body></html>", "https://example.com/x")
    }

    @Test fun `atom-link inside an RSS channel isn't mistaken for the site link`() {
        val feed = FeedParser.parse(
            """<rss><channel>
              <atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="self" href="https://x.com/feed"/>
              <link>https://x.com/</link>
            </channel></rss>""",
            "https://x.com/feed",
        )
        assertEquals("https://x.com/", feed.siteUrl)
    }
}
