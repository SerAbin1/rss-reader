package io.github.serabin1.rssreader.ui.common

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.pullToRefresh
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.github.serabin1.rssreader.RssApp
import io.github.serabin1.rssreader.data.Reader

@Composable
inline fun <reified VM : ViewModel> readerViewModel(crossinline create: (Reader) -> VM): VM =
    viewModel(
        factory = viewModelFactory {
            initializer { create((this[APPLICATION_KEY] as RssApp).container.reader) }
        },
    )

fun openInBrowser(context: Context, url: String) {
    val uri = url.toUri()
    try {
        CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(context, uri)
    } catch (e: ActivityNotFoundException) {
        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
    }
}

fun share(context: Context, title: String, url: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_SUBJECT, title)
        putExtra(Intent.EXTRA_TEXT, url)
    }
    context.startActivity(Intent.createChooser(send, null))
}

// Read You shows each feed's favicon; fetching those would mean a request to
// every site on every list render, so a tinted initial stands in.
@Composable
fun FeedAvatar(title: String, size: Dp = 32.dp) {
    val colors = MaterialTheme.colorScheme
    val palette = listOf(colors.primaryContainer, colors.secondaryContainer, colors.tertiaryContainer)
    val onPalette = listOf(colors.onPrimaryContainer, colors.onSecondaryContainer, colors.onTertiaryContainer)
    val index = Math.floorMod(title.hashCode(), palette.size)
    Box(
        modifier = Modifier.size(size).background(palette[index], CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = title.trim().firstOrNull { it.isLetterOrDigit() }?.uppercase() ?: "#",
            style = MaterialTheme.typography.labelLarge,
            color = onPalette[index],
        )
    }
}

// Pull-to-refresh that can be switched off in Settings: when it's off the
// content is laid out exactly as before, just without the gesture. The pull
// needed is twice Material's default, so a fling back to the top of the list
// doesn't set off a refresh by accident.
private val PULL_THRESHOLD = 160.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RefreshableBox(
    enabled: Boolean,
    refreshing: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val state = rememberPullToRefreshState()
    Box(
        modifier.pullToRefresh(
            isRefreshing = refreshing,
            state = state,
            enabled = enabled,
            threshold = PULL_THRESHOLD,
            onRefresh = onRefresh,
        ),
    ) {
        content()
        if (enabled) {
            PullToRefreshDefaults.Indicator(
                state = state,
                isRefreshing = refreshing,
                maxDistance = PULL_THRESHOLD,
                modifier = Modifier.align(Alignment.TopCenter),
            )
        }
    }
}
