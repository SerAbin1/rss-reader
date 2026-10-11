package io.github.serabin1.rssreader.core

import io.github.serabin1.rssreader.core.ReadState.findFirstUnreadIndex
import io.github.serabin1.rssreader.core.ReadState.isRead
import io.github.serabin1.rssreader.core.ReadState.watermarkAfterMarkUpTo
import io.github.serabin1.rssreader.core.ReadState.watermarkAfterOpen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Port of src/lib/read-state.test.ts and the client half of sync-state.test.ts.
class ReadStateTest {
    private val posts = listOf(1_000L, 2_000L, 3_000L)

    @Test fun `isRead`() {
        assertFalse(isRead(posts[0], null))
        assertTrue(isRead(posts[0], posts[0]))
        assertTrue(isRead(posts[0], posts[1]))
        assertFalse(isRead(posts[1], posts[0]))
    }

    @Test fun `findFirstUnreadIndex`() {
        assertEquals(0, findFirstUnreadIndex(posts, null))
        assertEquals(1, findFirstUnreadIndex(posts, posts[0]))
        assertEquals(-1, findFirstUnreadIndex(posts, posts[2]))
    }

    @Test fun `opening the next unread post advances the watermark`() {
        assertEquals(posts[0], watermarkAfterOpen(posts, null, 0))
        assertEquals(posts[1], watermarkAfterOpen(posts, posts[0], 1))
    }

    @Test fun `opening ahead of the next unread post does not`() =
        assertNull(watermarkAfterOpen(posts, null, 2))

    @Test fun `opening something already read does not`() =
        assertNull(watermarkAfterOpen(posts, posts[1], 0))

    @Test fun `mark up to here is forward-only`() {
        assertEquals(posts[1], watermarkAfterMarkUpTo(null, posts[1]))
        assertEquals(posts[2], watermarkAfterMarkUpTo(posts[0], posts[2]))
        assertNull(watermarkAfterMarkUpTo(posts[2], posts[0]))
        assertNull(watermarkAfterMarkUpTo(posts[1], posts[1]))
    }

    @Test fun `mergeWatermark is max, with null as nothing read`() {
        assertEquals(5L, SyncState.mergeWatermark(3L, 5L))
        assertEquals(5L, SyncState.mergeWatermark(5L, 3L))
        assertEquals(3L, SyncState.mergeWatermark(null, 3L))
        assertEquals(3L, SyncState.mergeWatermark(3L, null))
        assertNull(SyncState.mergeWatermark(null, null))
    }

    @Test fun `formatPairCode groups in fives`() =
        assertEquals("ABCDE-FGHJK", SyncState.formatPairCode("ABCDEFGHJK"))
}
