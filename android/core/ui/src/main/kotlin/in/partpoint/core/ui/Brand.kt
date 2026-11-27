package `in`.partpoint.core.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The Partpoint mark: a phone outline on the brand sweep, with a glowing "point" where a part
 * clicks in. Drawn in code so it is crisp at every size; the launcher icon uses the same shapes.
 */
@Composable
fun BrandMark(modifier: Modifier = Modifier, size: Dp = 40.dp) {
    Canvas(modifier.size(size).semantics { contentDescription = "Partpoint" }) {
        val s = this.size.minDimension
        drawRoundRect(brush = BrandGradient, cornerRadius = CornerRadius(s * 0.28f))
        // Phone body.
        val w = s * 0.38f
        val h = s * 0.58f
        val left = s * 0.24f
        val top = (s - h) / 2
        drawRoundRect(
            color = Color.White,
            topLeft = Offset(left, top),
            size = Size(w, h),
            cornerRadius = CornerRadius(s * 0.08f),
            style = Stroke(width = s * 0.075f),
        )
        // Speaker slot.
        drawLine(
            Color.White,
            start = Offset(left + w * 0.36f, top + h * 0.15f),
            end = Offset(left + w * 0.64f, top + h * 0.15f),
            strokeWidth = s * 0.05f,
            cap = StrokeCap.Round,
        )
        // The point: a part docking into the phone.
        val c = Offset(left + w + s * 0.06f, top + h * 0.66f)
        drawCircle(Color.White, radius = s * 0.13f, center = c)
        drawCircle(BrandColors.Amber, radius = s * 0.06f, center = c)
    }
}

/** Logo and name, for headers and the sign-in screen. */
@Composable
fun Wordmark(modifier: Modifier = Modifier, markSize: Dp = 32.dp, textSize: TextUnit = 22.sp, color: Color = MaterialTheme.colorScheme.onSurface) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        BrandMark(size = markSize)
        Text("Partpoint", color = color, fontWeight = FontWeight.ExtraBold, fontSize = textSize, letterSpacing = (-0.4).sp)
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
