package io.github.serabin1.rssreader.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Port of src/lib/opml.test.ts.
class OpmlTest {
    private val feeds = Opml.parse(javaClass.classLoader!!.getResource("sample.opml")!!.readText())

    @Test fun `flattens every feed out of nested folders`() = assertEquals(48, feeds.size)

    @Test fun `extracts feedUrl and title`() =
        assertTrue(Feed("https://jvns.ca/atom.xml", "Julia Evans") in feeds)

    @Test fun `skips folder outlines with no xmlUrl`() =
        assertFalse(feeds.any { it.title == "Films" })

    @Test(expected = OpmlParseException::class)
    fun `throws on malformed XML`() {
        Opml.parse("<opml><body><outline")
    }

    @Test fun `round-trips through write, escaping and all`() {
        val original = listOf(
            Feed("https://a.com/f.xml?x=1&y=2", "Tom & \"Jerry\" <3", "https://a.com/"),
            Feed("https://b.com/f.xml", "B"),
        )
        val reparsed = Opml.parse(Opml.write(original, "Export"))
        assertEquals(original.map { it.copy(siteUrl = null) }, reparsed)
    }
}
