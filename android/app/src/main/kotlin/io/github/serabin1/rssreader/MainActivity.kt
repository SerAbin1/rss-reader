package io.github.serabin1.rssreader

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
        setContent {
            ReaderTheme {
                // Null for the moment it takes DataStore to answer; drawing
                // Home first and then jumping would flash the wrong page.
                val start by startScreen.collectAsStateWithLifecycle(initialValue = null)
                Surface(Modifier.fillMaxSize()) {
                    start?.let { ReaderNavHost(it) }
                }
            }
        }
    }
}
