package `in`.partpoint.app.sell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.partpoint.app.shop.ProductDetail
import `in`.partpoint.app.shop.ProductSummary
import `in`.partpoint.app.shop.Variant
import `in`.partpoint.core.network.ApiException
import `in`.partpoint.core.network.apiCall
import `in`.partpoint.core.ui.ErrorState
import `in`.partpoint.core.ui.Load
import `in`.partpoint.core.ui.LoadingScreen
import `in`.partpoint.core.ui.LoadingViewModel
import `in`.partpoint.core.ui.MessageState
import `in`.partpoint.core.ui.PrimaryButton
import `in`.partpoint.core.ui.RemoteImage
import `in`.partpoint.core.ui.StatusPill
import `in`.partpoint.core.ui.partIcon
import `in`.partpoint.core.ui.rupees
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

// ------------------------------------------------------------------------------------- catalog list

data class StockListState(
    val items: List<ProductSummary> = emptyList(),
    val loading: Boolean = false,
    val refreshing: Boolean = false,
    val endReached: Boolean = false,
    val error: String? = null,
    val loaded: Boolean = false,
)

/** Sakshay Connect's catalog, for a wholesaler choosing what they can supply. */
@HiltViewModel
class StockViewModel @Inject constructor(private val api: SellerApi) : ViewModel() {
    private val _state = MutableStateFlow(StockListState())
    val state: StateFlow<StockListState> = _state.asStateFlow()
    private val query = MutableStateFlow("")
    private val mine = MutableStateFlow(true)
    val onlyMine: StateFlow<Boolean> = mine.asStateFlow()
    private var cursor: String? = null
    private var job: Job? = null

    init {
        @OptIn(FlowPreview::class)
        viewModelScope.launch {
            query.debounce(300).distinctUntilChanged().collect { restart() }
        }
    }

    fun onQuery(q: String) {
        query.value = q
    }

    fun showMine(only: Boolean) {
        mine.value = only
        restart()
    }

    fun restart(pull: Boolean = false) {
        job?.cancel()
        cursor = null
        _state.value = StockListState(refreshing = pull)
        loadMore()
    }

    fun loadMore() {
        val s = _state.value
        if (s.loading || s.endReached) return
        job = viewModelScope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                val q = query.value.trim().takeIf { it.length >= 2 }
                val page = apiCall { api.catalog(q = q, mine = if (mine.value) true else null, cursor = cursor) }
                cursor = page.nextCursor
                _state.update { it.copy(items = it.items + page.items, loading = false, refreshing = false, endReached = page.nextCursor == null, loaded = true) }
            } catch (e: ApiException) {
                _state.update { it.copy(loading = false, refreshing = false, error = e.message, loaded = true) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StockScreen(onProduct: (String) -> Unit, vm: StockViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val onlyMine by vm.onlyMine.collectAsStateWithLifecycle()
    var text by rememberSaveable { mutableStateOf("") }
    val list = rememberLazyListState()
    val nearEnd by remember { derivedStateOf { (list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= list.layoutInfo.totalItemsCount - 5 } }
    LaunchedEffect(list) { snapshotFlow { nearEnd }.distinctUntilChanged().filter { it }.collect { vm.loadMore() } }
    // Coming back from a product: show the stock just saved.
    LaunchedEffect(Unit) { if (state.loaded) vm.restart() }

    Scaffold(topBar = { TopAppBar(title = { Text("My stock") }) }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = text,
                    onValueChange = {
                        text = it
                        vm.onQuery(it)
                    },
                    placeholder = { Text("Search parts, models, brands", maxLines = 1) },
                    leadingIcon = { Icon(Icons.Outlined.Search, null) },
                    singleLine = true,
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = onlyMine, onClick = { vm.showMine(true) }, label = { Text("What I stock") })
                    FilterChip(selected = !onlyMine, onClick = { vm.showMine(false) }, label = { Text("Whole catalog") })
                }
            }
            PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = { vm.restart(pull = true) }, modifier = Modifier.weight(1f)) {
                LazyColumn(state = list, contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
                    item {
                        Text(
                            "Sakshay Connect sells these to retailers. Add your stock and the price you supply at; orders come to you when Sakshay Connect picks your stock.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    items(state.items, key = { it.id }) { p -> StockRow(p) { onProduct(p.id) } }
                    when {
                        state.loading && !state.refreshing -> item { Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
                        state.error != null -> item {
                            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(state.error ?: "", color = MaterialTheme.colorScheme.error)
                                TextButton(onClick = { vm.restart() }) { Text("Try again") }
                            }
                        }
                        state.loaded && state.items.isEmpty() -> item {
                            Box(Modifier.padding(top = 24.dp)) {
                                if (onlyMine && text.isBlank()) {
                                    MessageState(Icons.Outlined.Inventory2, "You have not added stock yet", "Open the whole catalog and add the parts you can supply.", "Browse the catalog" to { vm.showMine(false) })
                                } else {
                                    MessageState(Icons.Outlined.Search, "Nothing matches", "Try another name, model or part number.")
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StockRow(p: ProductSummary, onClick: () -> Unit) {
    val mine = p.myStockQty ?: 0
    Card(onClick = onClick, shape = RoundedCornerShape(18.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            RemoteImage(p.thumbnailUrl, Modifier.size(60.dp), corner = 14.dp, fallback = partIcon(p.name, p.categoryName))
            Column(Modifier.padding(start = 12.dp).weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(p.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(listOfNotNull(p.brandName, p.partNumber).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                p.minPricePaise?.let { Text("Sakshay Connect sells at ${rupees(it)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            if (mine > 0) {
                StatusPill("$mine in stock", MaterialTheme.colorScheme.secondary)
            } else {
                StatusPill("Add stock", MaterialTheme.colorScheme.primary)
            }
        }
    }
}

// ------------------------------------------------------------------------------------- one product

@HiltViewModel
class StockProductViewModel @Inject constructor(private val api: SellerApi, handle: SavedStateHandle) : LoadingViewModel<ProductDetail>() {
    private val id: String = checkNotNull(handle["id"])

    init {
        reload()
    }

    override suspend fun fetch() = api.product(id)

    suspend fun save(variantId: String, body: OfferBody) {
        val updated = apiCall { api.setOffer(variantId, body) }
        update { updated }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StockProductScreen(onBack: () -> Unit, vm: StockProductViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Your stock and price") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") } },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        when (val s = state) {
            Load.Loading -> LoadingScreen()
            is Load.Failed -> ErrorState(s.message) { vm.reload() }
            is Load.Ready -> {
                val p = s.data
                LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.padding(padding).fillMaxSize().imePadding(),
                ) {
                    item {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            RemoteImage(p.images.firstOrNull()?.url, Modifier.size(72.dp), corner = 16.dp, fallback = partIcon(p.name, p.category.name))
                            Column(Modifier.padding(start = 12.dp)) {
                                p.brand?.let { Text(it.name.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary) }
                                Text(p.name, style = MaterialTheme.typography.titleMedium)
                                Text(listOfNotNull(p.category.name, p.partNumber).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    if (!p.description.isNullOrBlank()) {
                        item { Text(p.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                    items(p.variants.filter { it.isActive }, key = { it.id }) { v -> OfferCard(v, vm, snackbar) }
                }
            }
        }
    }
}

@Composable
private fun OfferCard(v: Variant, vm: StockProductViewModel, snackbar: SnackbarHostState) {
    val offer = v.myOffer
    var price by rememberSaveable(v.id, offer) { mutableStateOf(offer?.supplyPricePaise?.let { paiseToText(it) } ?: "") }
    var stock by rememberSaveable(v.id, offer) { mutableStateOf(offer?.stockQty?.toString() ?: "") }
    var active by rememberSaveable(v.id, offer) { mutableStateOf(offer?.isActive ?: true) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val pricePaise = textToPaise(price)
    val stockQty = stock.toIntOrNull()
    val priceError = when {
        price.isBlank() -> null
        pricePaise == null || pricePaise <= 0 -> "Enter a price, e.g. 1650 or 1650.50"
        pricePaise > v.pricePaise -> "Above the Sakshay Connect price (${rupees(v.pricePaise)}): orders are unlikely to come to you"
        else -> null
    }
    val valid = pricePaise != null && pricePaise > 0 && stockQty != null
    val changed = offer == null || pricePaise != offer.supplyPricePaise || stockQty != offer.stockQty || active != offer.isActive

    Card(shape = RoundedCornerShape(18.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(v.name, style = MaterialTheme.typography.titleSmall)
                    Text(
                        "Sakshay Connect sells at ${rupees(v.pricePaise)} · MRP ${rupees(v.mrpPaise)}" + if (v.minOrderQty > 1) " · min ${v.minOrderQty}" else "",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (offer != null) Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Switch(checked = active, onCheckedChange = { active = it })
                    Text(if (active) "Selling" else "Paused", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = price,
                    onValueChange = { t -> price = t.filter { it.isDigit() || it == '.' }.take(10) },
                    label = { Text("Your price (₹)") },
                    singleLine = true,
                    isError = priceError != null && (pricePaise == null || pricePaise <= 0),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.weight(1f),
                )
                OutlinedTextField(
                    value = stock,
                    onValueChange = { t -> stock = t.filter { it.isDigit() }.take(7) },
                    label = { Text("In stock") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.weight(1f),
                )
            }
            priceError?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
            if (offer != null && !active) {
                Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh) {
                    Text("Paused: Sakshay Connect will not send you orders for this until you switch it on.", style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(10.dp))
                }
            }
            PrimaryButton(
                if (offer == null) "Add my stock" else "Save",
                enabled = valid && changed,
                loading = busy,
                onClick = {
                    scope.launch {
                        busy = true
                        try {
                            vm.save(v.id, OfferBody(pricePaise ?: return@launch, stockQty ?: 0, active))
                            snackbar.showSnackbar("Saved: ${stockQty ?: 0} × ${v.name} at ${rupees(pricePaise)}")
                        } catch (e: ApiException) {
                            snackbar.showSnackbar(e.message ?: "Could not save")
                        } finally {
                            busy = false
                        }
                    }
                },
            )
        }
    }
}

/** "1650.5" → 165050 paise; null when it is not a valid amount. */
internal fun textToPaise(text: String): Long? {
    val t = text.trim()
    if (!Regex("""^\d{1,8}(\.\d{0,2})?$""").matches(t)) return null
    val (rupees, decimals) = t.split('.').let { it[0] to it.getOrElse(1) { "" } }
    return rupees.toLong() * 100 + decimals.padEnd(2, '0').toLong()
}

internal fun paiseToText(paise: Long): String = if (paise % 100 == 0L) (paise / 100).toString() else "%d.%02d".format(paise / 100, paise % 100)
