package `in`.partpoint.app.shop

import `in`.partpoint.core.auth.push.NotificationPrompt
import `in`.partpoint.core.auth.push.RefreshOnOrderPush
import `in`.partpoint.core.ui.Load
import `in`.partpoint.core.ui.LoadingViewModel
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Receipt
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import `in`.partpoint.core.network.ApiException
import `in`.partpoint.core.network.apiCall
import `in`.partpoint.core.ui.ErrorState
import `in`.partpoint.core.ui.LoadingScreen
import `in`.partpoint.core.ui.MessageState
import `in`.partpoint.core.ui.SavingGreen
import `in`.partpoint.core.ui.StatusPill
import `in`.partpoint.core.ui.dateTime
import `in`.partpoint.core.ui.humanize
import `in`.partpoint.core.ui.orderStatusColor
import `in`.partpoint.core.ui.rupees
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject

// ------------------------------------------------------------------------------------- list

@HiltViewModel
class OrdersViewModel @Inject constructor(private val api: ShopApi) : LoadingViewModel<List<OrderSummary>>() {
    init {
        reload()
    }

    override suspend fun fetch() = api.orders().items
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OrdersScreen(onOrder: (String) -> Unit, onBrowse: () -> Unit, vm: OrdersViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.reload() } // fresh statuses whenever the tab is opened
    RefreshOnOrderPush { vm.reload(pullToRefresh = true) }
    Scaffold(topBar = { TopAppBar(title = { Text("My orders") }) }) { padding ->
        when (val s = state) {
            Load.Loading -> LoadingScreen()
            is Load.Failed -> ErrorState(s.message) { vm.reload() }
            is Load.Ready -> if (s.data.isEmpty()) {
                Box(Modifier.padding(padding)) {
                    MessageState(Icons.Outlined.Inventory2, "No orders yet", "Your orders and their delivery status will show up here.", "Start shopping" to onBrowse)
                }
            } else {
                PullToRefreshBox(isRefreshing = refreshing, onRefresh = { vm.reload(pullToRefresh = true) }, modifier = Modifier.padding(padding)) {
                    val (ongoing, past) = s.data.partition { it.status !in setOf("delivered", "cancelled") }
                    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
                        item { NotificationPrompt("retailer_orders", "Know when your parts are on the way", "Get a notification when the seller accepts, the rider picks up and your order arrives.") }
                        if (ongoing.isNotEmpty()) {
                            item { Text("In progress", style = MaterialTheme.typography.titleSmall) }
                            items(ongoing, key = { it.id }) { OrderRow(it) { onOrder(it.id) } }
                        }
                        if (past.isNotEmpty()) {
                            item { Text("Past orders", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp)) }
                            items(past, key = { it.id }) { OrderRow(it) { onOrder(it.id) } }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun OrderRow(o: OrderSummary, onClick: () -> Unit) {
    Card(onClick = onClick, shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(o.wholesaler.businessName, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                StatusPill(friendlyStatus(o.status), orderStatusColor(o.status))
            }
            Text("${o.itemCount} item(s) · ${rupees(o.totalPaise)}", style = MaterialTheme.typography.bodyMedium)
            Text("${o.orderNumber} · ${dateTime(o.createdAt)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** Retailer-facing wording for each status. */
fun friendlyStatus(status: String) = when (status) {
    "placed" -> "Waiting for seller"
    "accepted" -> "Accepted"
    "packed" -> "Packed"
    "assigned" -> "Rider assigned"
    "picked_up", "out_for_delivery" -> "On the way"
    "delivered" -> "Delivered"
    "cancelled" -> "Cancelled"
    else -> humanize(status)
}

// ------------------------------------------------------------------------------------- detail

@HiltViewModel
class OrderDetailViewModel @Inject constructor(
    private val api: ShopApi,
    @ApplicationContext private val context: Context,
    handle: SavedStateHandle,
) : LoadingViewModel<OrderDetail>() {
    val id: String = checkNotNull(handle["id"])

    init {
        reload()
    }

    override suspend fun fetch() = api.order(id)

    suspend fun cancel(reason: String?) {
        val updated = apiCall { api.cancelOrder(id, ReasonBody(reason)) }
        update { updated }
    }

    suspend fun rate(productId: String, rating: Int, comment: String?) = apiCall { api.review(id, productId, ReviewBody(rating, comment)) }

    /** Downloads the GST invoice into app storage and returns a shareable content:// URI. */
    suspend fun invoiceUri(orderNumber: String): Uri {
        val body = apiCall { api.invoice(id) }
        val file = withContext(Dispatchers.IO) {
            val dir = File(context.cacheDir, "invoices").apply { mkdirs() }
            File(dir, "$orderNumber.pdf").also { f -> body.byteStream().use { input -> f.outputStream().use { input.copyTo(it) } } }
        }
        return FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    }
}

private val STEPS = listOf("placed" to "Placed", "accepted" to "Accepted", "packed" to "Packed", "picked_up" to "On the way", "delivered" to "Delivered")
private fun stepIndex(status: String) = when (status) {
    "placed" -> 0
    "accepted" -> 1
    "packed", "assigned" -> 2
    "picked_up", "out_for_delivery" -> 3
    "delivered" -> 4
    else -> -1
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OrderDetailScreen(onBack: () -> Unit, onProduct: (String) -> Unit, vm: OrderDetailViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var confirmCancel by remember { mutableStateOf(false) }
    var invoiceBusy by remember { mutableStateOf(false) }
    RefreshOnOrderPush { vm.reload(pullToRefresh = true) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text((state as? Load.Ready)?.data?.orderNumber ?: "Order") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") } },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        when (val s = state) {
            Load.Loading -> LoadingScreen()
            is Load.Failed -> ErrorState(s.message) { vm.reload() }
            is Load.Ready -> PullToRefreshBox(isRefreshing = refreshing, onRefresh = { vm.reload(pullToRefresh = true) }, modifier = Modifier.padding(padding)) {
                val o = s.data
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(o.wholesaler.businessName, style = MaterialTheme.typography.titleMedium)
                            Text("Placed ${dateTime(o.createdAt)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        StatusPill(friendlyStatus(o.status), orderStatusColor(o.status))
                    }

                    if (o.status == "cancelled") {
                        Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.errorContainer) {
                            Text("Cancelled${o.cancelReason?.let { ": $it" } ?: ""}", modifier = Modifier.padding(12.dp), color = MaterialTheme.colorScheme.onErrorContainer)
                        }
                    } else {
                        Stepper(stepIndex(o.status))
                    }

                    if (o.deliveryOtp != null) DeliveryCode(o.deliveryOtp)

                    o.deliveryPartner?.let { rider ->
                        Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                            Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text("Delivery partner", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(rider.name, style = MaterialTheme.typography.bodyLarge)
                                }
                                if (rider.phone != null) {
                                    IconButton(onClick = { context.dial(rider.phone) }) { Icon(Icons.Outlined.Call, contentDescription = "Call ${rider.name}") }
                                }
                            }
                        }
                    }

                    Text("Items", style = MaterialTheme.typography.titleSmall)
                    o.items.forEach { i ->
                        ItemRow(i, delivered = o.status == "delivered", onProduct = onProduct) { rating, comment ->
                            try {
                                vm.rate(i.productId, rating, comment)
                                snackbar.showSnackbar("Thanks for rating ${i.productName}")
                                true
                            } catch (e: ApiException) {
                                snackbar.showSnackbar(e.message ?: "Couldn't save your rating")
                                false
                            }
                        }
                    }
                    HorizontalDivider()
                    MoneyRow("Items", o.subtotalPaise)
                    if (o.discountPaise > 0) MoneyRow("Coupon discount", -o.discountPaise, color = SavingGreen)
                    MoneyRow("Delivery", o.deliveryFeePaise, freeWhenZero = true)
                    MoneyRow("Total", o.totalPaise, bold = true)

                    Column {
                        Text("Delivering to", style = MaterialTheme.typography.titleSmall)
                        val a = o.address
                        Text("${a.contactName} · ${a.contactPhone}", style = MaterialTheme.typography.bodyMedium)
                        Text(listOfNotNull(a.line1, a.line2, a.landmark).joinToString(", ") + ", ${a.city} ${a.pincode}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (stepIndex(o.status) >= 2) {
                            OutlinedButton(
                                enabled = !invoiceBusy,
                                onClick = {
                                    scope.launch {
                                        invoiceBusy = true
                                        try {
                                            context.openPdf(vm.invoiceUri(o.orderNumber))
                                        } catch (e: ApiException) {
                                            snackbar.showSnackbar(e.message ?: "Couldn't download the invoice")
                                        } catch (_: ActivityNotFoundException) {
                                            snackbar.showSnackbar("Install a PDF viewer to open the invoice")
                                        } finally {
                                            invoiceBusy = false
                                        }
                                    }
                                },
                            ) {
                                Icon(Icons.Outlined.Receipt, null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(6.dp))
                                Text(if (invoiceBusy) "Downloading…" else "GST invoice")
                            }
                        }
                        if (o.status == "placed") { // the server allows retailer cancellation only before the seller accepts
                            TextButton(onClick = { confirmCancel = true }) { Text("Cancel order", color = MaterialTheme.colorScheme.error) }
                        }
                    }
                }
            }
        }
    }

    if (confirmCancel) {
        var reason by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { confirmCancel = false },
            title = { Text("Cancel this order?") },
            text = { OutlinedTextField(reason, { reason = it.take(300) }, label = { Text("Reason (optional)") }) },
            confirmButton = {
                TextButton(onClick = {
                    confirmCancel = false
                    scope.launch {
                        try {
                            vm.cancel(reason.trim().ifEmpty { null })
                            snackbar.showSnackbar("Order cancelled")
                        } catch (e: ApiException) {
                            snackbar.showSnackbar(e.message ?: "Couldn't cancel the order")
                        }
                    }
                }) { Text("Cancel order", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmCancel = false }) { Text("Keep order") } },
        )
    }
}

@Composable
private fun Stepper(current: Int) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        STEPS.forEachIndexed { i, (_, label) ->
            val done = i <= current
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f).height(2.dp)) {
                        if (i > 0) Surface(color = if (done) SavingGreen else MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.fillMaxSize()) {}
                    }
                    Surface(shape = CircleShape, color = if (done) SavingGreen else MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.size(22.dp)) {
                        if (done) Icon(Icons.Outlined.Check, null, tint = Color.White, modifier = Modifier.padding(3.dp))
                    }
                    Box(Modifier.weight(1f).height(2.dp)) {
                        if (i < STEPS.lastIndex) Surface(color = if (i < current) SavingGreen else MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.fillMaxSize()) {}
                    }
                }
                Text(
                    label,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = if (i == current) FontWeight.Bold else null,
                    color = if (done) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
    }
}

/** The code the retailer gives the rider at the door. Large and spaced so it's easy to read out. */
@Composable
private fun DeliveryCode(code: String) {
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.primaryContainer) {
        Column(Modifier.fillMaxWidth().padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("Delivery code", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onPrimaryContainer)
            Text(
                code.toCharArray().joinToString("  "),
                fontSize = 36.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.semantics { contentDescription = "Delivery code ${code.toCharArray().joinToString(" ")}" },
            )
            Text(
                "Give this code to the rider only after checking your parts.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
        }
    }
}

@Composable
private fun ItemRow(i: OrderItem, delivered: Boolean, onProduct: (String) -> Unit, rate: suspend (Int, String?) -> Boolean) {
    var rated by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                TextButton(onClick = { onProduct(i.productId) }, contentPadding = PaddingValues(0.dp)) {
                    Text(i.productName, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                }
                Text("${i.variantName} · ${i.qty} × ${rupees(i.unitPricePaise)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(rupees(i.lineTotalPaise), style = MaterialTheme.typography.bodyMedium)
        }
        if (delivered) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (rated > 0) "Your rating" else "Rate this part", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                (1..5).forEach { star ->
                    IconButton(onClick = {
                        val previous = rated
                        rated = star
                        scope.launch { if (!rate(star, null)) rated = previous }
                    }, modifier = Modifier.size(36.dp)) {
                        Icon(
                            if (star <= rated) Icons.Outlined.Star else Icons.Outlined.StarBorder,
                            contentDescription = "$star star${if (star > 1) "s" else ""}",
                            tint = if (star <= rated) Color(0xFFF59E0B) else MaterialTheme.colorScheme.outline,
                        )
                    }
                }
            }
        }
    }
}

fun Context.dial(phone: String) {
    startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

fun Context.openPdf(uri: Uri) {
    startActivity(
        Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/pdf")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
    )
}
