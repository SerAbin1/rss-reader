package io.github.serabin1.rssreader.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import io.github.serabin1.rssreader.RssApp
import io.github.serabin1.rssreader.data.RefreshSettings
import java.util.concurrent.TimeUnit

// Fetches feeds while the app is closed, so opening it shows what's new
// without waiting on a refresh, and notifies of new posts from the feeds that
// ask for it. A refresh in the app notifies of nothing: the posts are on
// screen.
class RefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val arrived = (applicationContext as RssApp).container.reader.refresh()
        Notifier.postNew(applicationContext, arrived)
        return Result.success()
    }

    companion object {
        private const val NAME = "refresh"

        // UPDATE rather than KEEP, so a changed interval or network rule takes
        // effect now instead of after the old schedule's next run.
        fun apply(context: Context, settings: RefreshSettings) {
            val work = WorkManager.getInstance(context)
            if (!settings.background) {
                work.cancelUniqueWork(NAME)
                return
            }
            val network = if (settings.backgroundUnmeteredOnly) NetworkType.UNMETERED else NetworkType.CONNECTED
            val request = PeriodicWorkRequestBuilder<RefreshWorker>(
                settings.backgroundIntervalMinutes.toLong(),
                TimeUnit.MINUTES,
            )
                .setConstraints(Constraints.Builder().setRequiredNetworkType(network).build())
                .build()
            work.enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
        }
    }
}
