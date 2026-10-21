package io.github.serabin1.rssreader.ui.feeds

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.serabin1.rssreader.data.FeedEntity
import io.github.serabin1.rssreader.data.Reader
import io.github.serabin1.rssreader.data.RefreshProgress
import io.github.serabin1.rssreader.data.RefreshSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class FeedRow(val feed: FeedEntity, val unread: Int)

data class FeedsState(
    val personal: List<FeedRow> = emptyList(),
    val curated: List<FeedRow> = emptyList(),
    val totalUnread: Int = 0,
    val favourites: Int = 0,
    val failed: Int = 0,
    val lastRefreshAt: Long? = null,
    val progress: RefreshProgress? = null,
    val degradedPush: Int? = null,
    val settings: RefreshSettings = RefreshSettings(),
)

class FeedsViewModel(private val reader: Reader) : ViewModel() {
    private val messages = Channel<String>(Channel.BUFFERED)
    val message = messages.receiveAsFlow()

    val state: StateFlow<FeedsState> = combine(
        reader.allFeeds,
        reader.unreadCounts,
        reader.lastRefreshAt,
        reader.refreshSettings,
        combine(reader.progress, reader.degradedPush, reader.favouriteCount, ::Triple),
    ) { feeds, counts, lastRefreshAt, settings, (progress, degradedPush, favourites) ->
        val byUrl = counts.associate { it.feedUrl to it.count }
        val rows = feeds.map { FeedRow(it, byUrl[it.feedUrl] ?: 0) }
        FeedsState(
            personal = rows.filter { !it.feed.curated },
            curated = rows.filter { it.feed.curated },
            totalUnread = rows.sumOf { it.unread },
            favourites = favourites,
            failed = feeds.count { it.lastError != null },
            lastRefreshAt = lastRefreshAt,
            progress = progress,
            degradedPush = degradedPush,
            settings = settings,
        )
    }.flowOn(Dispatchers.Default).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), FeedsState())

    fun refresh() {
        viewModelScope.launch { reader.refresh() }
    }

    fun retry(feedUrl: String) {
        viewModelScope.launch { reader.retry(feedUrl) }
    }

    fun setNotify(feedUrl: String, notify: Boolean) {
        viewModelScope.launch { reader.setNotify(feedUrl, notify) }
    }

    fun remove(feedUrl: String) {
        viewModelScope.launch { reader.removeFeed(feedUrl)?.let { messages.send(it) } }
    }

    // Returns through the callback whether to clear the field: a URL that
    // turned out not to be a feed is worth keeping on screen to edit.
    fun addFeed(url: String, onDone: (Boolean) -> Unit) {
        viewModelScope.launch {
            val outcome = reader.addFeed(url)
            messages.send(outcome.message)
            onDone(outcome.ok)
        }
    }

    fun importOpml(text: String) {
        viewModelScope.launch { messages.send(reader.importOpml(text).message) }
    }

    fun pushAnyway() = reader.pushAnyway()
    fun keepLocal() = reader.keepLocal()
}
