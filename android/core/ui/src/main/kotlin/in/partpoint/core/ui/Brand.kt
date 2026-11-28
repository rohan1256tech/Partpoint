package `in`.partpoint.core.ui

import androidx.compose.foundation.Canvas
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
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** The business's public name and promise, shown in both apps. */
object Brand {
    const val NAME = "Sakshay Connect"
    const val DELIVERY_APP = "Sakshay Connect Delivery"
    const val TAGLINE = "Parts. Price. Fast Delivery."
}

/**
 * The Sakshay Connect mark: a yellow swoosh "S" sweeping under a phone outline on a black tile,
 * after the client's logo. Drawn in code so it is crisp at every size; the launcher icon uses
 * the same shapes.
 */
@Composable
fun BrandMark(modifier: Modifier = Modifier, size: Dp = 40.dp) {
    Canvas(modifier.size(size).semantics { contentDescription = Brand.NAME }) {
        val s = this.size.minDimension
        drawRoundRect(BrandColors.Ink, cornerRadius = CornerRadius(s * 0.26f))
        // Phone outline, top right.
        drawRoundRect(
            Color.White,
            topLeft = Offset(s * 0.50f, s * 0.15f),
            size = Size(s * 0.28f, s * 0.44f),
            cornerRadius = CornerRadius(s * 0.06f),
            style = Stroke(width = s * 0.055f),
        )
        // The swoosh S: two strokes that lean like the client's mark.
        val path = androidx.compose.ui.graphics.Path().apply {
            moveTo(s * 0.62f, s * 0.30f)
            cubicTo(s * 0.46f, s * 0.20f, s * 0.20f, s * 0.26f, s * 0.24f, s * 0.42f)
            cubicTo(s * 0.28f, s * 0.56f, s * 0.70f, s * 0.50f, s * 0.70f, s * 0.66f)
            cubicTo(s * 0.70f, s * 0.82f, s * 0.38f, s * 0.86f, s * 0.20f, s * 0.74f)
        }
        drawPath(path, BrandColors.Yellow, style = Stroke(width = s * 0.12f, cap = StrokeCap.Round))
        // Speed line.
        drawLine(BrandColors.Yellow, Offset(s * 0.16f, s * 0.86f), Offset(s * 0.46f, s * 0.86f), strokeWidth = s * 0.04f, cap = StrokeCap.Round)
    }
}

/**
 * Logo and name. On dark backgrounds "Connect" is yellow; on light ones it sits on a yellow
 * highlight so it stays readable. [suffix] adds a word, e.g. "Delivery" for the rider app.
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
                withStyle(SpanStyle(color = ink)) { append("Sakshay ") }
                withStyle(if (onDark) SpanStyle(color = BrandColors.Yellow) else SpanStyle(color = BrandColors.Ink, background = BrandColors.Yellow)) { append("Connect") }
                if (suffix != null) withStyle(SpanStyle(color = ink.copy(alpha = 0.7f), fontWeight = FontWeight.SemiBold)) { append(" $suffix") }
            },
            fontWeight = FontWeight.ExtraBold,
            fontStyle = FontStyle.Italic,
            fontSize = textSize,
            letterSpacing = (-0.3).sp,
            maxLines = 1,
        )
    }
}

/** First screen while the app restores the session: the brand on black, as in the client's artwork. */
@Composable
fun BrandSplash(subtitle: String = Brand.TAGLINE) {
    Box(Modifier.fillMaxSize().background(BrandGradient), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            BrandMark(size = 96.dp)
            Spacer(Modifier.height(20.dp))
            Wordmark(textSize = 32.sp, onDark = true, showMark = false)
            Text(subtitle, color = Color.White.copy(alpha = 0.85f), style = MaterialTheme.typography.titleMedium, fontStyle = FontStyle.Italic, modifier = Modifier.padding(top = 6.dp))
            Box(Modifier.padding(top = 10.dp).width(120.dp).height(3.dp).clip(RoundedCornerShape(2.dp)).background(BrandColors.Yellow))
            Spacer(Modifier.height(48.dp))
            CircularProgressIndicator(color = BrandColors.Yellow, strokeWidth = 2.5.dp, modifier = Modifier.size(28.dp))
        }
    }
}

/** The dark brand panel used as a hero: sign-in, approval wait, home header. */
@Composable
fun BrandHero(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(BrandGradient)) {
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

/** A section heading with an optional "See all" style action. */
@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier, action: Pair<String, () -> Unit>? = null) {
    Row(modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        if (action != null) TextButton(onClick = action.second) { Text(action.first) }
    }
}
