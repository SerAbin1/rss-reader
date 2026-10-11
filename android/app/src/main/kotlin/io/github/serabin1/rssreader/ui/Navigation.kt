package io.github.serabin1.rssreader.ui

import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import io.github.serabin1.rssreader.data.StartScreen
import io.github.serabin1.rssreader.ui.feeds.FeedsScreen
import io.github.serabin1.rssreader.ui.flow.FlowScreen
import io.github.serabin1.rssreader.ui.settings.SettingsScreen
import kotlinx.serialization.Serializable

// Read You's shape — feeds → the article flow, plus settings — minus its
// reader: posts open in the browser, as they do on the web.
@Serializable data object FeedsRoute
@Serializable data class FlowRoute(val favourites: Boolean = false)
@Serializable data object SettingsRoute

@Composable
fun ReaderNavHost(startScreen: StartScreen) {
    val nav = rememberNavController()
    // Home is always the root, and the chosen page is pushed on top of it once
    // per launch (not again on rotation), so Back from it goes home rather
    // than out of the app. Transitions are off, so the push isn't visible.
    var opened by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        if (opened) return@LaunchedEffect
        opened = true
        when (startScreen) {
            StartScreen.Home -> Unit
            StartScreen.Unread -> nav.navigate(FlowRoute())
            StartScreen.Favourites -> nav.navigate(FlowRoute(favourites = true))
        }
    }
    // Pages switch instantly — no slide or fade between them.
    NavHost(
        navController = nav,
        startDestination = FeedsRoute,
        enterTransition = { EnterTransition.None },
        exitTransition = { ExitTransition.None },
        popEnterTransition = { EnterTransition.None },
        popExitTransition = { ExitTransition.None },
    ) {
        composable<FeedsRoute> {
            FeedsScreen(
                onOpenFlow = { nav.navigate(FlowRoute()) },
                onOpenFavourites = { nav.navigate(FlowRoute(favourites = true)) },
                onOpenSettings = { nav.navigate(SettingsRoute) },
            )
        }
        composable<FlowRoute> { entry ->
            FlowScreen(
                startWithFavourites = entry.toRoute<FlowRoute>().favourites,
                onBack = { nav.popBackStack() },
            )
        }
        composable<SettingsRoute> {
            SettingsScreen(onBack = { nav.popBackStack() })
        }
    }
}
