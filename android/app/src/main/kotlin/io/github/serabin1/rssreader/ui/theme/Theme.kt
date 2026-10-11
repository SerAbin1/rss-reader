package io.github.serabin1.rssreader.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

// Material You, as Read You does: the wallpaper's palette on Android 12+.
// Older devices get a fixed palette built around the web app's paper-and-ink
// icon colours.
private val Light = lightColorScheme(
    primary = Color(0xFF6B5D3F),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFF4E1BB),
    onPrimaryContainer = Color(0xFF241A04),
    secondaryContainer = Color(0xFFEDE1CF),
    background = Color(0xFFFAF8F4),
    surface = Color(0xFFFAF8F4),
    onSurface = Color(0xFF22201C),
)

private val Dark = darkColorScheme(
    primary = Color(0xFFD8C5A0),
    onPrimary = Color(0xFF3B2F15),
    primaryContainer = Color(0xFF53462A),
    onPrimaryContainer = Color(0xFFF4E1BB),
    secondaryContainer = Color(0xFF4F4539),
    background = Color(0xFF181612),
    surface = Color(0xFF181612),
    onSurface = Color(0xFFE9E1D9),
)

@Composable
fun ReaderTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val colors = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        dark -> Dark
        else -> Light
    }
    MaterialTheme(colorScheme = colors, content = content)
}
