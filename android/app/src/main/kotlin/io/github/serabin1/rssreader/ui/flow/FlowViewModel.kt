package io.github.serabin1.rssreader.ui.flow

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.serabin1.rssreader.core.ReadState
import io.github.serabin1.rssreader.core.RelativeDate
import io.github.serabin1.rssreader.data.ArticleRow
import io.github.serabin1.rssreader.data.Reader
import io.github.serabin1.rssreader.data.RefreshSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

// Asking before "mark read up to here" skips more than the one post, since a
// marked post can't be brought back — the watermark is forward-only.
data class PendingMark(val publishedAt: Long, val count: Int)

// Everything a row shows, worked out once per list change off the main
// thread, so scrolling only lays rows out — no date math or grouping.
data class ListedArticle(val row: ArticleRow, val read: Boolean, val dateLabel: String)

data class DaySection(val label: String, val articles: List<ListedArticle>)

internal fun sections(rows: List<ArticleRow>, isRead: (ArticleRow) -> Boolean): List<DaySection> {
    val now = System.currentTimeMillis()
    val zone = ZoneId.systemDefault()
    val today = LocalDate.now(zone)
    return rows
        .groupBy { Instant.ofEpochMilli(it.publishedAt).atZone(zone).toLocalDate() }
        .map { (day, dayRows) ->
            val label = when (day) {
                today -> "Today"
                today.minusDays(1) -> "Yesterday"
                else -> RelativeDate.formatFullDate(dayRows.first().publishedAt, zone)
            }
            DaySection(
                label,
                dayRows.map { ListedArticle(it, isRead(it), RelativeDate.formatPostDate(it.publishedAt, now, zone)) },
            )
        }
}

class FlowViewModel(private val reader: Reader) : ViewModel() {
    val articles: StateFlow<List<DaySection>?> = combine(reader.listed, reader.lastReadAt) { rows, lastReadAt ->
        sections(rows) { ReadState.isRead(it.publishedAt, lastReadAt) }
    }.flowOn(Dispatchers.Default).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    // Read state doesn't apply here: a favourite is kept whether read or not.
    val favourites: StateFlow<List<DaySection>?> = reader.favourites
        .map { rows -> sections(rows) { false } }
        .flowOn(Dispatchers.Default)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val refreshing: StateFlow<Boolean> = reader.progress.map { it != null }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), false)

    val settings: StateFlow<RefreshSettings> = reader.refreshSettings
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), RefreshSettings())

    private val _pending = MutableStateFlow<PendingMark?>(null)
    val pending: StateFlow<PendingMark?> = _pending.asStateFlow()

    fun refresh() {
        viewModelScope.launch { reader.refresh() }
    }

    fun opened(article: ArticleRow) {
        viewModelScope.launch { reader.open(article.feedUrl, article.guid) }
    }

    fun toggleFavourite(article: ArticleRow) {
        viewModelScope.launch { reader.setFavourite(article, !article.favourite) }
    }

    fun markUpTo(publishedAt: Long) {
        viewModelScope.launch {
            val count = reader.countUnreadUpTo(publishedAt)
            if (count > 1) _pending.value = PendingMark(publishedAt, count) else reader.markReadUpTo(publishedAt)
        }
    }

    fun markAll() {
        viewModelScope.launch { reader.lastUnreadPublishedAt()?.let { markUpTo(it) } }
    }

    fun confirmPending() {
        val pending = _pending.value ?: return
        _pending.value = null
        viewModelScope.launch { reader.markReadUpTo(pending.publishedAt) }
    }

    fun cancelPending() {
        _pending.value = null
    }
}
