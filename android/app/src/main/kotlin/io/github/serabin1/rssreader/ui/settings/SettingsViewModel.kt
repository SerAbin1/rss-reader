package io.github.serabin1.rssreader.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.serabin1.rssreader.data.PairResponse
import io.github.serabin1.rssreader.data.Reader
import io.github.serabin1.rssreader.data.RefreshSettings
import io.github.serabin1.rssreader.data.StartScreen
import io.github.serabin1.rssreader.data.SyncException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class SettingsViewModel(private val reader: Reader) : ViewModel() {
    val paired: StateFlow<Boolean?> = reader.deviceToken.map { it != null }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
    val syncProblem: StateFlow<String?> = reader.syncProblem
    val refreshSettings: StateFlow<RefreshSettings> = reader.refreshSettings
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), RefreshSettings())

    val startScreen: StateFlow<StartScreen> = reader.startScreen
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), StartScreen.Home)

    fun setStartScreen(value: StartScreen) {
        viewModelScope.launch { reader.setStartScreen(value) }
    }

    fun updateRefresh(change: (RefreshSettings) -> RefreshSettings) {
        viewModelScope.launch { reader.setRefreshSettings(change(refreshSettings.value)) }
    }

    private val _pairing = MutableStateFlow<PairResponse?>(null)
    val pairing: StateFlow<PairResponse?> = _pairing.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    private val messages = Channel<String>(Channel.BUFFERED)
    val message = messages.receiveAsFlow()

    // Set when the group already has two devices; Settings then asks whether
    // to replace the other one, which may be a lost or wiped device that can't
    // unpair itself.
    private val _groupFull = MutableStateFlow(false)
    val groupFull: StateFlow<Boolean> = _groupFull.asStateFlow()

    fun startPairing(replace: Boolean = false) = busy {
        _groupFull.value = false
        try {
            _pairing.value = reader.startPairing(replace)
        } catch (e: SyncException) {
            if (e.status == 409 && !replace) {
                _groupFull.value = true
            } else {
                messages.send("Couldn't start pairing. ${e.message}")
            }
        }
    }

    fun dismissGroupFull() {
        _groupFull.value = false
    }

    fun closePairing() {
        _pairing.value = null
    }

    fun claim(code: String, onDone: (Boolean) -> Unit) = busy {
        try {
            reader.claim(code)
            messages.send("Paired. Syncing now…")
            onDone(true)
        } catch (e: SyncException) {
            messages.send(e.message ?: "Couldn't pair this device.")
            onDone(false)
        }
    }

    fun unpair() = busy {
        try {
            reader.unpair()
            messages.send("This device no longer syncs. Its feeds and reading position stay here.")
        } catch (e: SyncException) {
            messages.send("Couldn't reach the server to unpair. Try again.")
        }
    }

    fun importOpml(text: String) = busy { messages.send(reader.importOpml(text).message) }

    fun exportOpml(write: (String) -> Unit) = busy {
        write(reader.exportOpml())
        messages.send("Subscriptions exported.")
    }

    private fun busy(block: suspend () -> Unit) {
        viewModelScope.launch {
            _busy.value = true
            try {
                block()
            } finally {
                _busy.value = false
            }
        }
    }
}
