package io.github.serabin1.rssreader.data

import io.github.serabin1.rssreader.BuildConfig
import io.github.serabin1.rssreader.core.FeedParseException
import io.github.serabin1.rssreader.core.FeedParser
import io.github.serabin1.rssreader.core.ParsedFeed
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit

fun httpClient(): OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(20, TimeUnit.SECONDS)
    .callTimeout(45, TimeUnit.SECONDS)
    // Some hosts refuse the default OkHttp agent outright.
    .addInterceptor { chain ->
        chain.proceed(
            chain.request().newBuilder()
                .header("User-Agent", "RssReader/${BuildConfig.VERSION_NAME} (Android)")
                .build(),
        )
    }
    .build()

class FeedFetchException(message: String, cause: Throwable? = null) : Exception(message, cause)

// Fetches feeds directly. The web app needs /api/feed only because browsers
// block cross-origin reads; an app has no such restriction, so going through
// the proxy would just add a hop and a dependency on the site being up.
class FeedFetcher(private val client: OkHttpClient) {
    suspend fun fetch(feedUrl: String): ParsedFeed = withContext(Dispatchers.IO) {
        val request = try {
            Request.Builder().url(feedUrl).build()
        } catch (e: IllegalArgumentException) {
            throw FeedFetchException("Invalid feed URL.", e)
        }
        try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw FeedFetchException("Feed responded with ${response.code}.")
                val bytes = response.body.bytes()
                // Same check as the web proxy: a 200 that's a web page, usually
                // a host's bot check, would otherwise read as "Invalid feed XML".
                if (looksLikeHtmlPage(bytes)) {
                    throw FeedFetchException("The site sent a web page (likely a bot check) instead of the feed.")
                }
                FeedParser.parse(bytes, feedUrl)
            }
        } catch (e: FeedParseException) {
            throw FeedFetchException(e.message ?: "Couldn't parse the feed.", e)
        } catch (e: UnknownHostException) {
            throw FeedFetchException("Couldn't reach the site.", e)
        } catch (e: SocketTimeoutException) {
            throw FeedFetchException("The site took too long to respond.", e)
        } catch (e: IOException) {
            throw FeedFetchException("Failed to fetch feed.", e)
        }
    }
}

// The body, not the Content-Type: plenty of real feeds are mislabelled
// text/html, but none of them start with an HTML document.
internal fun looksLikeHtmlPage(body: ByteArray): Boolean {
    val start = String(body, 0, minOf(body.size, 256), Charsets.UTF_8).trimStart().lowercase()
    return start.startsWith("<!doctype html") || start.startsWith("<html")
}
