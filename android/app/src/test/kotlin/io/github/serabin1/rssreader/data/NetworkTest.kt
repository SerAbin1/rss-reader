package io.github.serabin1.rssreader.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NetworkTest {
    @Test fun `spots an HTML page however it opens`() {
        assertTrue(looksLikeHtmlPage("<!DOCTYPE html><html></html>".toByteArray()))
        assertTrue(looksLikeHtmlPage("\n  <html><head></head></html>".toByteArray()))
    }

    @Test fun `leaves feeds alone`() {
        assertFalse(looksLikeHtmlPage("<?xml version=\"1.0\"?><rss></rss>".toByteArray()))
        assertFalse(looksLikeHtmlPage("<feed xmlns=\"http://www.w3.org/2005/Atom\"></feed>".toByteArray()))
    }
}
