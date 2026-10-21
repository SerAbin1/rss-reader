package io.github.serabin1.rssreader

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import io.github.serabin1.rssreader.data.StartScreen
import io.github.serabin1.rssreader.ui.ReaderNavHost
import io.github.serabin1.rssreader.ui.theme.ReaderTheme
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // A launch clears the posts read last time, then refreshes like every
        // visit to the site does, unless that's turned off in Settings.
        if (savedInstanceState == null) {
            val container = (application as RssApp).container
            lifecycleScope.launch {
                container.reader.prune()
                if (container.prefs.refreshSettings().onOpen) container.reader.refresh()
            }
        }
        val startScreen = (application as RssApp).container.reader.startScreen
        val openUnread = intent.getBooleanExtra(EXTRA_OPEN_UNREAD, false)
        setContent {
            ReaderTheme {
                // Null for the moment it takes DataStore to answer; drawing
                // Home first and then jumping would flash the wrong page.
                val start by startScreen.collectAsStateWithLifecycle(initialValue = null)
                Surface(Modifier.fillMaxSize()) {
                    start?.let { ReaderNavHost(if (openUnread) StartScreen.Unread else it) }
                }
            }
        }
    }

    companion object {
        private const val EXTRA_OPEN_UNREAD = "openUnread"

        // A notification's tap. A fresh task, so it lands like a launch with
        // Unread as the start screen: Unread on top of Home, refreshed.
        fun openUnread(context: Context): Intent =
            Intent(context, MainActivity::class.java)
                .putExtra(EXTRA_OPEN_UNREAD, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
    }
}
