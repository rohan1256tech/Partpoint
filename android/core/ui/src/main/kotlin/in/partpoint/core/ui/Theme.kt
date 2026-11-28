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
val BrandGradient: Brush = Brush.linearGradient(listOf(BrandColors.Ink, BrandColors.Charcoal))

private val Light = lightColorScheme(
    primary = BrandColors.Ink,
    onPrimary = BrandColors.Yellow,
    primaryContainer = Color(0xFFFFE07A),
    onPrimaryContainer = BrandColors.Ink,
    secondary = BrandColors.Green,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFFFE9A6),
    onSecondaryContainer = BrandColors.Ink,
    tertiary = Color(0xFFB45309),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFFEF0C7),
    onTertiaryContainer = Color(0xFF4A2104),
    error = Color(0xFFC0262D),
    errorContainer = Color(0xFFFDE3E3),
    onErrorContainer = Color(0xFF5F1014),
    background = Color(0xFFF6F6F3),
    onBackground = BrandColors.Ink,
    surface = Color(0xFFF6F6F3),
    onSurface = BrandColors.Ink,
    surfaceVariant = Color(0xFFECECE6),
    onSurfaceVariant = Color(0xFF5C5D63),
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color.White,
    surfaceContainer = Color(0xFFF0F0EB),
    surfaceContainerHigh = Color(0xFFEAEAE4),
    surfaceContainerHighest = Color(0xFFE3E3DC),
    outline = Color(0xFFC9C9C1),
    outlineVariant = Color(0xFFE5E5DE),
)

private val Dark = darkColorScheme(
    primary = BrandColors.Yellow,
    onPrimary = BrandColors.Ink,
    primaryContainer = Color(0xFF4A3B00),
    onPrimaryContainer = Color(0xFFFFE07A),
    secondary = Color(0xFF4ADE80),
    onSecondary = Color(0xFF05301C),
    secondaryContainer = Color(0xFF3D3200),
    onSecondaryContainer = Color(0xFFFFE07A),
    tertiary = Color(0xFFFCD34D),
    onTertiary = Color(0xFF4A2104),
    tertiaryContainer = Color(0xFF6B3410),
    onTertiaryContainer = Color(0xFFFEF0C7),
    error = Color(0xFFFF8A8F),
    errorContainer = Color(0xFF7A1C21),
    onErrorContainer = Color(0xFFFDE3E3),
    background = Color(0xFF0E0F12),
    onBackground = Color(0xFFEDEDE8),
    surface = Color(0xFF0E0F12),
    onSurface = Color(0xFFEDEDE8),
    surfaceVariant = Color(0xFF2C2D33),
    onSurfaceVariant = Color(0xFFB9BAC0),
    surfaceContainerLowest = Color(0xFF09090B),
    surfaceContainerLow = Color(0xFF17181C),
    surfaceContainer = Color(0xFF1C1D22),
    surfaceContainerHigh = Color(0xFF24252B),
    surfaceContainerHighest = Color(0xFF2D2E35),
    outline = Color(0xFF5D5E66),
    outlineVariant = Color(0xFF303138),
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
