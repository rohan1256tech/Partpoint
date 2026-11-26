package `in`.partpoint.core.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** Brand blue; replace with the client's colours once the logo arrives. */
private val Brand = Color(0xFF1F6FD1)

private val Light = lightColorScheme(primary = Brand, secondary = Color(0xFF5A6B85), error = Color(0xFFB42318))
private val Dark = darkColorScheme(primary = Color(0xFF8DB8F2), secondary = Color(0xFFB8C4D9), error = Color(0xFFF97066))

/**
 * Shared theme for both apps. Uses the brand colours, not wallpaper-based dynamic colour, so
 * the apps look the same on every phone (and in Play Store screenshots).
 */
@Composable
fun PartpointTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val scheme: ColorScheme = if (darkTheme) Dark else Light
    MaterialTheme(colorScheme = scheme, content = content)
}
