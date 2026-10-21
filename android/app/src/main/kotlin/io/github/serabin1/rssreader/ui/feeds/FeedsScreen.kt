package io.github.serabin1.rssreader.ui.feeds

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.serabin1.rssreader.core.RelativeDate
import io.github.serabin1.rssreader.data.FeedEntity
import io.github.serabin1.rssreader.ui.common.FeedAvatar
import io.github.serabin1.rssreader.ui.common.RefreshableBox
import io.github.serabin1.rssreader.ui.common.openInBrowser
import io.github.serabin1.rssreader.ui.common.readerViewModel
import kotlinx.coroutines.launch

// Swiping across home is a shortcut to the two banners: left to right opens
// Favourites, right to left opens Unread. Only a drag that starts out
// horizontal is claimed, so the list still scrolls as before.
@Composable
private fun Modifier.swipeBetween(onRight: () -> Unit, onLeft: () -> Unit): Modifier {
    val right by rememberUpdatedState(onRight)
    val left by rememberUpdatedState(onLeft)
    return pointerInput(Unit) {
        val threshold = 96.dp.toPx()
        var total = 0f
        detectHorizontalDragGestures(
            onDragStart = { total = 0f },
            onDragEnd = {
                when {
                    total > threshold -> right()
                    total < -threshold -> left()
                }
            },
        ) { _, dragAmount -> total += dragAmount }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeedsScreen(
    onOpenFlow: () -> Unit,
    onOpenFavourites: () -> Unit,
    onOpenFeed: (FeedEntity) -> Unit,
    onOpenSettings: () -> Unit,
) {
    val vm = readerViewModel { FeedsViewModel(it) }
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val context = LocalContext.current
    var adding by rememberSaveable { mutableStateOf(false) }
    val scrollBehavior = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()

    LaunchedEffect(vm) { vm.message.collect { snackbar.showSnackbar(it) } }

    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        context.contentResolver.openInputStream(uri)?.use { vm.importOpml(it.reader().readText()) }
        adding = false
    }

    val scope = rememberCoroutineScope()
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) scope.launch { snackbar.showSnackbar("Notifications are blocked. Allow them for Reader in system settings.") }
    }
    // The permission is asked for when a feed's notifications go on rather
    // than at launch, so the request comes with an obvious reason. They're
    // posted by background refresh, so with that off none would come.
    val setNotify = { feedUrl: String, notify: Boolean ->
        vm.setNotify(feedUrl, notify)
        if (notify) {
            if (!state.settings.background) {
                scope.launch { snackbar.showSnackbar("Notifications come with background refresh, which is off in Settings.") }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    Scaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            LargeTopAppBar(
                title = { Text("Reader") },
                actions = {
                    if (state.settings.refreshButton) {
                        IconButton(onClick = vm::refresh, enabled = state.progress == null) {
                            Icon(Icons.Filled.Refresh, contentDescription = "Refresh")
                        }
                    }
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Filled.Settings, contentDescription = "Settings")
                    }
                },
                scrollBehavior = scrollBehavior,
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { adding = true },
                icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                text = { Text("Add feed") },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        RefreshableBox(
            enabled = state.settings.pullToRefresh,
            refreshing = state.progress != null,
            onRefresh = vm::refresh,
            modifier = Modifier.padding(padding),
        ) {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .swipeBetween(onRight = onOpenFavourites, onLeft = onOpenFlow),
                contentPadding = PaddingValues(bottom = 96.dp),
            ) {
                item { RefreshStatus(state) }
                item {
                    Banner(
                        icon = Icons.Filled.Home,
                        title = "All unread",
                        subtitle = if (state.totalUnread == 0) "All caught up" else "${state.totalUnread} unread",
                        onClick = onOpenFlow,
                        emphasised = true,
                    )
                }
                item {
                    Banner(
                        icon = Icons.Filled.Favorite,
                        title = "Favourites",
                        subtitle = when (state.favourites) {
                            0 -> "None yet"
                            1 -> "1 post"
                            else -> "${state.favourites} posts"
                        },
                        onClick = onOpenFavourites,
                    )
                }
                state.degradedPush?.let { failures ->
                    item { DegradedSyncCard(failures, onPush = vm::pushAnyway, onKeep = vm::keepLocal) }
                }
                if (state.personal.isNotEmpty()) {
                    item { SectionHeader("Your feeds") }
                    items(state.personal, key = { it.feed.feedUrl }) { row ->
                        FeedListRow(row, onOpen = onOpenFeed, onRetry = vm::retry, onSetNotify = setNotify, onRemove = vm::remove)
                    }
                }
                if (state.curated.isNotEmpty()) {
                    item { SectionHeader("Curated") }
                    items(state.curated, key = { it.feed.feedUrl }) { row ->
                        FeedListRow(row, onOpen = onOpenFeed, onRetry = vm::retry, onSetNotify = setNotify, onRemove = null)
                    }
                }
            }
        }
    }

    if (adding) {
        AddFeedSheet(
            onDismiss = { adding = false },
            onAdd = { url, done -> vm.addFeed(url) { ok -> done(ok); if (ok) adding = false } },
            onImport = { importLauncher.launch(arrayOf("text/xml", "application/xml", "text/x-opml", "*/*")) },
        )
    }
}

@Composable
private fun RefreshStatus(state: FeedsState) {
    val progress = state.progress
    Column(Modifier.padding(horizontal = 24.dp, vertical = 4.dp)) {
        if (progress != null) {
            LinearProgressIndicator(
                progress = { if (progress.total == 0) 0f else progress.settled / progress.total.toFloat() },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(4.dp))
        }
        val text = buildList {
            when {
                progress != null -> add("Refreshing ${progress.settled} of ${progress.total} feeds…")
                state.lastRefreshAt != null ->
                    add("Updated ${RelativeDate.formatPostDate(state.lastRefreshAt, System.currentTimeMillis())}")
            }
            if (progress == null && state.failed > 0) add("${state.failed} failed")
        }.joinToString(" · ")
        if (text.isNotEmpty()) {
            Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun Banner(
    icon: ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit,
    emphasised: Boolean = false,
) {
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (emphasised) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.surfaceContainerHigh
            },
        ),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
    ) {
        Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null)
            Column(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                Text(title, style = MaterialTheme.typography.titleLarge)
                Text(subtitle, style = MaterialTheme.typography.bodyMedium)
            }
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null)
        }
    }
}

// The web app's degraded-load banner: the watermark is saved here either way,
// and the next clean refresh sends it on its own, so keeping it local is a
// safe default rather than a loss.
@Composable
private fun DegradedSyncCard(failures: Int, onPush: () -> Unit, onKeep: () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(
                "$failures feed${if (failures == 1) "" else "s"} failed to load, so this device's reading " +
                    "position wasn't sent to your other devices. It's saved here either way — the next " +
                    "refresh that succeeds will sync it automatically.",
                style = MaterialTheme.typography.bodyMedium,
            )
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onKeep) { Text("Keep local") }
                TextButton(onClick = onPush) { Text("Sync anyway") }
            }
        }
    }
}

@Composable
private fun SectionHeader(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(start = 24.dp, top = 20.dp, bottom = 4.dp),
    )
}

// Tap opens the feed's posts, as on the web; long-press for the rest,
// including its site. Curated feeds can't be removed — that's an edit to
// curated-feeds.opml — so they get no Remove.
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FeedListRow(
    row: FeedRow,
    onOpen: (FeedEntity) -> Unit,
    onRetry: (String) -> Unit,
    onSetNotify: (String, Boolean) -> Unit,
    onRemove: ((String) -> Unit)?,
) {
    val context = LocalContext.current
    val feed = row.feed
    var menu by remember { mutableStateOf(false) }
    var confirmRemove by remember { mutableStateOf(false) }

    Box {
        ListItem(
            modifier = Modifier.combinedClickable(
                onClick = { onOpen(feed) },
                onLongClick = { menu = true },
            ),
            leadingContent = { FeedAvatar(feed.title) },
            headlineContent = { Text(feed.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            supportingContent = feed.lastError?.let { error ->
                {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Filled.Warning,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.error,
                            modifier = Modifier.size(14.dp),
                        )
                        Text(
                            " $error",
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            },
            trailingContent = if (row.unread > 0) {
                { Badge(containerColor = MaterialTheme.colorScheme.secondaryContainer) { Text("${row.unread}") } }
            } else {
                null
            },
        )
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(
                text = { Text("Open site") },
                onClick = { menu = false; openInBrowser(context, feed.siteUrl ?: feed.feedUrl) },
            )
            // Says the current state; choosing it switches to the other.
            DropdownMenuItem(
                text = { Text(if (feed.notify) "Notifications On" else "Notifications Off") },
                onClick = { menu = false; onSetNotify(feed.feedUrl, !feed.notify) },
            )
            if (feed.lastError != null) {
                DropdownMenuItem(text = { Text("Retry") }, onClick = { menu = false; onRetry(feed.feedUrl) })
            }
            if (onRemove != null) {
                DropdownMenuItem(text = { Text("Unsubscribe") }, onClick = { menu = false; confirmRemove = true })
            }
        }
    }

    if (confirmRemove && onRemove != null) {
        AlertDialog(
            onDismissRequest = { confirmRemove = false },
            title = { Text("Unsubscribe?") },
            text = { Text("Unsubscribe from ${feed.title}? Favourites from it are kept.") },
            confirmButton = {
                TextButton(onClick = { confirmRemove = false; onRemove(feed.feedUrl) }) { Text("Unsubscribe") }
            },
            dismissButton = { TextButton(onClick = { confirmRemove = false }) { Text("Cancel") } },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddFeedSheet(
    onDismiss: () -> Unit,
    onAdd: (String, (Boolean) -> Unit) -> Unit,
    onImport: () -> Unit,
) {
    var url by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val submit = {
        if (url.isNotBlank() && !busy) {
            busy = true
            onAdd(url) { ok -> busy = false; if (ok) url = "" }
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 24.dp).imePadding()) {
            Text("Add a feed", style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(16.dp))
            OutlinedTextField(
                value = url,
                onValueChange = { url = it },
                label = { Text("Feed URL") },
                placeholder = { Text("https://example.com/feed.xml") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { submit() }),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
            Button(onClick = submit, enabled = url.isNotBlank() && !busy, modifier = Modifier.fillMaxWidth()) {
                if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Add")
            }
            HorizontalDivider(Modifier.padding(vertical = 20.dp))
            OutlinedButton(onClick = onImport, modifier = Modifier.fillMaxWidth()) { Text("Import OPML file") }
        }
    }
}
