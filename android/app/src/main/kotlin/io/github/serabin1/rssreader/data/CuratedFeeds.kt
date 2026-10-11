package io.github.serabin1.rssreader.data

import android.content.Context
import android.util.Log
import io.github.serabin1.rssreader.core.Feed
import io.github.serabin1.rssreader.core.Opml
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File

// The curated list is the web app's public/curated-feeds.opml — one list for
// every client, changed by editing that file and deploying. Fetched fresh on
// every refresh so a deploy reaches the app without an app release; the last
// good copy, then the snapshot bundled at build time, cover being offline.
class CuratedFeeds(
    private val context: Context,
    private val client: OkHttpClient,
    private val origin: String,
) {
    private val cache = File(context.filesDir, "curated-feeds.opml")

    suspend fun load(): List<Feed> =
        withContext(Dispatchers.IO) {
            fetchLive()?.let { return@withContext it }
            parseOrNull(runCatching { cache.readText() }.getOrNull())
                ?: parseOrNull(runCatching { context.assets.open(ASSET).use { it.reader().readText() } }.getOrNull())
                ?: emptyList()
        }

    private fun fetchLive(): List<Feed>? =
        try {
            client.newCall(Request.Builder().url("$origin/$ASSET").build()).execute().use { response ->
                if (!response.isSuccessful) return null
                val text = response.body.string()
                parseOrNull(text)?.also { cache.writeText(text) }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Couldn't fetch the curated feed list", e)
            null
        }

    private fun parseOrNull(text: String?): List<Feed>? =
        text?.let { runCatching { Opml.parse(it) }.getOrNull() }?.takeIf { it.isNotEmpty() }

    private companion object {
        const val ASSET = "curated-feeds.opml"
        const val TAG = "CuratedFeeds"
    }
}
