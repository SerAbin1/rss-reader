package io.github.serabin1.rssreader.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationsTest {

    @Test fun `all notifications overrides each feed switch but leaves per feed control`() {
        assertTrue(shouldNotify(RefreshSettings(notifyAll = true), feedNotify = false))
        assertTrue(shouldNotify(RefreshSettings(notifyAll = true), feedNotify = true))
        assertFalse(shouldNotify(RefreshSettings(), feedNotify = false))
        assertTrue(shouldNotify(RefreshSettings(), feedNotify = true))
    }

    @Test fun `disable all notifications wins without changing feed switches`() {
        assertFalse(
            shouldNotify(
                RefreshSettings(disableAllNotifications = true, notifyAll = true),
                feedNotify = true,
            ),
        )
        assertFalse(shouldNotify(RefreshSettings(disableAllNotifications = true), feedNotify = true))
        assertTrue(
            shouldNotify(
                RefreshSettings(disableAllNotifications = false, notifyAll = true),
                feedNotify = false,
            ),
        )
    }

    @Test fun `notification settings default to per feed`() {
        assertFalse(RefreshSettings().notifyAll)
        assertFalse(RefreshSettings().disableAllNotifications)
    }
}
