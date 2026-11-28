package `in`.partpoint.core.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Sakshay Connect brand: signal yellow on near-black, as in the client's artwork. Yellow is for
 * calls to action and highlights; text stays black (light) or white (dark) so it is always
 * readable. Change these in one place if the identity changes.
 */
object BrandColors {
    val Yellow = Color(0xFFFFC51A)
    val YellowSoft = Color(0xFFFFF0BF)
    val Ink = Color(0xFF111114)
    val Charcoal = Color(0xFF26272D)
    /** Stock, savings, success. */
    val Green = Color(0xFF0E8A5A)
    /** Ratings and deal badges. */
    val Amber = Color(0xFFFFB020)
}

/** The dark brand panel behind the home header, splash and sign-in hero. */
val BrandGradient: Brush = Brush.linearGradient(listOf(Color(0xFF0B0B0D), Color(0xFF1F2026)))

/**
 * Soft hues for category tiles and quick actions: lively without washing the screen in one
 * colour. Each pair is (tint, icon colour).
 */
val CategoryHues: List<Pair<Color, Color>> = listOf(
    Color(0xFFE8F0FF) to Color(0xFF2F5FD0),
    Color(0xFFE6F6EE) to Color(0xFF13804F),
    Color(0xFFF1EAFE) to Color(0xFF6D3FD1),
    Color(0xFFFFEFE5) to Color(0xFFC2560F),
    Color(0xFFFFE9EF) to Color(0xFFC22F5B),
    Color(0xFFE3F5F7) to Color(0xFF0E7C86),
)

// Neutral, premium surfaces; yellow is kept for calls to action, the logo and small highlights.
private val Light = lightColorScheme(
    primary = BrandColors.Ink,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFF0F0F2),
    onPrimaryContainer = BrandColors.Ink,
    secondary = BrandColors.Green,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFEDEEF1),
    onSecondaryContainer = BrandColors.Ink,
    tertiary = Color(0xFF9A5B00),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFFFF4D6),
    onTertiaryContainer = Color(0xFF3D2600),
    error = Color(0xFFC0262D),
    errorContainer = Color(0xFFFDE7E7),
    onErrorContainer = Color(0xFF5F1014),
    background = Color(0xFFF6F7F9),
    onBackground = BrandColors.Ink,
    surface = Color(0xFFF6F7F9),
    onSurface = BrandColors.Ink,
    surfaceVariant = Color(0xFFECEDF0),
    onSurfaceVariant = Color(0xFF5E616B),
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color.White,
    surfaceContainer = Color(0xFFF1F2F5),
    surfaceContainerHigh = Color(0xFFEBECEF),
    surfaceContainerHighest = Color(0xFFE4E5E9),
    outline = Color(0xFFC7C9D0),
    outlineVariant = Color(0xFFE6E7EB),
)

private val Dark = darkColorScheme(
    primary = BrandColors.Yellow,
    onPrimary = BrandColors.Ink,
    primaryContainer = Color(0xFF26272C),
    onPrimaryContainer = Color(0xFFF2F2F4),
    secondary = Color(0xFF4ADE80),
    onSecondary = Color(0xFF05301C),
    secondaryContainer = Color(0xFF26272C),
    onSecondaryContainer = Color(0xFFF2F2F4),
    tertiary = Color(0xFFFCD34D),
    onTertiary = Color(0xFF3D2600),
    tertiaryContainer = Color(0xFF3A2E12),
    onTertiaryContainer = Color(0xFFFFF0C2),
    error = Color(0xFFFF8A8F),
    errorContainer = Color(0xFF5C1A1E),
    onErrorContainer = Color(0xFFFDE3E3),
    background = Color(0xFF0B0B0D),
    onBackground = Color(0xFFEDEDF0),
    surface = Color(0xFF0B0B0D),
    onSurface = Color(0xFFEDEDF0),
    surfaceVariant = Color(0xFF26272C),
    onSurfaceVariant = Color(0xFFA9ABB3),
    surfaceContainerLowest = Color(0xFF070708),
    surfaceContainerLow = Color(0xFF151619),
    surfaceContainer = Color(0xFF1A1B1F),
    surfaceContainerHigh = Color(0xFF212227),
    surfaceContainerHighest = Color(0xFF2A2B31),
    outline = Color(0xFF55575F),
    outlineVariant = Color(0xFF2A2B30),
)

private val BrandShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(32.dp),
)

private val BrandTypography = Typography().run {
    copy(
        headlineLarge = headlineLarge.copy(fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.5).sp),
        headlineMedium = headlineMedium.copy(fontWeight = FontWeight.ExtraBold, letterSpacing = (-0.4).sp),
        headlineSmall = headlineSmall.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.2).sp),
        titleLarge = titleLarge.copy(fontWeight = FontWeight.Bold),
        titleMedium = titleMedium.copy(fontWeight = FontWeight.SemiBold),
        titleSmall = titleSmall.copy(fontWeight = FontWeight.SemiBold),
        labelLarge = labelLarge.copy(fontWeight = FontWeight.SemiBold),
    )
}

/**
 * Shared theme for both apps. Uses the brand colours, not wallpaper-based dynamic colour, so
 * the apps look the same on every phone (and in Play Store screenshots).
 */
@Composable
fun PartpointTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val scheme: ColorScheme = if (darkTheme) Dark else Light
    MaterialTheme(colorScheme = scheme, shapes = BrandShapes, typography = BrandTypography, content = content)
}
