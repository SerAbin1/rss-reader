package io.github.serabin1.rssreader.data

import io.github.serabin1.rssreader.core.Feed
import io.github.serabin1.rssreader.core.IsoTimestamp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

class SyncException(message: String, val status: Int) : Exception(message)

// Server-stamped timestamps; deletedAt non-null is a tombstone. See
// src/lib/sync-state.ts for the merge rules these feed.
@Serializable
data class SyncedFeed(
    val feedUrl: String,
    val title: String,
    val updatedAt: Long,
    val deletedAt: Long? = null,
)

@Serializable
data class PairResponse(
    val groupId: String,
    val pairCode: String,
    val expiresAt: Long,
    // Present only when this call created a brand-new group.
    val deviceToken: String? = null,
)

@Serializable private data class WatermarkBody(val lastReadAt: String? = null)
@Serializable private data class FeedsBody(val feeds: List<SyncedFeed>)
@Serializable private data class FeedChange(val feedUrl: String, val title: String? = null, val deleted: Boolean? = null)
@Serializable private data class FeedChangesBody(val feeds: List<FeedChange>)
@Serializable private data class ClaimBody(val code: String)
@Serializable private data class ClaimResponse(val deviceToken: String? = null)
@Serializable private data class ErrorBody(val error: String? = null)

// Port of src/lib/sync-client.ts against the web app's /api/sync endpoints.
// The watermark is epoch millis on this side and an ISO string on the wire.
class SyncApi(private val client: OkHttpClient, private val origin: String) {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }
    private val jsonType = "application/json".toMediaType()

    suspend fun pullWatermark(token: String): Long? =
        call<WatermarkBody>("state", token).lastReadAt?.let(IsoTimestamp::parse)

    // Returns the value that actually won: the server applies max(), so a
    // push carrying a lower watermark comes back with the stored higher one.
    suspend fun pushWatermark(token: String, lastReadAt: Long): Long? =
        call<WatermarkBody>("state", token, json.encodeToString(WatermarkBody(IsoTimestamp.format(lastReadAt))))
            .lastReadAt?.let(IsoTimestamp::parse)

    suspend fun pullFeeds(token: String): List<SyncedFeed> = call<FeedsBody>("feeds", token).feeds

    // Explicit additions and removals, never the whole local list — the
    // server stamps every change with its own clock, so a replayed full set
    // would outrank and undo the group's deletions.
    suspend fun pushFeedChanges(token: String, added: List<Feed>, removed: List<String>): List<SyncedFeed> {
        val changes = added.map { FeedChange(it.feedUrl, it.title) } + removed.map { FeedChange(it, deleted = true) }
        return call<FeedsBody>("feeds", token, json.encodeToString(FeedChangesBody(changes))).feeds
    }

    // The token is optional here: pairing is how a device gets one. With none,
    // the server creates a group seeded with this device's watermark.
    suspend fun startPairing(token: String?, lastReadAt: Long?): PairResponse =
        call("pair", token, json.encodeToString(WatermarkBody(lastReadAt?.let(IsoTimestamp::format))))

    // Unauthenticated by design — the code is the credential, spent by this call.
    suspend fun claim(code: String): String =
        call<ClaimResponse>("claim", token = null, body = json.encodeToString(ClaimBody(code))).deviceToken
            ?: throw SyncException("sync/claim returned no token", 500)

    private suspend inline fun <reified T> call(path: String, token: String?, body: String? = null): T =
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url("$origin/api/sync/$path")
                .apply { if (token != null) header("Authorization", "Bearer $token") }
                .apply { if (body != null) post(body.toRequestBody(jsonType)) }
                .build()
            val text = try {
                client.newCall(request).execute().use { response ->
                    val text = response.body.string()
                    if (!response.isSuccessful) {
                        val message = runCatching { json.decodeFromString<ErrorBody>(text).error }.getOrNull()
                        throw SyncException(message ?: "sync/$path failed (${response.code})", response.code)
                    }
                    text
                }
            } catch (e: IOException) {
                throw SyncException("Couldn't reach the sync server.", 0)
            }
            json.decodeFromString<T>(text)
        }
}
