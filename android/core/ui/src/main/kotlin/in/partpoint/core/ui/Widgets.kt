package `in`.partpoint.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
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

/**
 * A product or category photo. Without a photo (or while loading) it shows [fallback] artwork
 * on a soft brand tint, so cards still look intentional.
 */
@Composable
fun RemoteImage(
    url: String?,
    modifier: Modifier = Modifier,
    corner: Dp = 12.dp,
    contentScale: ContentScale = ContentScale.Crop,
    fallback: ImageVector = Icons.Outlined.Image,
) {
    val shape = RoundedCornerShape(corner)
    val scheme = MaterialTheme.colorScheme
    val placeholder: @Composable () -> Unit = {
        BoxWithConstraints(
            Modifier.fillMaxSize().background(
                Brush.linearGradient(listOf(scheme.surfaceContainerHigh, scheme.surfaceContainer)),
            ),
            contentAlignment = Alignment.Center,
        ) {
            Icon(fallback, contentDescription = null, tint = scheme.onSurfaceVariant.copy(alpha = 0.55f), modifier = Modifier.size(minOf(maxWidth, maxHeight) * 0.42f))
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
fun PriceLine(pricePaise: Long, mrpPaise: Long?, modifier: Modifier = Modifier, large: Boolean = false, showOff: Boolean = true) {
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
            if (showOff) Text("$off% off", style = MaterialTheme.typography.labelMedium, color = SavingGreen, fontWeight = FontWeight.SemiBold)
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
        if (action != null) SecondaryButton(onClick = action.second, modifier = Modifier.padding(top = 20.dp)) { Text(action.first) }
    }
}

@Composable
fun ErrorState(message: String, onRetry: () -> Unit) =
    MessageState(Icons.Outlined.CloudOff, "Couldn't load this", message, "Try again" to onRetry)

/** A small rounded status label, e.g. order status. */
@Composable
fun StatusPill(text: String, color: Color, modifier: Modifier = Modifier) {
    // Status colours are tuned for light mode; lighten them on dark surfaces so the text stays readable.
    val dark = MaterialTheme.colorScheme.surface.luminance() < 0.5f
    val ink = if (dark) lerp(color, Color.White, 0.45f) else color
    Surface(modifier, shape = RoundedCornerShape(50), color = color.copy(alpha = if (dark) 0.22f else 0.14f)) {
        Text(
            text,
            color = ink,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp),
        )
    }
}

/** Order status → colour, shared by both apps. */
fun orderStatusColor(status: String): Color = when (status) {
    "placed" -> Color(0xFFB7791F)
    "forwarded" -> Color(0xFFB7791F)
    "accepted" -> Color(0xFF0E7490)
    "packed" -> Color(0xFF6D28D9)
    "assigned", "picked_up", "out_for_delivery" -> Color(0xFFC2410C)
    "delivered" -> Color(0xFF15803D)
    else -> Color(0xFF6B7280)
}

/** "1 item", "3 items". */
fun itemsLabel(n: Int): String = if (n == 1) "1 item" else "$n items"
