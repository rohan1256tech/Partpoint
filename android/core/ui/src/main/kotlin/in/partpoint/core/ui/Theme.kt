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
 * Partpoint brand: electric indigo (trust, technology) with a violet sweep, teal for stock and
 * availability, amber for deals. Change these in one place when the client's identity arrives.
 */
object BrandColors {
    val Indigo = Color(0xFF4338CA)
    val Violet = Color(0xFF7C3AED)
    val Teal = Color(0xFF0D9488)
    val Amber = Color(0xFFF59E0B)
    val Ink = Color(0xFF14162B)
}

/** The brand sweep, used on the logo, the home header and hero cards. */
val BrandGradient: Brush = Brush.linearGradient(listOf(BrandColors.Indigo, BrandColors.Violet))

private val Light = lightColorScheme(
    primary = BrandColors.Indigo,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE3E6FF),
    onPrimaryContainer = Color(0xFF1B1760),
    secondary = BrandColors.Teal,
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFD2F5EF),
    onSecondaryContainer = Color(0xFF053B36),
    tertiary = Color(0xFFB45309),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFFEF0C7),
    onTertiaryContainer = Color(0xFF4A2104),
    error = Color(0xFFC0262D),
    errorContainer = Color(0xFFFDE3E3),
    onErrorContainer = Color(0xFF5F1014),
    background = Color(0xFFF4F5FA),
    onBackground = BrandColors.Ink,
    surface = Color(0xFFF4F5FA),
    onSurface = BrandColors.Ink,
    surfaceVariant = Color(0xFFE7E9F3),
    onSurfaceVariant = Color(0xFF585D74),
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color.White,
    surfaceContainer = Color(0xFFEEF0F7),
    surfaceContainerHigh = Color(0xFFE8EAF3),
    surfaceContainerHighest = Color(0xFFE1E4EF),
    outline = Color(0xFFC3C7D7),
    outlineVariant = Color(0xFFE2E4EE),
)

private val Dark = darkColorScheme(
    primary = Color(0xFFAEB6FF),
    onPrimary = Color(0xFF1B1760),
    primaryContainer = Color(0xFF3A33A8),
    onPrimaryContainer = Color(0xFFE3E6FF),
    secondary = Color(0xFF6EE7D6),
    onSecondary = Color(0xFF053B36),
    secondaryContainer = Color(0xFF11534D),
    onSecondaryContainer = Color(0xFFD2F5EF),
    tertiary = Color(0xFFFCD34D),
    onTertiary = Color(0xFF4A2104),
    tertiaryContainer = Color(0xFF6B3410),
    onTertiaryContainer = Color(0xFFFEF0C7),
    error = Color(0xFFFF8A8F),
    errorContainer = Color(0xFF7A1C21),
    onErrorContainer = Color(0xFFFDE3E3),
    background = Color(0xFF0C0E19),
    onBackground = Color(0xFFE6E8F4),
    surface = Color(0xFF0C0E19),
    onSurface = Color(0xFFE6E8F4),
    surfaceVariant = Color(0xFF2A2E44),
    onSurfaceVariant = Color(0xFFB5B9CE),
    surfaceContainerLowest = Color(0xFF080A12),
    surfaceContainerLow = Color(0xFF151829),
    surfaceContainer = Color(0xFF1A1D30),
    surfaceContainerHigh = Color(0xFF22263B),
    surfaceContainerHighest = Color(0xFF2B2F46),
    outline = Color(0xFF5A5F78),
    outlineVariant = Color(0xFF2E3249),
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
        headlineLarge = headlineLarge.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp),
        headlineMedium = headlineMedium.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.4).sp),
        headlineSmall = headlineSmall.copy(fontWeight = FontWeight.Bold, letterSpacing = (-0.2).sp),
        titleLarge = titleLarge.copy(fontWeight = FontWeight.SemiBold),
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
