package io.github.serabin1.rssreader.core

import io.github.serabin1.rssreader.core.Subscriptions.describeImport
import io.github.serabin1.rssreader.core.Subscriptions.normalizeFeedUrl
import io.github.serabin1.rssreader.core.Subscriptions.planAdditions
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

// Port of src/lib/subscriptions.test.ts.
class SubscriptionsTest {
    private fun feed(url: String, title: String = url) = Feed(url, title)

    @Test fun `keeps a plain feed URL as given`() =
        assertEquals("https://example.com/feed.xml", normalizeFeedUrl("https://example.com/feed.xml"))

    @Test fun `trims surrounding whitespace`() =
        assertEquals("https://example.com/feed.xml", normalizeFeedUrl("  https://example.com/feed.xml\n"))

    @Test fun `lowercases the host`() =
        assertEquals("https://example.com/feed.xml", normalizeFeedUrl("https://Example.COM/feed.xml"))

    @Test fun `drops the fragment`() =
        assertEquals("https://example.com/feed.xml", normalizeFeedUrl("https://example.com/feed.xml#comments"))

    @Test fun `preserves the path, including a trailing slash`() =
        assertNotEquals(normalizeFeedUrl("https://example.com/feed"), normalizeFeedUrl("https://example.com/feed/"))

    @Test fun `preserves the query string`() =
        assertEquals("https://example.com/blog?format=rss", normalizeFeedUrl("https://example.com/blog?format=rss"))

    @Test fun `rejects a URL with no scheme`() = assertNull(normalizeFeedUrl("example.com/feed.xml"))

    @Test fun `rejects schemes that can't be fetched`() {
        assertNull(normalizeFeedUrl("ftp://example.com/feed.xml"))
        assertNull(normalizeFeedUrl("javascript:alert(1)"))
    }

    @Test fun `rejects an empty string`() = assertNull(normalizeFeedUrl("   "))

    // Android-only: matching the URL parser's output, since this is the sync key.
    @Test fun `matches WHATWG URL serialization for the usual cases`() {
        assertEquals("https://example.com/", normalizeFeedUrl("https://example.com"))
        assertEquals("https://example.com/f", normalizeFeedUrl("HTTPS://example.com:443/f"))
        assertEquals("http://example.com:8080/f", normalizeFeedUrl("http://example.com:8080/f"))
    }

    @Test fun `adds a feed the device doesn't have`() {
        val result = planAdditions(listOf(feed("https://example.com/new.xml", "New")), listOf(feed("https://other.com/old.xml")))
        assertEquals(listOf(Feed("https://example.com/new.xml", "New")), result.added)
        assertEquals(0, result.alreadySubscribed)
    }

    @Test fun `adds nothing when re-importing a file it already has`() {
        val existing = listOf(feed("https://a.com/f.xml"), feed("https://b.com/f.xml"))
        val result = planAdditions(existing, existing)
        assertEquals(emptyList<Feed>(), result.added)
        assertEquals(2, result.alreadySubscribed)
    }

    @Test fun `recognises an existing feed written before normalization`() {
        val result = planAdditions(listOf(feed("https://example.com/f.xml")), listOf(feed("https://Example.com/f.xml#comments")))
        assertEquals(emptyList<Feed>(), result.added)
        assertEquals(1, result.alreadySubscribed)
    }

    @Test fun `stores the normalized URL for a new feed`() =
        assertEquals(
            listOf(Feed("https://example.com/f.xml", "https://Example.com/f.xml#x")),
            planAdditions(listOf(feed("https://Example.com/f.xml#x")), emptyList()).added,
        )

    @Test fun `adds only the genuinely new feeds from a partly-overlapping file`() {
        val result = planAdditions(
            listOf(feed("https://a.com/f.xml"), feed("https://new.com/f.xml", "New"), feed("https://b.com/f.xml")),
            listOf(feed("https://a.com/f.xml"), feed("https://b.com/f.xml")),
        )
        assertEquals(listOf(Feed("https://new.com/f.xml", "New")), result.added)
        assertEquals(2, result.alreadySubscribed)
    }

    @Test fun `adds a repeated feed in the same file only once`() {
        val result = planAdditions(listOf(feed("https://a.com/f.xml", "First"), feed("https://a.com/f.xml", "Second")), emptyList())
        assertEquals(listOf(Feed("https://a.com/f.xml", "First")), result.added)
        assertEquals(1, result.alreadySubscribed)
    }

    @Test fun `skips and counts candidates that aren't usable URLs`() {
        val result = planAdditions(listOf(feed("not a url"), feed("ftp://example.com/f.xml"), feed("https://a.com/f.xml")), emptyList())
        assertEquals(listOf(feed("https://a.com/f.xml")), result.added)
        assertEquals(2, result.invalid)
    }

    @Test fun `describeImport pluralizes and reports what it skipped`() {
        fun imported(n: Int) = describeImport(FeedAdditions(List(n) { feed("https://$it.com/f.xml") }, 0, 0))
        assertEquals("Imported 0 feeds.", imported(0))
        assertEquals("Imported 1 feed.", imported(1))
        assertEquals("Imported 48 feeds.", imported(48))
        assertEquals("Imported 0 feeds. 48 already subscribed.", describeImport(FeedAdditions(emptyList(), 48, 0)))
        assertEquals(
            "Imported 1 feed. 2 already subscribed. 1 skipped — not a valid URL.",
            describeImport(FeedAdditions(listOf(feed("https://a.com/f.xml")), 2, 1)),
        )
    }
}
