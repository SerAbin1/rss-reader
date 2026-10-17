package io.github.serabin1.rssreader.ui.flow

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import io.github.serabin1.rssreader.core.Post
import io.github.serabin1.rssreader.core.ReadState
import io.github.serabin1.rssreader.data.ArticleRow
import io.github.serabin1.rssreader.data.Reader
import io.github.serabin1.rssreader.ui.common.openInBrowser
import io.github.serabin1.rssreader.ui.common.openInDefaultBrowser
import io.github.serabin1.rssreader.ui.common.readerViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

sealed interface FeedPage {
    data class Loaded(val sections: List<DaySection>) : FeedPage
    data class Failed(val message: String) : FeedPage
}

class FeedViewModel(private val reader: Reader, private val feedUrl: String, private val feedTitle: String) : ViewModel() {
    private val posts = MutableStateFlow<Result<List<Post>>?>(null)

    init {
        viewModelScope.launch {
            posts.value = try {
                Result.success(reader.feedPosts(feedUrl))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Result.failure(e)
            }
        }
    }

    val page: StateFlow<FeedPage?> = combine(posts, reader.lastReadAt, reader.favourites) { result, lastReadAt, favourites ->
        result?.fold(
            onSuccess = { list ->
                val favourite = favourites.filter { it.feedUrl == feedUrl }.map { it.guid }.toSet()
                val rows = list.sortedByDescending { it.publishedAt }.map {
                    ArticleRow(it.feedUrl, it.guid, feedTitle, it.title, it.link, it.publishedAt, it.guid in favourite)
                }
                FeedPage.Loaded(sections(rows) { ReadState.isRead(it.publishedAt, lastReadAt) })
            },
            onFailure = { FeedPage.Failed(it.message ?: "Failed to fetch feed.") },
        )
    }.flowOn(Dispatchers.Default).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    fun opened(article: ArticleRow) {
        viewModelScope.launch { reader.open(article.feedUrl, article.guid) }
    }

    fun toggleFavourite(article: ArticleRow) {
        viewModelScope.launch { reader.setFavourite(article, !article.favourite) }
    }
}

// One feed's posts, newest first, read ones included (greyed): a back
// catalogue to browse rather than a queue, so there's no "mark read" here.
// Opening a post follows the usual watermark rule.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeedScreen(feedUrl: String, feedTitle: String, onBack: () -> Unit) {
    val vm = readerViewModel { FeedViewModel(it, feedUrl, feedTitle) }
    val page by vm.page.collectAsStateWithLifecycle()
    val context = LocalContext.current

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(feedTitle, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
            )
        },
    ) { padding ->
        when (val current = page) {
            null -> Unit
            is FeedPage.Failed -> EmptyState("Couldn't load this feed", current.message)
            is FeedPage.Loaded ->
                if (current.sections.isEmpty()) {
                    EmptyState("No posts", "This feed has nothing in it right now.")
                } else {
                    ArticleList(
                        sections = current.sections,
                        onOpen = { vm.opened(it); openInBrowser(context, it.link) },
                        onOpenInBrowser = { vm.opened(it); openInDefaultBrowser(context, it.link) },
                        onToggleFavourite = vm::toggleFavourite,
                        onMarkUpTo = null,
                        modifier = Modifier.padding(padding),
                    )
                }
        }
    }
}
