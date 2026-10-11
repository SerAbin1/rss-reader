package io.github.serabin1.rssreader.data

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

// Which page the app opens on, like Read You's "initial page".
enum class StartScreen(val label: String) { Home("Home"), Unread("Unread"), Favourites("Favourites") }

// When the app goes to the network on its own. Every one of these is a
// separate switch because they cost different things: background refresh is
// battery and data while you aren't looking, refresh-on-open is a wait every
// launch, and pull-to-refresh is easy to trigger by accident.
data class RefreshSettings(
    val background: Boolean = true,
    val backgroundIntervalMinutes: Int = 60,
    val backgroundUnmeteredOnly: Boolean = false,
    val onOpen: Boolean = true,
    val pullToRefresh: Boolean = true,
    val refreshButton: Boolean = true,
) {
    companion object {
        // WorkManager won't run periodic work more often than every 15 minutes.
        val INTERVALS = listOf(15, 30, 60, 180, 360, 720, 1440)
    }
}

// Three files because they back up differently: the reading position is worth
// restoring onto a new phone, the sync token must never be (see the manifest
// and res/xml/backup_rules.xml).
private val Context.readingStore by preferencesDataStore("reading")
private val Context.syncStore by preferencesDataStore("sync")
private val Context.settingsStore by preferencesDataStore("settings")

private val LAST_READ_AT = longPreferencesKey("lastReadAt")
private val LAST_REFRESH_AT = longPreferencesKey("lastRefreshAt")
private val LISTED_AFTER = longPreferencesKey("listedAfter")
private val DEVICE_TOKEN = stringPreferencesKey("deviceToken")
private val BACKGROUND = booleanPreferencesKey("background")
private val BACKGROUND_INTERVAL = intPreferencesKey("backgroundIntervalMinutes")
private val BACKGROUND_UNMETERED = booleanPreferencesKey("backgroundUnmeteredOnly")
private val ON_OPEN = booleanPreferencesKey("refreshOnOpen")
private val PULL_TO_REFRESH = booleanPreferencesKey("pullToRefresh")
private val REFRESH_BUTTON = booleanPreferencesKey("refreshButton")
private val START_SCREEN = stringPreferencesKey("startScreen")

class Prefs(context: Context) {
    private val reading = context.readingStore
    private val sync = context.syncStore
    private val settings = context.settingsStore

    // Watermark, not per-post state: posts published at or before this are read.
    val lastReadAt: Flow<Long?> = reading.data.map { it[LAST_READ_AT] }
    suspend fun lastReadAt(): Long? = lastReadAt.first()

    // Never moves backwards, whoever calls it — the same max() the server
    // applies, so a stale write racing a fresher one can't rewind it.
    suspend fun advanceLastReadAt(value: Long): Long = reading.editAndGet { prefs ->
        val next = maxOf(prefs[LAST_READ_AT] ?: Long.MIN_VALUE, value)
        prefs[LAST_READ_AT] = next
        next
    }

    // The watermark as of the last prune. The list shows posts after it:
    // everything unread, plus what's been read since — greyed until the next
    // prune. A read favourite is older than this, so it leaves the list but
    // stays in Favourites.
    val listedAfter: Flow<Long?> = reading.data.map { it[LISTED_AFTER] }
    suspend fun setListedAfter(value: Long) {
        reading.edit { it[LISTED_AFTER] = value }
    }

    val lastRefreshAt: Flow<Long?> = reading.data.map { it[LAST_REFRESH_AT] }
    suspend fun setLastRefreshAt(value: Long) {
        reading.edit { it[LAST_REFRESH_AT] = value }
    }

    // The device's sync credential. Its presence is also what "this device is
    // paired" means — no separate flag to fall out of step with it.
    val deviceToken: Flow<String?> = sync.data.map { it[DEVICE_TOKEN] }
    suspend fun deviceToken(): String? = deviceToken.first()
    suspend fun setDeviceToken(token: String?) {
        sync.edit { if (token == null) it.remove(DEVICE_TOKEN) else it[DEVICE_TOKEN] = token }
    }

    val refreshSettings: Flow<RefreshSettings> = settings.data.map { prefs ->
        val defaults = RefreshSettings()
        RefreshSettings(
            background = prefs[BACKGROUND] ?: defaults.background,
            backgroundIntervalMinutes = prefs[BACKGROUND_INTERVAL] ?: defaults.backgroundIntervalMinutes,
            backgroundUnmeteredOnly = prefs[BACKGROUND_UNMETERED] ?: defaults.backgroundUnmeteredOnly,
            onOpen = prefs[ON_OPEN] ?: defaults.onOpen,
            pullToRefresh = prefs[PULL_TO_REFRESH] ?: defaults.pullToRefresh,
            refreshButton = prefs[REFRESH_BUTTON] ?: defaults.refreshButton,
        )
    }

    suspend fun refreshSettings(): RefreshSettings = refreshSettings.first()

    suspend fun setRefreshSettings(value: RefreshSettings) {
        settings.edit {
            it[BACKGROUND] = value.background
            it[BACKGROUND_INTERVAL] = value.backgroundIntervalMinutes
            it[BACKGROUND_UNMETERED] = value.backgroundUnmeteredOnly
            it[ON_OPEN] = value.onOpen
            it[PULL_TO_REFRESH] = value.pullToRefresh
            it[REFRESH_BUTTON] = value.refreshButton
        }
    }

    val startScreen: Flow<StartScreen> = settings.data.map { prefs ->
        StartScreen.entries.firstOrNull { it.name == prefs[START_SCREEN] } ?: StartScreen.Home
    }

    suspend fun setStartScreen(value: StartScreen) {
        settings.edit { it[START_SCREEN] = value.name }
    }

    private suspend fun <T> androidx.datastore.core.DataStore<Preferences>.editAndGet(
        block: (androidx.datastore.preferences.core.MutablePreferences) -> T,
    ): T {
        var result: T? = null
        edit { result = block(it) }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }
}
