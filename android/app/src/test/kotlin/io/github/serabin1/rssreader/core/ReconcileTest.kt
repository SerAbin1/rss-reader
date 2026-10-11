package io.github.serabin1.rssreader.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReconcileTest {
    private val curated = setOf("https://curated.com/f.xml")
    private fun live(url: String) = RemoteFeed(url, url, deleted = false)
    private fun dead(url: String) = RemoteFeed(url, url, deleted = true)

    @Test fun `pushes personal feeds the group has never seen`() {
        val push = Reconcile.planPush(
            personal = listOf(Feed("https://a.com/f.xml", "A"), Feed("https://b.com/f.xml", "B")),
            curatedUrls = curated,
            remote = listOf(live("https://a.com/f.xml")),
        )
        assertEquals(listOf(Feed("https://b.com/f.xml", "B")), push.additions)
    }

    @Test fun `does not re-add a feed another device removed`() {
        // The tombstone is the group saying "removed", which beats this
        // device's stale copy — re-adding it would undo the removal.
        val push = Reconcile.planPush(
            personal = listOf(Feed("https://a.com/f.xml", "A")),
            curatedUrls = curated,
            remote = listOf(dead("https://a.com/f.xml")),
        )
        assertTrue(push.isEmpty)
    }

    @Test fun `never pushes a curated feed as an addition`() {
        val push = Reconcile.planPush(
            personal = listOf(Feed("https://curated.com/f.xml", "C")),
            curatedUrls = curated,
            remote = emptyList(),
        )
        assertTrue(push.additions.isEmpty())
    }

    @Test fun `retracts a group feed that has since become curated`() {
        val push = Reconcile.planPush(emptyList(), curated, listOf(live("https://curated.com/f.xml")))
        assertEquals(listOf("https://curated.com/f.xml"), push.retractions)
    }

    @Test fun `an already-retracted curated feed isn't retracted again`() {
        assertTrue(Reconcile.planPush(emptyList(), curated, listOf(dead("https://curated.com/f.xml"))).isEmpty)
    }

    @Test fun `adopts the group's live feeds and deletes its tombstones`() {
        val result = Reconcile.applyGroup(
            listOf(live("https://a.com/f.xml"), dead("https://b.com/f.xml")),
            curated,
        )
        assertEquals(listOf(Feed("https://a.com/f.xml", "https://a.com/f.xml")), result.live)
        assertEquals(listOf("https://b.com/f.xml"), result.removed)
    }

    @Test fun `leaves curated feeds alone whatever the group says`() {
        val result = Reconcile.applyGroup(
            listOf(live("https://curated.com/f.xml"), dead("https://curated.com/f.xml")),
            curated,
        )
        assertTrue(result.live.isEmpty())
        assertTrue(result.removed.isEmpty())
    }
}
