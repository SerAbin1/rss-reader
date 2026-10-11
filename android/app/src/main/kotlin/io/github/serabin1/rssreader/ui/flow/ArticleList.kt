package io.github.serabin1.rssreader.ui.flow

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.serabin1.rssreader.data.ArticleRow
import io.github.serabin1.rssreader.ui.common.FeedAvatar
import io.github.serabin1.rssreader.ui.common.share

// Read You's article list: day headers that stick while their posts scroll
// under them, then feed · date and the title per post. Swiping a post right
// to left toggles its favourite, as in Read You; long-press has the same
// actions for anyone who doesn't know the gesture.
@Composable
fun ArticleList(
    sections: List<DaySection>,
    onOpen: (ArticleRow) -> Unit,
    onToggleFavourite: (ArticleRow) -> Unit,
    // Null where marking read makes no sense (the Favourites tab).
    onMarkUpTo: ((ArticleRow) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    LazyColumn(modifier = modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        sections.forEach { section ->
            stickyHeader(key = "day-${section.label}", contentType = "day") {
                Text(
                    section.label,
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surface)
                        .padding(horizontal = 24.dp, vertical = 8.dp),
                )
            }
            items(
                section.articles,
                key = { "${it.row.feedUrl}\u0000${it.row.guid}" },
                contentType = { "article" },
            ) { listed ->
                SwipeToFavourite(listed.row, onToggleFavourite) {
                    ArticleItem(listed, onOpen, onToggleFavourite, onMarkUpTo)
                }
            }
        }
    }
}

// The swipe never dismisses anything: past the threshold it toggles the
// favourite and springs back, so the row stays where it was.
@Composable
private fun SwipeToFavourite(
    article: ArticleRow,
    onToggleFavourite: (ArticleRow) -> Unit,
    content: @Composable () -> Unit,
) {
    val currentArticle by rememberUpdatedState(article)
    val state = rememberSwipeToDismissBoxState(
        confirmValueChange = { value ->
            if (value == SwipeToDismissBoxValue.EndToStart) onToggleFavourite(currentArticle)
            false
        },
    )
    SwipeToDismissBox(
        state = state,
        enableDismissFromStartToEnd = false,
        backgroundContent = {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(MaterialTheme.colorScheme.primaryContainer)
                    .padding(horizontal = 24.dp),
                contentAlignment = Alignment.CenterEnd,
            ) {
                Icon(
                    if (article.favourite) Icons.Filled.FavoriteBorder else Icons.Filled.Favorite,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            }
        },
    ) {
        Box(Modifier.background(MaterialTheme.colorScheme.surface)) { content() }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ArticleItem(
    listed: ListedArticle,
    onOpen: (ArticleRow) -> Unit,
    onToggleFavourite: (ArticleRow) -> Unit,
    onMarkUpTo: ((ArticleRow) -> Unit)?,
) {
    val article = listed.row
    val read = listed.read
    val context = LocalContext.current
    var menu by remember { mutableStateOf(false) }
    val canMark = onMarkUpTo != null && !read

    Box {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .combinedClickable(onClick = { onOpen(article) }, onLongClick = { menu = true })
                .padding(start = 24.dp, end = 8.dp, top = 12.dp, bottom = 12.dp)
                // Read but not yet cleared: still there to find again, visibly done.
                .alpha(if (read) 0.4f else 1f),
            verticalAlignment = Alignment.Top,
        ) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    FeedAvatar(article.feedTitle, size = 18.dp)
                    Spacer(Modifier.width(8.dp))
                    Text(
                        article.feedTitle,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Text(
                        " · ${listed.dateLabel}",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                    if (article.favourite) {
                        Icon(
                            Icons.Filled.Favorite,
                            contentDescription = "Favourite",
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(start = 6.dp).size(14.dp),
                        )
                    }
                }
                Spacer(Modifier.height(6.dp))
                Text(
                    article.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (canMark) {
                IconButton(onClick = { onMarkUpTo(article) }) {
                    Icon(Icons.Filled.Check, contentDescription = "Mark read up to \"${article.title}\"")
                }
            } else {
                Spacer(Modifier.width(48.dp))
            }
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(
                text = { Text(if (article.favourite) "Remove from favourites" else "Add to favourites") },
                onClick = { menu = false; onToggleFavourite(article) },
            )
            if (canMark) {
                DropdownMenuItem(text = { Text("Mark read up to here") }, onClick = { menu = false; onMarkUpTo(article) })
            }
            DropdownMenuItem(text = { Text("Share") }, onClick = { menu = false; share(context, article.title, article.link) })
        }
    }
}

@Composable
fun EmptyState(title: String, body: String) {
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
            Text(
                body,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}
