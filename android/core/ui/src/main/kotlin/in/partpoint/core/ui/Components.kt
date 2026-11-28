package `in`.partpoint.core.ui

import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import android.app.Activity
import android.view.WindowManager
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** Full-width primary action with a built-in loading state (no double taps while busy). */
@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, loading: Boolean = false) {
    // The brand call to action: yellow with black text, in light and dark mode alike.
    Button(
        onClick = onClick,
        enabled = enabled && !loading,
        colors = androidx.compose.material3.ButtonDefaults.buttonColors(containerColor = BrandColors.Yellow, contentColor = BrandColors.Ink),
        modifier = modifier.fillMaxWidth().heightIn(min = 52.dp),
    ) {
        if (loading) {
            CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp, color = BrandColors.Ink)
        } else {
            Text(text)
        }
    }
}

/** An error message that screen readers announce when it appears. */
@Composable
fun ErrorText(message: String?, modifier: Modifier = Modifier) {
    if (message == null) return
    Text(
        message,
        color = MaterialTheme.colorScheme.error,
        style = MaterialTheme.typography.bodyMedium,
        modifier = modifier.semantics { liveRegion = LiveRegionMode.Polite },
    )
}

@Composable
fun LoadingScreen() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
}

/** Standard padded screen column. */
@Composable
fun ScreenColumn(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Surface(Modifier.fillMaxSize()) {
        Column(
            // Scrolls, and stays clear of the keyboard (the apps draw edge to edge).
            modifier = modifier.fillMaxSize().statusBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) { content() }
    }
}

/**
 * Blocks screenshots and screen recording while this is on screen (README security: OTP and
 * payment screens use FLAG_SECURE). The flag is removed again when the screen leaves.
 */
@Composable
fun SecureScreen() {
    val activity = LocalContext.current as? Activity ?: return
    DisposableEffect(activity) {
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose { activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }
}

/**
 * While on screen, shows white status bar icons (for screens with a dark top, such as the home
 * header and the splash), and restores the theme's choice when the screen leaves.
 */
@Composable
fun LightStatusBarIcons() {
    val activity = LocalContext.current as? Activity ?: return
    val view = androidx.compose.ui.platform.LocalView.current
    DisposableEffect(activity) {
        val controller = androidx.core.view.WindowCompat.getInsetsController(activity.window, view)
        val before = controller.isAppearanceLightStatusBars
        controller.isAppearanceLightStatusBars = false
        onDispose { controller.isAppearanceLightStatusBars = before }
    }
}

/**
 * The second choice next to a [PrimaryButton]: outlined, in full-contrast text. (Material's own
 * outlined button uses muted grey text, which reads as disabled.)
 */
@Composable
fun SecondaryButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable androidx.compose.foundation.layout.RowScope.() -> Unit,
) {
    val scheme = androidx.compose.material3.MaterialTheme.colorScheme
    androidx.compose.material3.OutlinedButton(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        colors = androidx.compose.material3.ButtonDefaults.outlinedButtonColors(contentColor = scheme.onSurface),
        border = androidx.compose.foundation.BorderStroke(1.dp, if (enabled) scheme.outline else scheme.outlineVariant),
        content = content,
    )
}
