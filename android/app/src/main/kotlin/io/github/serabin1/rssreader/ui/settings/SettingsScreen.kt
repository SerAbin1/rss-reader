package io.github.serabin1.rssreader.ui.settings

import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import io.github.serabin1.rssreader.BuildConfig
import io.github.serabin1.rssreader.core.SyncState
import io.github.serabin1.rssreader.data.PairResponse
import io.github.serabin1.rssreader.data.RefreshSettings
import io.github.serabin1.rssreader.data.StartScreen
import io.github.serabin1.rssreader.ui.common.openInBrowser
import io.github.serabin1.rssreader.ui.common.readerViewModel
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(onBack: () -> Unit) {
    val vm = readerViewModel { SettingsViewModel(it) }
    val paired by vm.paired.collectAsStateWithLifecycle()
    val problem by vm.syncProblem.collectAsStateWithLifecycle()
    val pairing by vm.pairing.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val refresh by vm.refreshSettings.collectAsStateWithLifecycle()
    var choosingInterval by remember { mutableStateOf(false) }
    val startScreen by vm.startScreen.collectAsStateWithLifecycle()
    var choosingStart by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val snackbar = remember { SnackbarHostState() }
    var joining by rememberSaveable { mutableStateOf(false) }
    var confirmUnpair by remember { mutableStateOf(false) }

    LaunchedEffect(vm) { vm.message.collect { snackbar.showSnackbar(it) } }

    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        context.contentResolver.openInputStream(uri)?.use { vm.importOpml(it.reader().readText()) }
    }
    val exportLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/x-opml")) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        vm.exportOpml { opml -> context.contentResolver.openOutputStream(uri)?.use { it.write(opml.toByteArray()) } }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(
            Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Section("General")
            ListItem(
                headlineContent = { Text("Open on") },
                supportingContent = { Text(startScreen.label) },
                modifier = Modifier.clickable { choosingStart = true },
            )

            Section("Sync")
            Text(
                if (paired == true) {
                    "This device is paired. Your reading position and your own feeds sync with your other " +
                        "devices and the web app."
                } else {
                    "Sync shares your reading position and your own feeds with the web app and your other " +
                        "devices. Start it here, or join with a code from a device that already syncs."
                },
                style = MaterialTheme.typography.bodyMedium,
            )
            problem?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(onClick = vm::startPairing, enabled = !busy) {
                    Text(if (paired == true) "Add another device" else "Set up sync")
                }
                if (paired == true) {
                    OutlinedButton(onClick = { confirmUnpair = true }, enabled = !busy) { Text("Unpair") }
                } else {
                    OutlinedButton(onClick = { joining = true }, enabled = !busy) { Text("Join with a code") }
                }
            }

            Section("Subscriptions")
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = { importLauncher.launch(arrayOf("text/xml", "application/xml", "text/x-opml", "*/*")) }) {
                    Text("Import OPML")
                }
                OutlinedButton(onClick = { exportLauncher.launch("subscriptions.opml") }) { Text("Export OPML") }
            }

            Section("Refreshing")
            Column {
                SettingSwitch(
                    title = "Background refresh",
                    body = "Fetch feeds while the app is closed, so new posts are waiting when you open it.",
                    checked = refresh.background,
                    onChange = { on -> vm.updateRefresh { it.copy(background = on) } },
                )
                ListItem(
                    headlineContent = { Text("Background interval") },
                    supportingContent = { Text(intervalLabel(refresh.backgroundIntervalMinutes)) },
                    modifier = Modifier.clickable(enabled = refresh.background) { choosingInterval = true },
                    colors = if (refresh.background) ListItemDefaults.colors() else disabledColors(),
                )
                SettingSwitch(
                    title = "Only on Wi-Fi",
                    body = "Background refresh waits for an unmetered connection.",
                    checked = refresh.backgroundUnmeteredOnly,
                    enabled = refresh.background,
                    onChange = { on -> vm.updateRefresh { it.copy(backgroundUnmeteredOnly = on) } },
                )
                SettingSwitch(
                    title = "Refresh when the app opens",
                    body = "Otherwise the app shows what the last refresh found.",
                    checked = refresh.onOpen,
                    onChange = { on -> vm.updateRefresh { it.copy(onOpen = on) } },
                )
                SettingSwitch(
                    title = "Pull down to refresh",
                    checked = refresh.pullToRefresh,
                    onChange = { on -> vm.updateRefresh { it.copy(pullToRefresh = on) } },
                )
                SettingSwitch(
                    title = "Refresh button",
                    body = "Show the refresh button on the feeds page.",
                    checked = refresh.refreshButton,
                    onChange = { on -> vm.updateRefresh { it.copy(refreshButton = on) } },
                )
            }

            Section("About")
            Text("Version ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodyMedium)
            TextButton(onClick = { openInBrowser(context, BuildConfig.WEB_ORIGIN) }) { Text("Open the web app") }
        }
    }

    pairing?.let { PairingDialog(it, onDismiss = vm::closePairing) }

    if (choosingStart) {
        ChoiceDialog(
            title = "Open on",
            options = StartScreen.entries,
            selected = startScreen,
            label = { it.label },
            onChoose = { choosingStart = false; vm.setStartScreen(it) },
            onDismiss = { choosingStart = false },
        )
    }

    if (choosingInterval) {
        ChoiceDialog(
            title = "Background interval",
            options = RefreshSettings.INTERVALS,
            selected = refresh.backgroundIntervalMinutes,
            label = ::intervalLabel,
            onChoose = { minutes ->
                choosingInterval = false
                vm.updateRefresh { it.copy(backgroundIntervalMinutes = minutes) }
            },
            onDismiss = { choosingInterval = false },
        )
    }

    if (joining) {
        JoinDialog(
            busy = busy,
            onDismiss = { joining = false },
            onJoin = { code -> vm.claim(code) { ok -> if (ok) joining = false } },
        )
    }

    if (confirmUnpair) {
        AlertDialog(
            onDismissRequest = { confirmUnpair = false },
            title = { Text("Stop syncing this device?") },
            text = { Text("Your feeds and reading position stay on this device. Your other devices keep syncing with each other.") },
            confirmButton = { TextButton(onClick = { confirmUnpair = false; vm.unpair() }) { Text("Unpair") } },
            dismissButton = { TextButton(onClick = { confirmUnpair = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun <T> ChoiceDialog(
    title: String,
    options: List<T>,
    selected: T,
    label: (T) -> String,
    onChoose: (T) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                options.forEach { option ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth().clickable { onChoose(option) },
                    ) {
                        RadioButton(selected = option == selected, onClick = null)
                        Text(label(option), modifier = Modifier.padding(start = 12.dp, top = 12.dp, bottom = 12.dp))
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun SettingSwitch(
    title: String,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
    body: String? = null,
    enabled: Boolean = true,
) {
    ListItem(
        headlineContent = { Text(title) },
        supportingContent = body?.let { { Text(it) } },
        trailingContent = { Switch(checked = checked, onCheckedChange = null, enabled = enabled) },
        colors = if (enabled) ListItemDefaults.colors() else disabledColors(),
        modifier = Modifier.toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onChange),
    )
}

@Composable
private fun disabledColors() = ListItemDefaults.colors(
    headlineColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f),
    supportingColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.38f),
)

private fun intervalLabel(minutes: Int): String = when {
    minutes < 60 -> "Every $minutes minutes"
    minutes == 60 -> "Every hour"
    minutes < 1440 -> "Every ${minutes / 60} hours"
    else -> "Once a day"
}

@Composable
private fun Section(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 12.dp),
    )
}

// The QR is the same link the web app's pairing panel shows: the code rides
// in the URL fragment, which never reaches a server log, and a phone camera
// opens it straight into the web app's /pair page.
@Composable
private fun PairingDialog(pairing: PairResponse, onDismiss: () -> Unit) {
    val link = "${BuildConfig.WEB_ORIGIN}/pair#${pairing.pairCode}"
    val qr = remember(link) { qrBitmap(link, 512) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(pairing) {
        while (now < pairing.expiresAt) {
            delay(1_000)
            now = System.currentTimeMillis()
        }
    }
    val secondsLeft = (pairing.expiresAt - now) / 1000

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Pair another device") },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                Image(qr.asImageBitmap(), contentDescription = "Pairing QR code", modifier = Modifier.size(200.dp))
                Spacer(Modifier.height(12.dp))
                Text(
                    SyncState.formatPairCode(pairing.pairCode),
                    style = MaterialTheme.typography.headlineSmall.copy(fontFamily = FontFamily.Monospace),
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "Scan it, or enter the code in another copy of this app or at ${BuildConfig.WEB_ORIGIN}/pair.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    if (secondsLeft <= 0) {
                        "This code has expired."
                    } else {
                        val minutes = (secondsLeft + 59) / 60
                        "Expires in $minutes minute${if (minutes == 1L) "" else "s"}."
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Done") } },
    )
}

@Composable
private fun JoinDialog(busy: Boolean, onDismiss: () -> Unit, onJoin: (String) -> Unit) {
    var code by rememberSaveable { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Join with a code") },
        text = {
            Column {
                Text(
                    "On a device that already syncs, choose Add another device, then enter the code it shows.",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = code,
                    onValueChange = { code = it },
                    label = { Text("Pairing code") },
                    placeholder = { Text("ABCDE-FGHJK") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onJoin(code.trim()) }, enabled = code.isNotBlank() && !busy) { Text("Pair") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

private fun qrBitmap(content: String, size: Int): Bitmap {
    val matrix = QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, size, size)
    val pixels = IntArray(size * size) { i ->
        if (matrix[i % size, i / size]) 0xFF000000.toInt() else 0xFFFFFFFF.toInt()
    }
    return Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888)
}
