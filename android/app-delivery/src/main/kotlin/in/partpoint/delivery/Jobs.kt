package `in`.partpoint.delivery

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Directions
import androidx.compose.material.icons.outlined.DeliveryDining
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material.icons.outlined.Store
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.partpoint.core.network.ApiException
import `in`.partpoint.core.network.apiCall
import `in`.partpoint.core.ui.ErrorState
import `in`.partpoint.core.ui.Load
import `in`.partpoint.core.ui.LoadingScreen
import `in`.partpoint.core.ui.LoadingViewModel
import `in`.partpoint.core.ui.MessageState
import `in`.partpoint.core.ui.PrimaryButton
import `in`.partpoint.core.ui.SavingGreen
import `in`.partpoint.core.ui.SecureScreen
import `in`.partpoint.core.ui.StatusPill
import `in`.partpoint.core.ui.orderStatusColor
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

fun riderStatus(status: String, accepted: Boolean = true) = when {
    status == "assigned" && !accepted -> "New offer"
    status == "assigned" -> "Go to pickup"
    status == "picked_up" -> "Picked up"
    status == "out_for_delivery" -> "Delivering"
    status == "delivered" -> "Delivered"
    status == "cancelled" -> "Cancelled"
    else -> status
}

// ------------------------------------------------------------------------------------- home (jobs)

data class Home(val online: Boolean, val jobs: List<Job>)

@HiltViewModel
class JobsViewModel @Inject constructor(private val api: DeliveryApi) : LoadingViewModel<Home>() {
    private val _toggling = MutableStateFlow(false)
    val toggling: StateFlow<Boolean> = _toggling.asStateFlow()

    init {
        reload()
    }

    /** A rider has only a few active jobs; their details carry accepted state, pickup and drop. */
    override suspend fun fetch(): Home = coroutineScope {
        val me = async { api.me() }
        val active = api.jobs(scope = "active").items
        val jobs = active.map { j -> async { api.job(j.id) } }.awaitAll()
        Home(me.await().profile?.isAvailable ?: false, jobs.sortedWith(compareByDescending<Job> { it.isOffer }.thenBy { it.createdAt }))
    }

    fun setOnline(online: Boolean, onError: (String) -> Unit) = viewModelScope.launch {
        _toggling.value = true
        try {
            val res = apiCall { api.setAvailability(Availability(online)) }
            update { it.copy(online = res.isAvailable) }
        } catch (e: ApiException) {
            onError(e.message ?: "Couldn't change availability")
        } finally {
            _toggling.value = false
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JobsScreen(onJob: (String) -> Unit, vm: JobsViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    val toggling by vm.toggling.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { vm.reload() }

    Scaffold(topBar = { TopAppBar(title = { Text("Partpoint Delivery", fontWeight = FontWeight.Bold) }) }, snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        when (val s = state) {
            Load.Loading -> LoadingScreen()
            is Load.Failed -> ErrorState(s.message) { vm.reload() }
            is Load.Ready -> PullToRefreshBox(isRefreshing = refreshing, onRefresh = { vm.reload(pullToRefresh = true) }, modifier = Modifier.padding(padding)) {
                val home = s.data
                LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxSize()) {
                    item {
                        Surface(
                            shape = RoundedCornerShape(20.dp),
                            color = if (home.online) SavingGreen.copy(alpha = 0.14f) else MaterialTheme.colorScheme.surfaceContainerHigh,
                        ) {
                            Row(Modifier.fillMaxWidth().padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(if (home.online) "You're online" else "You're offline", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                                    Text(
                                        if (home.online) "Partpoint can send you delivery jobs." else "Go online to get delivery jobs.",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Switch(
                                    checked = home.online,
                                    enabled = !toggling,
                                    onCheckedChange = { vm.setOnline(it) { msg -> scope.launch { snackbar.showSnackbar(msg) } } },
                                )
                            }
                        }
                    }
                    if (home.jobs.isEmpty()) {
                        item {
                            Column(Modifier.fillMaxWidth().padding(top = 48.dp)) {
                                MessageState(
                                    Icons.Outlined.DeliveryDining,
                                    "No jobs right now",
                                    if (home.online) "New jobs appear here and you'll get a notification. Pull down to refresh." else "Switch on to start getting jobs.",
                                )
                            }
                        }
                    } else {
                        item { Text("Your jobs", style = MaterialTheme.typography.titleSmall) }
                        items(home.jobs, key = { it.id }) { j -> JobCard(j) { onJob(j.id) } }
                    }
                }
            }
        }
    }
}

@Composable
private fun JobCard(j: Job, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = if (j.isOffer) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(j.orderNumber, style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
                StatusPill(riderStatus(j.status, j.deliveryAccepted), orderStatusColor(j.status))
            }
            Leg(Icons.Outlined.Storefront, "Pick up", j.pickup?.businessName ?: j.wholesaler.businessName.orEmpty(), j.pickup?.let { "${it.city} ${it.pincode}" })
            Leg(Icons.Outlined.Store, "Deliver to", j.retailer?.shopName ?: j.address.contactName.orEmpty(), "${j.address.city} ${j.address.pincode}")
            Text("${j.itemCount} item(s)", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun Leg(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, name: String, area: String?) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, modifier = Modifier.size(20.dp), tint = MaterialTheme.colorScheme.primary)
        Column(Modifier.padding(start = 10.dp)) {
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(listOfNotNull(name, area).joinToString(" · "), style = MaterialTheme.typography.bodyMedium)
        }
    }
}

// ------------------------------------------------------------------------------------- job (guided steps)

@HiltViewModel
class JobViewModel @Inject constructor(private val api: DeliveryApi, handle: SavedStateHandle) : LoadingViewModel<Job>() {
    private val id: String = checkNotNull(handle["id"])
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    init {
        reload()
    }

    override suspend fun fetch() = api.job(id)

    private fun step(onError: (String) -> Unit, call: suspend () -> Job) = viewModelScope.launch {
        _busy.value = true
        try {
            val j = apiCall { call() }
            update { j }
        } catch (e: ApiException) {
            onError(e.message ?: "Something went wrong")
        } finally {
            _busy.value = false
        }
    }

    fun accept(onError: (String) -> Unit) = step(onError) { api.accept(id) }
    fun pickup(onError: (String) -> Unit) = step(onError) { api.pickup(id) }
    fun startDelivery(onError: (String) -> Unit) = step(onError) { api.outForDelivery(id) }
    fun deliver(code: String, onError: (String) -> Unit) = step(onError) { api.deliver(id, OtpBody(code)) }

    fun decline(reason: String?, onDone: () -> Unit, onError: (String) -> Unit) = viewModelScope.launch {
        _busy.value = true
        try {
            apiCall { api.decline(id, DeclineBody(reason)) }
            onDone()
        } catch (e: ApiException) {
            onError(e.message ?: "Couldn't decline")
        } finally {
            _busy.value = false
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JobScreen(onBack: () -> Unit, vm: JobViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val showError: (String) -> Unit = { msg -> scope.launch { snackbar.showSnackbar(msg) } }
    var declining by remember { mutableStateOf(false) }
    val checked = remember { mutableStateListOf<Int>() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text((state as? Load.Ready)?.data?.orderNumber ?: "Job") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") } },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        when (val s = state) {
            Load.Loading -> LoadingScreen()
            is Load.Failed -> ErrorState(s.message) { vm.reload() }
            is Load.Ready -> {
                val j = s.data
                Column(Modifier.padding(padding).fillMaxSize()) {
                    Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        StepBanner(j)
                        val pickup = j.pickup
                        if (pickup != null && j.status in setOf("assigned", "picked_up")) {
                            PlaceCard("Pick up from", pickup.businessName ?: j.wholesaler.businessName.orEmpty(), pickup, context, highlight = j.status == "assigned" && j.deliveryAccepted)
                        }
                        PlaceCard("Deliver to", j.retailer?.shopName ?: j.address.contactName.orEmpty(), j.address, context, highlight = j.status == "picked_up" || j.status == "out_for_delivery")

                        if (j.status != "delivered") {
                            Text("Items (${j.itemCount})", style = MaterialTheme.typography.titleSmall)
                            j.items.forEachIndexed { i, item ->
                                val pickingUp = j.status == "assigned" && j.deliveryAccepted
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    if (pickingUp) {
                                        Checkbox(checked = i in checked, onCheckedChange = { if (it) checked.add(i) else checked.remove(i) })
                                    }
                                    Text("${item.qty} × ${item.productName} (${item.variantName})", style = MaterialTheme.typography.bodyMedium)
                                }
                            }
                            if (j.status == "assigned" && j.deliveryAccepted) {
                                Text("Tick each item as you check it, and collect the GST invoice with the parcel.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    ActionBar(j, busy, allChecked = checked.size >= j.items.size, vm, showError, onDecline = { declining = true })
                }
            }
        }
    }

    if (declining) {
        var reason by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { declining = false },
            title = { Text("Decline this job?") },
            text = { OutlinedTextField(reason, { reason = it.take(300) }, label = { Text("Reason (optional)") }) },
            confirmButton = {
                TextButton(onClick = {
                    declining = false
                    vm.decline(reason.trim().ifEmpty { null }, onDone = onBack, onError = showError)
                }) { Text("Decline") }
            },
            dismissButton = { TextButton(onClick = { declining = false }) { Text("Keep job") } },
        )
    }
}

@Composable
private fun StepBanner(j: Job) {
    val (title, body) = when {
        j.isOffer -> "New delivery job" to "Accept to confirm you'll pick this up, or decline so another rider gets it."
        j.status == "assigned" -> "Go to the pickup" to "Collect the parcel and invoice from the seller, then tap Picked up."
        j.status == "picked_up" -> "Parcel collected" to "Start the delivery when you leave for the retailer."
        j.status == "out_for_delivery" -> "Deliver the parcel" to "Hand it over, then ask the retailer for their 4-digit delivery code."
        j.status == "delivered" -> "Delivered" to "Well done. Your earning for this job has been added."
        else -> riderStatus(j.status) to ""
    }
    Surface(shape = RoundedCornerShape(16.dp), color = if (j.status == "delivered") SavingGreen.copy(alpha = 0.14f) else MaterialTheme.colorScheme.secondaryContainer) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            if (j.status == "delivered") Icon(Icons.Outlined.CheckCircle, null, tint = SavingGreen, modifier = Modifier.size(32.dp).padding(end = 8.dp))
            Column {
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                if (body.isNotEmpty()) Text(body, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
private fun PlaceCard(label: String, name: String, place: Place, context: Context, highlight: Boolean) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        border = if (highlight) androidx.compose.foundation.BorderStroke(2.dp, MaterialTheme.colorScheme.primary) else null,
    ) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(name, style = MaterialTheme.typography.titleMedium)
            Text(place.full(), style = MaterialTheme.typography.bodyMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
                FilledTonalButton(onClick = { context.navigateTo(place) }) {
                    Icon(Icons.Outlined.Directions, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Navigate")
                }
                place.phoneNumber()?.let { phone ->
                    OutlinedButton(onClick = { context.call(phone) }) {
                        Icon(Icons.Outlined.Call, null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Call")
                    }
                }
            }
        }
    }
}

@Composable
private fun ActionBar(j: Job, busy: Boolean, allChecked: Boolean, vm: JobViewModel, showError: (String) -> Unit, onDecline: () -> Unit) {
    if (j.status in setOf("delivered", "cancelled")) return
    Surface(tonalElevation = 3.dp, shadowElevation = 8.dp) {
        Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            when {
                j.isOffer -> Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton(onClick = onDecline, enabled = !busy) { Text("Decline") }
                    Column(Modifier.weight(1f)) { PrimaryButton("Accept job", onClick = { vm.accept(showError) }, loading = busy) }
                }
                j.status == "assigned" -> PrimaryButton(
                    if (allChecked) "Picked up" else "Tick all items to confirm pickup",
                    onClick = { vm.pickup(showError) },
                    enabled = allChecked,
                    loading = busy,
                )
                j.status == "picked_up" -> PrimaryButton("Start delivery", onClick = { vm.startDelivery(showError) }, loading = busy)
                j.status == "out_for_delivery" -> CodeEntry(busy) { code -> vm.deliver(code, showError) }
            }
        }
    }
}

/** The retailer reads out their code; a wrong code costs an attempt (5 at most), so the field is explicit. */
@Composable
private fun CodeEntry(busy: Boolean, onSubmit: (String) -> Unit) {
    SecureScreen()
    var code by rememberSaveable { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(
            value = code,
            onValueChange = { code = it.filter(Char::isDigit).take(4) },
            label = { Text("Retailer's 4-digit delivery code") },
            singleLine = true,
            textStyle = MaterialTheme.typography.headlineSmall.copy(letterSpacing = 12.sp, textAlign = TextAlign.Center),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            modifier = Modifier.fillMaxWidth(),
        )
        PrimaryButton("Confirm delivery", onClick = { onSubmit(code) }, enabled = code.length == 4, loading = busy)
    }
}

/** Opens Google Maps (or any maps app) with directions; no location permission needed in our app. */
fun Context.navigateTo(place: Place) {
    val destination = if (place.latitude != null && place.longitude != null) "${place.latitude},${place.longitude}" else place.full()
    val uri = Uri.parse("https://www.google.com/maps/dir/?api=1&destination=${Uri.encode(destination)}&travelmode=two-wheeler")
    try {
        startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: ActivityNotFoundException) {
        // No browser or maps app at all: nothing sensible to do.
    }
}

fun Context.call(phone: String) {
    try {
        startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: ActivityNotFoundException) {
    }
}

