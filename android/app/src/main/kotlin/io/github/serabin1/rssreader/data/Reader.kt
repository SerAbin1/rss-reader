package io.github.serabin1.rssreader.data

import android.util.Log
import io.github.serabin1.rssreader.core.Feed
import io.github.serabin1.rssreader.core.Opml
import io.github.serabin1.rssreader.core.Post
import io.github.serabin1.rssreader.core.ReadState
import io.github.serabin1.rssreader.core.Reconcile
import io.github.serabin1.rssreader.core.RemoteFeed
import io.github.serabin1.rssreader.core.Subscriptions
import io.github.serabin1.rssreader.core.SyncState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

data class RefreshProgress(val settled: Int, val total: Int)

// What the app does, minus how it looks: the Android counterpart of the web
// app's src/scripts/app.ts. Local state is authoritative and saved first;
// sync is best-effort on top, with the same rules — server-owned feed
// membership, a max()-merged watermark, and no push from a degraded load
// without asking.
//
// One difference: the web app keeps no posts, while this app keeps a list of
// the unread ones (title and link only), so what a background refresh found
// is on screen at launch. Read posts stay listed (greyed) until the next
// refresh or launch drops them.
@OptIn(ExperimentalCoroutinesApi::class)
class Reader(
    db: AppDatabase,
    private val prefs: Prefs,
    private val fetcher: FeedFetcher,
    private val sync: SyncApi,
    private val curated: CuratedFeeds,
    private val scope: CoroutineScope,
) {
    private val feeds = db.feedDao()
    private val articles = db.articleDao()

    private val refreshMutex = Mutex()
    private val _progress = MutableStateFlow<RefreshProgress?>(null)
    val progress: StateFlow<RefreshProgress?> = _progress.asStateFlow()

    // Set once this process has reconciled feeds with the group; until then a
    // watermark push could be based on a feed list the group has moved past.
    @Volatile private var feedsReconciled = false

    // The last watermark the server is known to hold, so a degraded load only
    // asks about pushing when there's actually something unsent.
    @Volatile private var remoteWatermark: Long? = null

    // Asked at most once per refresh, as on the web: every later read in the
    // same degraded state would pose the identical question.
    @Volatile private var degradedPrompted = false
    @Volatile private var readWhileDegraded = false
    private val _degradedPush = MutableStateFlow<Int?>(null)

    /** Failed-feed count while the "sync anyway?" question is open, else null. */
    val degradedPush: StateFlow<Int?> = _degradedPush.asStateFlow()

    private val _syncProblem = MutableStateFlow<String?>(null)
    val syncProblem: StateFlow<String?> = _syncProblem.asStateFlow()

    val lastReadAt: Flow<Long?> = prefs.lastReadAt
    val lastRefreshAt: Flow<Long?> = prefs.lastRefreshAt
    val deviceToken: Flow<String?> = prefs.deviceToken
    // Room re-runs a query on any write to its tables, so a refresh would
    // re-emit these once per feed even when nothing they return changed.
    val allFeeds: Flow<List<FeedEntity>> = feeds.observeAll().distinctUntilChanged()
    // The unread posts plus any read since the last prune.
    val listed: Flow<List<ArticleRow>> = prefs.listedAfter.flatMapLatest { articles.observeListed(after(it)) }.distinctUntilChanged()
    val favourites: Flow<List<ArticleRow>> = articles.observeFavourites().distinctUntilChanged()
    val favouriteCount: Flow<Int> = articles.observeFavouriteCount().distinctUntilChanged()

    suspend fun setFavourite(article: ArticleRow, favourite: Boolean) =
        articles.setFavourite(article.feedUrl, article.guid, favourite)
    val unreadCounts: Flow<List<FeedCount>> = lastReadAt.flatMapLatest { articles.observeUnreadCounts(after(it)) }.distinctUntilChanged()
    val refreshSettings: Flow<RefreshSettings> = prefs.refreshSettings

    suspend fun setRefreshSettings(value: RefreshSettings) = prefs.setRefreshSettings(value)

    val startScreen: Flow<StartScreen> = prefs.startScreen
    suspend fun setStartScreen(value: StartScreen) = prefs.setStartScreen(value)

    private fun after(watermark: Long?) = watermark ?: Long.MIN_VALUE

    // ---- Refresh -----------------------------------------------------------

    /** Fetches every feed and syncs. A refresh already running is not doubled up. */
    suspend fun refresh() {
        if (!refreshMutex.tryLock()) return
        try {
            doRefresh()
        } finally {
            _progress.value = null
            refreshMutex.unlock()
        }
    }

    private suspend fun doRefresh() {
        val token = prefs.deviceToken()
        feedsReconciled = false
        degradedPrompted = false
        readWhileDegraded = false
        _degradedPush.value = null

        prune()
        applyCurated(curated.load())

        // Before fetching rather than alongside it, unlike the web app, which
        // races the two to get a first paint out. Here the stored articles are
        // the first paint, so ordering costs nothing and every feed the group
        // knows about is fetched in the same pass.
        if (token != null) {
            feedsReconciled = syncing { reconcileFeeds(token) }.isSuccess
        }

        fetchAll(feeds.all())

        if (token != null) {
            syncing { sync.pullWatermark(token) }.onSuccess { remote ->
                remoteWatermark = remote
                remote?.let { prefs.advanceLastReadAt(it) }
            }
            maybePushWatermark(token)
        }
        // Again, so posts read on another device expire in the same pass.
        prune()
        prefs.setLastRefreshAt(System.currentTimeMillis())
    }

    // Drops read posts. Runs at the start and end of every refresh, and on a
    // cold launch — never on backgrounding, since opening a post in the
    // browser backgrounds the app and the post would vanish behind it.
    suspend fun prune() {
        val watermark = prefs.lastReadAt() ?: return
        articles.pruneRead(watermark)
        prefs.setListedAfter(watermark)
    }

    // Upserts the curated list and drops feeds it no longer names. A personal
    // feed that has since become curated simply turns into the curated row —
    // the web app's "shadowed" case — and reconcileFeeds retracts it from the
    // group. An empty list means every source failed, not that the list was
    // emptied, so nothing is removed then.
    private suspend fun applyCurated(list: List<Feed>) {
        if (list.isEmpty()) return
        val existing = feeds.all().associateBy { it.feedUrl }
        val urls = list.map { it.feedUrl }.toSet()
        feeds.upsert(
            list.map { feed ->
                existing[feed.feedUrl]?.copy(title = feed.title, curated = true)
                    ?: FeedEntity(feed.feedUrl, feed.title, siteUrl = null, curated = true, lastError = null)
            },
        )
        val dropped = existing.values.filter { it.curated && it.feedUrl !in urls }.map { it.feedUrl }
        removeLocally(dropped)
    }

    // Port of app.ts's reconcileFeeds; the decisions live in core/Reconcile.
    private suspend fun reconcileFeeds(token: String) {
        val all = feeds.all()
        val curatedUrls = all.filter { it.curated }.map { it.feedUrl }.toSet()
        val personal = all.filter { !it.curated }.map { Feed(it.feedUrl, it.title) }
        val remote = sync.pullFeeds(token)

        val push = Reconcile.planPush(personal, curatedUrls, remote.map(SyncedFeed::toRemote))
        val group = if (push.isEmpty) remote else sync.pushFeedChanges(token, push.additions, push.retractions)

        val result = Reconcile.applyGroup(group.map(SyncedFeed::toRemote), curatedUrls)
        feeds.insertNew(result.live.map { FeedEntity(it.feedUrl, it.title, siteUrl = null, curated = false, lastError = null) })
        removeLocally(result.removed)
    }

    private suspend fun fetchAll(list: List<FeedEntity>) = coroutineScope {
        if (list.isEmpty()) return@coroutineScope
        val watermark = prefs.lastReadAt()
        val permits = Semaphore(FETCH_CONCURRENCY)
        _progress.update { RefreshProgress(settled = it?.settled ?: 0, total = (it?.total ?: 0) + list.size) }
        list.map { feed ->
            async {
                permits.withPermit { fetchOne(feed, watermark) }
                _progress.update { it?.copy(settled = it.settled + 1) }
            }
        }.awaitAll()
    }

    // Returns whether it succeeded. The failure reason is kept on the row so
    // the feed list can say why, and so a later push knows the load was
    // degraded.
    private suspend fun fetchOne(feed: FeedEntity, watermark: Long?): Boolean = try {
        val parsed = fetcher.fetch(feed.feedUrl)
        store(feed.title, parsed.posts, watermark)
        feeds.markFetched(feed.feedUrl, parsed.siteUrl)
        true
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Log.w(TAG, "${feed.title}: ${e.message}")
        feeds.markFailed(feed.feedUrl, e.message ?: "Failed to fetch feed.")
        false
    }

    // Read posts are never stored: they'd only be pruned on the next pass.
    // An existing row is left alone, which is what keeps a favourite a favourite.
    private suspend fun store(feedTitle: String, posts: List<Post>, watermark: Long?) {
        articles.insertNew(
            posts.filter { !ReadState.isRead(it.publishedAt, watermark) }
                .map { ArticleEntity(it.feedUrl, it.guid, feedTitle, it.title, it.link, it.publishedAt) },
        )
    }

    private suspend fun removeLocally(feedUrls: List<String>) {
        if (feedUrls.isEmpty()) return
        feeds.delete(feedUrls)
        articles.deleteForFeeds(feedUrls)
    }

    // ---- Reading -----------------------------------------------------------

    private suspend fun firstUnread(): ArticleRow? = articles.firstUnread(after(prefs.lastReadAt()))

    // Opening a post (in the browser) advances the watermark only when it's
    // the very next unread one; opening further ahead reads just that post.
    suspend fun open(feedUrl: String, guid: String) {
        val first = firstUnread() ?: return
        if (first.feedUrl == feedUrl && first.guid == guid) markRead(first.publishedAt)
    }

    /** How many unread posts "mark read up to here" would mark, to decide whether to ask. */
    suspend fun countUnreadUpTo(publishedAt: Long): Int =
        articles.countUnreadUpTo(after(prefs.lastReadAt()), publishedAt)

    suspend fun lastUnreadPublishedAt(): Long? = articles.lastUnreadPublishedAt(after(prefs.lastReadAt()))

    suspend fun markReadUpTo(publishedAt: Long) {
        ReadState.watermarkAfterMarkUpTo(prefs.lastReadAt(), publishedAt)?.let { markRead(it) }
    }

    private suspend fun markRead(publishedAt: Long) {
        if (feeds.failedCount() > 0) readWhileDegraded = true
        prefs.advanceLastReadAt(publishedAt)
        scope.launch { pushWatermarkIfAllowed() }
    }

    // ---- Watermark sync ----------------------------------------------------

    private suspend fun pushWatermarkIfAllowed() {
        // A refresh in flight pushes at its own end, with complete knowledge
        // of which feeds failed — pushing now could precede a failure.
        if (refreshMutex.isLocked) return
        prefs.deviceToken()?.let { maybePushWatermark(it) }
    }

    private suspend fun maybePushWatermark(token: String) {
        val local = prefs.lastReadAt() ?: return
        if (!feedsReconciled) return
        if (local == remoteWatermark) return
        // A failed feed only misleads this device — until sync. Pushing would
        // make its watermark authoritative where those feeds load fine,
        // marking posts read that were never shown anywhere. So ask.
        val failures = feeds.failedCount()
        if (failures > 0) {
            if (!degradedPrompted) {
                degradedPrompted = true
                _degradedPush.value = failures
            }
            return
        }
        pushWatermarkNow(token)
    }

    private suspend fun pushWatermarkNow(token: String) {
        val local = prefs.lastReadAt() ?: return
        syncing { sync.pushWatermark(token, local) }.onSuccess { winner ->
            remoteWatermark = winner
            SyncState.mergeWatermark(local, winner)?.let { prefs.advanceLastReadAt(it) }
        }
    }

    fun pushAnyway() {
        _degradedPush.value = null
        scope.launch { prefs.deviceToken()?.let { pushWatermarkNow(it) } }
    }

    fun keepLocal() {
        _degradedPush.value = null
    }

    // Runs a sync call, recording the failure for Settings instead of
    // throwing: sync is never allowed to break reading.
    private suspend fun <T> syncing(block: suspend () -> T): Result<T> = try {
        Result.success(block()).also { _syncProblem.value = null }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Log.w(TAG, "sync: ${e.message}")
        _syncProblem.value = if (e is SyncException && e.status == 401) {
            "This device's sync token was rejected. Unpair it and pair again."
        } else {
            e.message ?: "Sync failed."
        }
        Result.failure(e)
    }

    // ---- Subscriptions -----------------------------------------------------

    data class Outcome(val message: String, val ok: Boolean)

    // Fetched before it's saved, so a URL that isn't a feed is reported now
    // instead of joining the list and failing on every refresh — and the row
    // is written complete, with the feed's own title and homepage.
    suspend fun addFeed(rawUrl: String): Outcome {
        val feedUrl = Subscriptions.normalizeFeedUrl(rawUrl)
            ?: return Outcome("Enter a full feed URL, starting with http:// or https://.", ok = false)
        val existing = feeds.all().map { Feed(it.feedUrl, it.title) }
        if (Subscriptions.planAdditions(listOf(Feed(feedUrl, feedUrl)), existing).added.isEmpty()) {
            return Outcome("You're already subscribed to that feed.", ok = false)
        }
        val parsed = try {
            fetcher.fetch(feedUrl)
        } catch (e: FeedFetchException) {
            Log.w(TAG, "add $feedUrl: ${e.message}")
            return Outcome(
                "Couldn't read that as a feed. Check the URL points at the feed itself, not the site's homepage.",
                ok = false,
            )
        }
        val title = parsed.title ?: feedUrl
        feeds.upsert(listOf(FeedEntity(feedUrl, title, parsed.siteUrl, curated = false, lastError = null)))
        store(title, parsed.posts, prefs.lastReadAt())
        scope.launch { reconcileAfterAdd() }
        return Outcome("Added $title.", ok = true)
    }

    // Purely additive, like the web app's import: feeds already here (curated
    // or personal) are left exactly as they are.
    suspend fun importOpml(text: String): Outcome {
        val candidates = try {
            Opml.parse(text)
        } catch (e: Exception) {
            return Outcome(e.message ?: "Failed to import OPML file.", ok = false)
        }
        val existing = feeds.all().map { Feed(it.feedUrl, it.title) }
        val additions = Subscriptions.planAdditions(candidates, existing)
        val summary = Subscriptions.describeImport(additions)
        if (additions.added.isEmpty()) return Outcome(summary, ok = true)

        val rows = additions.added.map { FeedEntity(it.feedUrl, it.title, siteUrl = null, curated = false, lastError = null) }
        feeds.insertNew(rows)
        scope.launch {
            fetchAll(rows)
            _progress.value = null
            reconcileAfterAdd()
        }
        return Outcome(summary, ok = true)
    }

    suspend fun exportOpml(): String =
        Opml.write(feeds.all().map { Feed(it.feedUrl, it.title, it.siteUrl) }, "Reader subscriptions")

    // A new feed goes to the group now rather than on the next refresh, so
    // other devices see it without waiting.
    private suspend fun reconcileAfterAdd() {
        val token = prefs.deviceToken() ?: return
        if (syncing { reconcileFeeds(token) }.isSuccess) feedsReconciled = true
    }

    suspend fun retry(feedUrl: String) {
        val feed = feeds.get(feedUrl) ?: return
        fetchOne(feed, prefs.lastReadAt())
        // Clearing the last failure makes the load whole again, so the push it
        // held back can go — unless you read while it was degraded, which
        // stays the banner's question.
        if (feeds.failedCount() == 0 && !readWhileDegraded) {
            _degradedPush.value = null
            pushWatermarkIfAllowed()
        }
    }

    // On a synced device the removal goes to the group first; the local delete
    // follows only once the group has it, or the next reconcile would restore
    // the feed. Returns an error message, or null on success.
    suspend fun removeFeed(feedUrl: String): String? {
        val feed = feeds.get(feedUrl) ?: return null
        if (feed.curated) return "${feed.title} ships with the app's curated list and can't be removed here."
        prefs.deviceToken()?.let { token ->
            try {
                sync.pushFeedChanges(token, emptyList(), listOf(feedUrl))
            } catch (e: SyncException) {
                return "Couldn't remove ${feed.title} from your synced devices. Try again when you're online."
            }
        }
        removeLocally(listOf(feedUrl))
        return null
    }

    // ---- Pairing -----------------------------------------------------------

    // With no token this device becomes the group's first member and gets one
    // back; with one, it gets a fresh code for its existing group.
    suspend fun startPairing(): PairResponse {
        val result = sync.startPairing(prefs.deviceToken(), prefs.lastReadAt())
        result.deviceToken?.let {
            prefs.setDeviceToken(it)
            remoteWatermark = null
            scope.launch { refresh() }
        }
        return result
    }

    suspend fun claim(code: String) {
        prefs.setDeviceToken(sync.claim(code))
        remoteWatermark = null
        scope.launch { refresh() }
    }

    suspend fun unpair() {
        prefs.setDeviceToken(null)
        feedsReconciled = false
        remoteWatermark = null
        _syncProblem.value = null
        _degradedPush.value = null
    }

    private companion object {
        const val TAG = "Reader"
        const val FETCH_CONCURRENCY = 6
    }
}

private fun SyncedFeed.toRemote() = RemoteFeed(feedUrl, title, deleted = deletedAt != null)
