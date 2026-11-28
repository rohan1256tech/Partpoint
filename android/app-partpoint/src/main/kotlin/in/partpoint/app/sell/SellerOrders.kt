package `in`.partpoint.app.sell

import `in`.partpoint.core.auth.push.NotificationPrompt
import `in`.partpoint.core.auth.push.RefreshOnOrderPush
import `in`.partpoint.core.ui.Load
import `in`.partpoint.core.ui.LoadingViewModel
import android.content.ActivityNotFoundException
import android.content.Context
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Receipt
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import `in`.partpoint.app.shop.MoneyRow
import `in`.partpoint.app.shop.OrderDetail
import `in`.partpoint.app.shop.OrderSummary
import `in`.partpoint.app.shop.dial
import `in`.partpoint.app.shop.openPdf
import `in`.partpoint.core.network.ApiException
import `in`.partpoint.core.network.apiCall
import `in`.partpoint.core.ui.ErrorState
import `in`.partpoint.core.ui.LoadingScreen
import `in`.partpoint.core.ui.MessageState
import `in`.partpoint.core.ui.PrimaryButton
import `in`.partpoint.core.ui.StatusPill
import `in`.partpoint.core.ui.dateTime
import `in`.partpoint.core.ui.humanize
import `in`.partpoint.core.ui.orderStatusColor
import `in`.partpoint.core.ui.rupees
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import javax.inject.Inject

/** The seller's work queue, by what they have to do next. */
enum class SellerTab(val label: String, val status: String?, val scope: Set<String>) {
    NEW("New", "forwarded", setOf("forwarded")),
    TO_PACK("To pack", "accepted", setOf("accepted")),
    READY("Ready for pickup", "packed", setOf("packed", "assigned")),
    ON_THE_WAY("On the way", null, setOf("picked_up", "out_for_delivery")),
    DONE("Done", null, setOf("delivered", "cancelled")),
}

fun sellerStatus(status: String) = when (status) {
    "forwarded" -> "New"
    "accepted" -> "To pack"
    "packed" -> "Waiting for rider"
    "assigned" -> "Rider assigned"
    "picked_up", "out_for_delivery" -> "On the way"
    else -> humanize(status)
}

@HiltViewModel
class SellerOrdersViewModel @Inject constructor(private val api: SellerApi) : LoadingViewModel<List<OrderSummary>>() {
    private val _counts = MutableStateFlow<Map<SellerTab, Int>>(emptyMap())
    val counts: StateFlow<Map<SellerTab, Int>> = _counts.asStateFlow()

    override suspend fun fetch(): List<OrderSummary> {
        // One page of recent orders covers the working queue; older history pages are rarely needed here.
        val all = api.orders(limit = 50).items
        _counts.value = SellerTab.entries.associateWith { t -> all.count { it.status in t.scope } }
        return all
    }

    init {
        reload()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SellerOrdersScreen(onOrder: (String) -> Unit, vm: SellerOrdersViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val counts by vm.counts.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf(SellerTab.NEW) }
    LaunchedEffect(Unit) { vm.reload() }
    RefreshOnOrderPush { vm.reload(pullToRefresh = true) }

    Scaffold(topBar = { TopAppBar(title = { Text("Orders") }) }) { padding ->
        Column(Modifier.padding(padding)) {
            NotificationPrompt("seller_orders", "Don't miss a new order", "Retailers are waiting once they order. Turn on notifications to hear about new orders right away.", Modifier.padding(16.dp))
            PrimaryScrollableTabRow(selectedTabIndex = tab.ordinal, edgePadding = 8.dp) {
                SellerTab.entries.forEach { t ->
                    val n = counts[t] ?: 0
                    Tab(selected = tab == t, onClick = { tab = t }, text = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(t.label)
                            if (n > 0 && t != SellerTab.DONE) {
                                Spacer(Modifier.width(6.dp))
                                Badge(containerColor = if (t == SellerTab.NEW) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.secondary) { Text("$n") }
                            }
                        }
                    })
                }
            }
            when (val s = state) {
                Load.Loading -> LoadingScreen()
                is Load.Failed -> ErrorState(s.message) { vm.reload() }
                is Load.Ready -> PullToRefreshBox(isRefreshing = refreshing, onRefresh = { vm.reload(pullToRefresh = true) }) {
                    val list = s.data.filter { it.status in tab.scope }
                    if (list.isEmpty()) {
                        MessageState(Icons.Outlined.Inventory2, emptyTitle(tab), emptyBody(tab))
                    } else {
                        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
                            items(list, key = { it.id }) { o -> SellerOrderRow(o) { onOrder(o.id) } }
                        }
                    }
                }
            }
        }
    }
}

private fun emptyTitle(t: SellerTab) = when (t) {
    SellerTab.NEW -> "No new orders"
    SellerTab.TO_PACK -> "Nothing to pack"
    SellerTab.READY -> "Nothing waiting for pickup"
    SellerTab.ON_THE_WAY -> "Nothing on the way"
    SellerTab.DONE -> "No completed orders yet"
}

private fun emptyBody(t: SellerTab) = when (t) {
    SellerTab.NEW -> "New orders from retailers appear here. You'll get a notification too."
    SellerTab.TO_PACK -> "Orders you accept move here until you mark them packed."
    SellerTab.READY -> "Packed orders wait here until a delivery partner picks them up."
    SellerTab.ON_THE_WAY -> "Orders being delivered appear here."
    SellerTab.DONE -> "Delivered and cancelled orders are kept here."
}

@Composable
private fun SellerOrderRow(o: OrderSummary, onClick: () -> Unit) {
    Card(onClick = onClick, shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(o.retailer?.shopName ?: o.orderNumber, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                StatusPill(sellerStatus(o.status), orderStatusColor(o.status))
            }
            Text("${o.itemCount} item(s) to pack", style = MaterialTheme.typography.bodyMedium)
            Text("${o.orderNumber} · ${dateTime(o.createdAt)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

// ------------------------------------------------------------------------------------- detail

@HiltViewModel
class SellerOrderViewModel @Inject constructor(
    private val api: SellerApi,
    @ApplicationContext private val context: Context,
    handle: SavedStateHandle,
) : LoadingViewModel<OrderDetail>() {
    private val id: String = checkNotNull(handle["id"])
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    init {
        reload()
    }

    override suspend fun fetch() = api.order(id)

    fun act(onError: (String) -> Unit, call: suspend () -> OrderDetail) = viewModelScope.launch {
        _busy.value = true
        try {
            val updated = apiCall { call() }
            update { updated }
        } catch (e: ApiException) {
            onError(e.message ?: "Something went wrong")
        } finally {
            _busy.value = false
        }
    }

    fun accept(onError: (String) -> Unit) = act(onError) { api.accept(id) }
    fun pack(onError: (String) -> Unit) = act(onError) { api.pack(id) }
    /** The order goes back to Sakshay Connect (and out of this wholesaler's list), so the screen closes. */
    fun handBack(reason: String, onDone: () -> Unit, onError: (String) -> Unit) = viewModelScope.launch {
        _busy.value = true
        try {
            apiCall { api.reject(id, RejectBody(reason)) }
            onDone()
        } catch (e: ApiException) {
            onError(e.message ?: "Something went wrong")
        } finally {
            _busy.value = false
        }
    }

    suspend fun invoiceUri(orderNumber: String): Uri {
        val body = apiCall { api.invoice(id) }
        val file = withContext(Dispatchers.IO) {
            val dir = File(context.cacheDir, "invoices").apply { mkdirs() }
            File(dir, "$orderNumber.pdf").also { f -> body.byteStream().use { input -> f.outputStream().use { input.copyTo(it) } } }
        }
        return FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SellerOrderScreen(onBack: () -> Unit, vm: SellerOrderViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var rejecting by remember { mutableStateOf(false) }
    RefreshOnOrderPush { vm.reload(pullToRefresh = true) }
    val showError: (String) -> Unit = { msg -> scope.launch { snackbar.showSnackbar(msg) } }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text((state as? Load.Ready)?.data?.orderNumber ?: "Order") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") } },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            val o = (state as? Load.Ready)?.data ?: return@Scaffold
            if (o.status == "forwarded" || o.status == "accepted") {
                Surface(tonalElevation = 3.dp, shadowElevation = 8.dp) {
                    Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        OutlinedButton(onClick = { rejecting = true }, enabled = !busy) { Text("Can't supply") }
                        Box(Modifier.weight(1f)) {
                            if (o.status == "forwarded") {
                                PrimaryButton("Accept order", onClick = { vm.accept(showError) }, loading = busy)
                            } else {
                                PrimaryButton("Mark as packed", onClick = { vm.pack(showError) }, loading = busy)
                            }
                        }
                    }
                }
            }
        },
    ) { padding ->
        when (val s = state) {
            Load.Loading -> LoadingScreen()
            is Load.Failed -> ErrorState(s.message) { vm.reload() }
            is Load.Ready -> PullToRefreshBox(isRefreshing = false, onRefresh = { vm.reload(pullToRefresh = true) }, modifier = Modifier.padding(padding)) {
                val o = s.data
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(o.retailer?.shopName ?: "Retailer", style = MaterialTheme.typography.titleMedium)
                            Text("Placed ${dateTime(o.createdAt)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        StatusPill(sellerStatus(o.status), orderStatusColor(o.status))
                    }
                    NextStep(o)
                    if (o.status == "cancelled" && o.cancelReason != null) {
                        Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.errorContainer) {
                            Text("Cancelled: ${o.cancelReason}", modifier = Modifier.padding(12.dp), color = MaterialTheme.colorScheme.onErrorContainer)
                        }
                    }

                    Text(if (o.status in setOf("forwarded", "accepted")) "Items to pack" else "Items", style = MaterialTheme.typography.titleSmall)
                    o.items.forEach { i ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Surface(shape = RoundedCornerShape(8.dp), color = MaterialTheme.colorScheme.primaryContainer) {
                                Text("${i.qty}×", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp))
                            }
                            Column(Modifier.padding(start = 12.dp).weight(1f)) {
                                Text(i.productName, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                                val unit = i.supplyUnitPricePaise ?: i.unitPricePaise
                                Text("${i.variantName} · ${rupees(unit)} each", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Text(rupees((i.supplyUnitPricePaise ?: i.unitPricePaise) * i.qty), style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    HorizontalDivider()
                    MoneyRow("You receive", o.supplyTotalPaise ?: (o.subtotalPaise - o.discountPaise), bold = true)
                    Text("At your supply prices when Sakshay Connect sent you the order. Sakshay Connect arranges the delivery.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)

                    Column {
                        Text("Deliver to", style = MaterialTheme.typography.titleSmall)
                        // Sellers get only the delivery area; Sakshay Connect's rider has the full address.
                        Text(listOfNotNull(o.retailer?.shopName, "${o.address.city} ${o.address.pincode}").joinToString(", "), style = MaterialTheme.typography.bodyMedium)
                    }

                    o.deliveryPartner?.let { rider ->
                        Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                            Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text("Pickup by", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(rider.name + if (!o.deliveryAccepted) " (not confirmed yet)" else "", style = MaterialTheme.typography.bodyLarge)
                                }
                                if (rider.phone != null) TextButton(onClick = { context.dial(rider.phone) }) { Text("Call") }
                            }
                        }
                    }

                    if (o.status !in setOf("forwarded", "accepted", "cancelled")) {
                        OutlinedButton(onClick = {
                            scope.launch {
                                try {
                                    context.openPdf(vm.invoiceUri(o.orderNumber))
                                } catch (e: ApiException) {
                                    snackbar.showSnackbar(e.message ?: "Couldn't download the invoice")
                                } catch (_: ActivityNotFoundException) {
                                    snackbar.showSnackbar("Install a PDF viewer to open the invoice")
                                }
                            }
                        }) {
                            Icon(Icons.Outlined.Receipt, null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("GST invoice (print and pack it with the parts)")
                        }
                    }
                }
            }
        }
    }

    if (rejecting) {
        var reason by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { rejecting = false },
            title = { Text("Hand this order back?") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Sakshay Connect will send it to another wholesaler, and your stock for these items is restored. Tell us why so we can fix your stock list.")
                    OutlinedTextField(reason, { reason = it.take(300) }, label = { Text("Reason, e.g. stock damaged") })
                }
            },
            confirmButton = {
                Button(enabled = reason.isNotBlank(), onClick = {
                    rejecting = false
                    vm.handBack(reason.trim(), onDone = onBack, onError = showError)
                }) { Text("Hand back") }
            },
            dismissButton = { TextButton(onClick = { rejecting = false }) { Text("Keep order") } },
        )
    }
}

/** One plain sentence on what the seller should do now. */
@Composable
private fun NextStep(o: OrderDetail) {
    val text = when (o.status) {
        "forwarded" -> "Sakshay Connect chose your stock for this order. Check you have every item, then accept."
        "accepted" -> "Pack the items and mark the order packed. The GST invoice is created at that moment."
        "packed" -> "Packed. The order is offered to nearby delivery partners; one will come to collect it. Keep the parcel and invoice ready."
        "assigned" -> "A delivery partner is coming to pick this up. Keep the parcel and invoice ready."
        "picked_up", "out_for_delivery" -> "Picked up and on its way to the retailer."
        "delivered" -> "Delivered. The amount is added to your earnings."
        else -> return
    }
    Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.secondaryContainer) {
        Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.fillMaxWidth().padding(12.dp), color = MaterialTheme.colorScheme.onSecondaryContainer)
    }
}
