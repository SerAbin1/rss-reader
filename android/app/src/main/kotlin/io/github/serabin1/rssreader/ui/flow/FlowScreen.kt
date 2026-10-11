package io.github.serabin1.rssreader.ui.flow

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.serabin1.rssreader.data.ArticleRow
import io.github.serabin1.rssreader.ui.common.RefreshableBox
import io.github.serabin1.rssreader.ui.common.openInBrowser
import io.github.serabin1.rssreader.ui.common.readerViewModel

// The article list, with Read You's filter bar along the bottom: Unread,
// earliest first, or Favourites, newest first. Opening the next unread post
// (in the browser) advances the watermark; read posts stay where they were,
// greyed, until the next refresh or launch clears them.
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FlowScreen(startWithFavourites: Boolean, onBack: () -> Unit) {
    val vm = readerViewModel { FlowViewModel(it) }
    val articles by vm.articles.collectAsStateWithLifecycle()
    val favourites by vm.favourites.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    val pending by vm.pending.collectAsStateWithLifecycle()
    val settings by vm.settings.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var showFavourites by rememberSaveable { mutableStateOf(startWithFavourites) }
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()

    val open = { article: ArticleRow ->
        vm.opened(article)
        openInBrowser(context, article.link)
    }

    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        if (showFavourites) {
                            "Favourites"
                        } else {
                            articles?.sumOf { day -> day.articles.count { !it.read } }?.let { "$it unread" } ?: "Unread"
                        },
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
                actions = {
                    if (!showFavourites) {
                        IconButton(onClick = vm::markAll, enabled = articles.orEmpty().any { day -> day.articles.any { !it.read } }) {
                            Icon(Icons.Filled.Done, contentDescription = "Mark all as read")
                        }
                    }
                },
                scrollBehavior = scrollBehavior,
            )
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = !showFavourites,
                    onClick = { showFavourites = false },
                    icon = { Icon(Icons.AutoMirrored.Filled.List, contentDescription = null) },
                    label = { Text("Unread") },
                )
                NavigationBarItem(
                    selected = showFavourites,
                    onClick = { showFavourites = true },
                    icon = { Icon(Icons.Filled.Favorite, contentDescription = null) },
                    label = { Text("Favourites") },
                )
            }
        },
    ) { padding ->
        if (showFavourites) {
            val list = favourites
            when {
                list == null -> Unit
                list.isEmpty() -> EmptyState(
                    "No favourites yet",
                    "Swipe a post to the left, or long-press it, to keep it here after it's read.",
                )
                else -> ArticleList(
                    sections = list,
                    onOpen = open,
                    onToggleFavourite = vm::toggleFavourite,
                    onMarkUpTo = null,
                    modifier = Modifier.padding(padding),
                )
            }
        } else {
            RefreshableBox(
                enabled = settings.pullToRefresh,
                refreshing = refreshing,
                onRefresh = vm::refresh,
                modifier = Modifier.padding(padding),
            ) {
                val list = articles
                when {
                    list == null -> Unit
                    list.isEmpty() -> EmptyState("All caught up", "New posts arrive on the next refresh.")
                    else -> ArticleList(
                        sections = list,
                        onOpen = open,
                        onToggleFavourite = vm::toggleFavourite,
                        onMarkUpTo = { vm.markUpTo(it.publishedAt) },
                    )
                }
            }
        }
    }

    pending?.let { mark ->
        AlertDialog(
            onDismissRequest = vm::cancelPending,
            title = { Text("Mark ${mark.count} posts as read?") },
            text = { Text("Read posts can't be marked unread again.") },
            confirmButton = { TextButton(onClick = vm::confirmPending) { Text("Mark read") } },
            dismissButton = { TextButton(onClick = vm::cancelPending) { Text("Cancel") } },
        )
    }
}
