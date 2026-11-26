package `in`.partpoint.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.Remove
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil3.compose.SubcomposeAsyncImage

/** A product or category photo, with a neutral placeholder while loading or when there is none. */
@Composable
fun RemoteImage(url: String?, modifier: Modifier = Modifier, corner: Dp = 12.dp, contentScale: ContentScale = ContentScale.Crop) {
    val shape = RoundedCornerShape(corner)
    val placeholder: @Composable () -> Unit = {
        Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Image, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f))
        }
    }
    Box(modifier.clip(shape)) {
        if (url == null) {
            placeholder()
        } else {
            SubcomposeAsyncImage(
                model = url,
                contentDescription = null,
                contentScale = contentScale,
                modifier = Modifier.fillMaxSize(),
                loading = { placeholder() },
                error = { placeholder() },
            )
        }
    }
}

/** Selling price, with MRP struck through and the saving when there is one. */
@Composable
fun PriceLine(pricePaise: Long, mrpPaise: Long?, modifier: Modifier = Modifier, large: Boolean = false) {
    val off = discountPercent(mrpPaise, pricePaise)
    Row(modifier, verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            rupees(pricePaise),
            style = if (large) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
        )
        if (off != null && mrpPaise != null) {
            Text(
                rupees(mrpPaise),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textDecoration = TextDecoration.LineThrough,
                modifier = Modifier.semantics { contentDescription = "MRP ${rupees(mrpPaise)}" },
            )
            Text("$off% off", style = MaterialTheme.typography.labelMedium, color = SavingGreen, fontWeight = FontWeight.SemiBold)
        }
    }
}

/** Savings and success. Lighter in dark mode so it stays readable (WCAG AA on the dark surface). */
val SavingGreen: Color
    @Composable @ReadOnlyComposable
    get() = if (MaterialTheme.colorScheme.surface.luminance() < 0.5f) Color(0xFF4ADE80) else Color(0xFF15803D)

/** − qty + with large touch targets; [min] and [max] bound the value. */
@Composable
fun QtyStepper(qty: Int, onChange: (Int) -> Unit, modifier: Modifier = Modifier, min: Int = 1, max: Int = 100_000, enabled: Boolean = true) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        FilledTonalIconButton(onClick = { onChange(qty - 1) }, enabled = enabled && qty > min) {
            Icon(Icons.Outlined.Remove, contentDescription = "Decrease quantity")
        }
        Text(
            qty.toString(),
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(min = 32.dp).semantics { contentDescription = "Quantity $qty" },
        )
        FilledTonalIconButton(onClick = { onChange(qty + 1) }, enabled = enabled && qty < max) {
            Icon(Icons.Outlined.Add, contentDescription = "Increase quantity")
        }
    }
}

/** A friendly empty or error state with an optional action. */
@Composable
fun MessageState(icon: ImageVector, title: String, body: String? = null, action: Pair<String, () -> Unit>? = null, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Surface(shape = RoundedCornerShape(50), color = MaterialTheme.colorScheme.secondaryContainer) {
            Icon(icon, contentDescription = null, modifier = Modifier.padding(18.dp).size(32.dp), tint = MaterialTheme.colorScheme.onSecondaryContainer)
        }
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 16.dp))
        if (body != null) {
            Text(
                body,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 6.dp),
            )
        }
        if (action != null) OutlinedButton(onClick = action.second, modifier = Modifier.padding(top = 20.dp)) { Text(action.first) }
    }
}

@Composable
fun ErrorState(message: String, onRetry: () -> Unit) =
    MessageState(Icons.Outlined.CloudOff, "Couldn't load this", message, "Try again" to onRetry)

/** A small rounded status label, e.g. order status. */
@Composable
fun StatusPill(text: String, color: Color, modifier: Modifier = Modifier) {
    Surface(modifier, shape = RoundedCornerShape(50), color = color.copy(alpha = 0.14f)) {
        Text(
            text,
            color = color,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp),
        )
    }
}

/** Order status → colour, shared by both apps. */
fun orderStatusColor(status: String): Color = when (status) {
    "placed" -> Color(0xFF1F6FD1)
    "accepted" -> Color(0xFF0E7490)
    "packed" -> Color(0xFF6D28D9)
    "assigned", "picked_up", "out_for_delivery" -> Color(0xFFC2410C)
    "delivered" -> Color(0xFF15803D)
    else -> Color(0xFF6B7280)
}
