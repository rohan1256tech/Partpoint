package `in`.partpoint.core.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BatteryChargingFull
import androidx.compose.material.icons.outlined.BatteryFull
import androidx.compose.material.icons.outlined.Cable
import androidx.compose.material.icons.outlined.Headphones
import androidx.compose.material.icons.outlined.Layers
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.Power
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material.icons.outlined.Smartphone
import androidx.compose.material.icons.outlined.Speaker
import androidx.compose.material.icons.outlined.Usb
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.cos
import kotlin.math.sin

/** The business's public name and promise, shown in both apps. */
object Brand {
    const val NAME = "Sakshay Connect"
    const val DELIVERY_APP = "Sakshay Connect Delivery"
    const val TAGLINE = "Parts. Price. Fast Delivery."
}

/** Bundled, licence-free photos (Pexels, see core/ui/PHOTO_CREDITS.md). */
object BrandPhotos {
    val Repair = R.drawable.img_hero_repair
    val Parts = R.drawable.img_hero_parts
}

/**
 * The Sakshay Connect mark: an "S" drawn as one circuit trace joining two nodes (parts that
 * connect), in signal yellow on a black tile. Drawn in code so it is crisp at every size; the
 * launcher icon uses the same geometry.
 */
@Composable
fun BrandMark(
    modifier: Modifier = Modifier,
    size: Dp = 40.dp,
    tile: Color = BrandColors.Ink,
    trace: Color = BrandColors.Yellow,
    node: Color = Color.White,
) {
    Canvas(modifier.size(size).semantics { contentDescription = Brand.NAME }) {
        val s = this.size.minDimension
        drawRoundRect(tile, cornerRadius = CornerRadius(s * 0.27f))
        val r = s * 0.145f
        val cx = s * 0.5f
        val topY = s * 0.355f
        val bottomY = s * 0.645f
        val path = Path().apply {
            // Upper bowl: from the upper right, round the top and left, down to the centre.
            arcTo(Rect(cx - r, topY - r, cx + r, topY + r), -30f, -240f, true)
            // Lower bowl: from the centre, round the right and bottom, to the lower left.
            arcTo(Rect(cx - r, bottomY - r, cx + r, bottomY + r), -90f, 240f, false)
        }
        drawPath(path, trace, style = Stroke(width = s * 0.11f, cap = StrokeCap.Round))
        val a = Math.toRadians(30.0)
        val start = Offset(cx + r * cos(a).toFloat(), topY - r * sin(a).toFloat())
        val end = Offset(cx - r * cos(a).toFloat(), bottomY + r * sin(a).toFloat())
        drawCircle(node, radius = s * 0.068f, center = start)
        drawCircle(node, radius = s * 0.068f, center = end)
    }
}

/**
 * Logo and name: "Sakshay" heavy, "Connect" lighter, in the text colour of the background.
 * [suffix] adds a word, e.g. "Delivery" for the rider app.
 */
@Composable
fun Wordmark(
    modifier: Modifier = Modifier,
    markSize: Dp = 32.dp,
    textSize: TextUnit = 22.sp,
    onDark: Boolean = MaterialTheme.colorScheme.surface.luminance() < 0.5f,
    suffix: String? = null,
    showMark: Boolean = true,
) {
    val ink = if (onDark) Color.White else BrandColors.Ink
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        if (showMark) BrandMark(size = markSize)
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(color = ink, fontWeight = FontWeight.Black)) { append("Sakshay") }
                withStyle(SpanStyle(color = ink.copy(alpha = 0.78f), fontWeight = FontWeight.Medium)) { append(" Connect") }
                if (suffix != null) {
                    withStyle(SpanStyle(color = if (onDark) BrandColors.Yellow else ink.copy(alpha = 0.55f), fontWeight = FontWeight.SemiBold)) { append(" $suffix") }
                }
            },
            fontSize = textSize,
            letterSpacing = (-0.4).sp,
            maxLines = 1,
        )
    }
}

/** First screen while the app restores the session: the mark and name on black. */
@Composable
fun BrandSplash(subtitle: String = Brand.TAGLINE) {
    Box(Modifier.fillMaxSize().background(BrandGradient), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            BrandMark(size = 96.dp)
            Spacer(Modifier.height(22.dp))
            Wordmark(textSize = 30.sp, onDark = true, showMark = false)
            Text(subtitle, color = Color.White.copy(alpha = 0.7f), style = MaterialTheme.typography.titleSmall, letterSpacing = 1.sp, modifier = Modifier.padding(top = 8.dp))
            Spacer(Modifier.height(48.dp))
            CircularProgressIndicator(color = BrandColors.Yellow, strokeWidth = 2.5.dp, modifier = Modifier.size(28.dp))
        }
    }
}

/** A dark brand panel, optionally over a photo with a gradient so the text stays readable. */
@Composable
fun BrandHero(modifier: Modifier = Modifier, photo: Int? = null, content: @Composable () -> Unit) {
    Box(modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(BrandGradient)) {
        if (photo != null) {
            Image(painterResource(photo), contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize())
            Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.3f), Color.Black.copy(alpha = 0.88f)))))
        }
        Column(Modifier.padding(20.dp)) { content() }
    }
}

/**
 * Artwork for a part or accessory without a photo yet, chosen from its name or category, so
 * the catalog never looks like a wall of grey boxes.
 */
fun partIcon(vararg hints: String?): ImageVector {
    val text = hints.filterNotNull().joinToString(" ").lowercase()
    fun has(vararg words: String) = words.any { it in text }
    return when {
        has("power bank", "powerbank") -> Icons.Outlined.BatteryFull
        has("battery", "batteries") -> Icons.Outlined.BatteryChargingFull
        has("charging port", "port board", "flex", "connector") -> Icons.Outlined.Usb
        has("charger", "adapter", "adaptor") -> Icons.Outlined.Power
        has("cable", "cord") -> Icons.Outlined.Cable
        has("earphone", "earbud", "headphone", "headset", "audio", "neckband") -> Icons.Outlined.Headphones
        has("speaker", "ringer", "mic") -> Icons.Outlined.Speaker
        has("camera", "lens") -> Icons.Outlined.PhotoCamera
        has("tempered", "screen guard", "glass", "protector") -> Icons.Outlined.Layers
        has("cover", "case", "pouch") -> Icons.Outlined.Security
        has("back panel", "frame", "housing", "body") -> Icons.Outlined.PhoneAndroid
        has("display", "screen", "lcd", "oled", "touch", "combo") -> Icons.Outlined.Smartphone
        else -> Icons.Outlined.Memory
    }
}

/** A stable soft hue for [key] (a category or an action), as (tile colour, icon colour). */
@Composable
fun hueFor(key: String): Pair<Color, Color> {
    val (tint, icon) = CategoryHues[(key.hashCode() and 0x7fffffff) % CategoryHues.size]
    val dark = MaterialTheme.colorScheme.surface.luminance() < 0.5f
    return if (dark) icon.copy(alpha = 0.22f) to lerp(icon, Color.White, 0.5f) else tint to icon
}

/** A section heading with an optional "See all" style action. */
@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier, action: Pair<String, () -> Unit>? = null) {
    Row(modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        if (action != null) TextButton(onClick = action.second) { Text(action.first, color = MaterialTheme.colorScheme.onSurface) }
    }
}

/** Bottom bar tabs: a yellow pill behind the selected icon, its label in full contrast. */
@Composable
fun brandNavColors() = androidx.compose.material3.NavigationBarItemDefaults.colors(
    selectedIconColor = BrandColors.Ink,
    indicatorColor = BrandColors.Yellow,
    selectedTextColor = MaterialTheme.colorScheme.onSurface,
    unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
    unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
)
