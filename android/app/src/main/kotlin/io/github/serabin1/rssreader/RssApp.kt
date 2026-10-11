package io.github.serabin1.rssreader

import android.app.Application
import androidx.room.Room
import io.github.serabin1.rssreader.data.AppDatabase
import io.github.serabin1.rssreader.data.CuratedFeeds
import io.github.serabin1.rssreader.data.FeedFetcher
import io.github.serabin1.rssreader.data.Prefs
import io.github.serabin1.rssreader.data.Reader
import io.github.serabin1.rssreader.data.SyncApi
import io.github.serabin1.rssreader.data.httpClient
import io.github.serabin1.rssreader.work.RefreshWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

// Hand-wired rather than Hilt: a handful of singletons, built once, read from
// one place. Same "raw API first" habit as the web app.
class AppContainer(app: Application) {
    val http = httpClient()
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    // Prelaunch: a schema change rebuilds the database rather than migrating
    // it. Everything in it but favourites is refetched on the next refresh.
    // Replace with real migrations before favourites matter to anyone.
    private val db = Room.databaseBuilder(app, AppDatabase::class.java, "reader.db")
        .fallbackToDestructiveMigration(dropAllTables = true)
        .build()
    val prefs = Prefs(app)
    val reader = Reader(
        db = db,
        prefs = prefs,
        fetcher = FeedFetcher(http),
        sync = SyncApi(http, BuildConfig.WEB_ORIGIN),
        curated = CuratedFeeds(app, http, BuildConfig.WEB_ORIGIN),
        scope = scope,
    )
}

class RssApp : Application() {
    val container by lazy { AppContainer(this) }

    override fun onCreate() {
        super.onCreate()
        // Follows the background-refresh settings for the life of the process,
        // so a change in Settings reschedules (or cancels) the work at once.
        container.scope.launch {
            container.prefs.refreshSettings
                .map { Triple(it.background, it.backgroundIntervalMinutes, it.backgroundUnmeteredOnly) }
                .distinctUntilChanged()
                .collect { RefreshWorker.apply(this@RssApp, container.prefs.refreshSettings()) }
        }
    }
}
