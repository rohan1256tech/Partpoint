package `in`.partpoint.app.shop

import `in`.partpoint.core.ui.SecondaryButton
import androidx.compose.foundation.layout.imePadding
import `in`.partpoint.core.ui.Load
import `in`.partpoint.core.ui.LoadingViewModel
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.LocalOffer
import androidx.compose.material.icons.outlined.ShoppingCart
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.partpoint.core.network.ApiException
import `in`.partpoint.core.network.apiCall
import `in`.partpoint.core.ui.ErrorText
import `in`.partpoint.core.ui.LoadingScreen
import `in`.partpoint.core.ui.MessageState
import `in`.partpoint.core.ui.PrimaryButton
import `in`.partpoint.core.ui.QtyStepper
import `in`.partpoint.core.ui.RemoteImage
import `in`.partpoint.core.ui.SavingGreen
import `in`.partpoint.core.ui.rupees
import `in`.partpoint.core.ui.partIcon
import androidx.compose.foundation.clickable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

@HiltViewModel
class CartViewModel @Inject constructor(val store: CartStore) : ViewModel() {
    private val _loaded = MutableStateFlow(false)
    val loaded: StateFlow<Boolean> = _loaded.asStateFlow()
    private val _refreshing = MutableStateFlow(false)
    val refreshing: StateFlow<Boolean> = _refreshing.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    init {
        refresh(false)
    }

    fun refresh(pull: Boolean = true) = act(pull) { store.refresh() }
    fun setQty(variantId: String, qty: Int) = act { store.setQty(variantId, qty) }
    fun remove(variantId: String) = act { store.remove(variantId) }
    fun applyCoupon(code: String?) = act { store.applyCoupon(code) }
    fun dismissError() {
        _error.value = null
    }

    private fun act(pull: Boolean = false, block: suspend () -> Unit) = viewModelScope.launch {
        if (pull) _refreshing.value = true
        try {
            block()
        } catch (e: ApiException) {
            _error.value = e.message
        } finally {
            _loaded.value = true
            _refreshing.value = false
        }
    }
}

private fun issueText(line: CartLine): String? = when (line.issue) {
    "UNAVAILABLE" -> "No longer available. Remove it to continue."
    "OUT_OF_STOCK" -> if (line.stockQty > 0) "Only ${line.stockQty} left. Lower the quantity." else "Out of stock. Remove it to continue."
    "BELOW_MIN_QTY" -> "Minimum order is ${line.minOrderQty}."
    else -> null
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CartScreen(onBrowse: () -> Unit, onProduct: (String) -> Unit, onCheckout: () -> Unit, vm: CartViewModel = hiltViewModel()) {
    val cart by vm.store.cart.collectAsStateWithLifecycle()
    val coupon by vm.store.couponCode.collectAsStateWithLifecycle()
    val loaded by vm.loaded.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(error) {
        error?.let {
            snackbar.showSnackbar(it)
            vm.dismissError()
        }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text(if (cart.itemCount > 0) "Cart (${cart.itemCount})" else "Cart") }) },
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            if (cart.lines.isNotEmpty()) {
                Surface(color = MaterialTheme.colorScheme.surfaceContainerLow, shadowElevation = 12.dp) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(rupees(cart.totalPaise), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                            Text("Total incl. GST and delivery", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Button(onClick = onCheckout, enabled = cart.canCheckout, modifier = Modifier.height(52.dp)) { Text("Checkout") }
                    }
                }
            }
        },
    ) { padding ->
        when {
            !loaded -> LoadingScreen()
            cart.lines.isEmpty() -> Column(Modifier.padding(padding)) {
                MessageState(Icons.Outlined.ShoppingCart, "Your cart is empty", "Add displays, batteries, chargers and more at wholesale prices.", "Start shopping" to onBrowse)
            }
            else -> PullToRefreshBox(isRefreshing = refreshing, onRefresh = { vm.refresh() }, modifier = Modifier.padding(padding)) {
                LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxSize()) {
                    items(cart.lines, key = { it.variantId }) { line -> LineCard(line, vm, onProduct) }
                    if (cart.belowMinOrder) {
                        item {
                            Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.tertiaryContainer) {
                                Text(
                                    "Add ${rupees((cart.minOrderPaise - cart.subtotalPaise).coerceAtLeast(0))} more to reach the ${rupees(cart.minOrderPaise)} minimum order.",
                                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                                    style = MaterialTheme.typography.bodyMedium,
                                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                                )
                            }
                        }
                    }
                    item { CouponBox(coupon, cart, vm::applyCoupon) }
                    item { Totals(cart) }
                    if (!cart.canCheckout) {
                        item { Text("Fix the items marked above to continue.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
                    }
                }
            }
        }
    }
}

@Composable
private fun LineCard(line: CartLine, vm: CartViewModel, onProduct: (String) -> Unit) {
    Card(shape = RoundedCornerShape(18.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.Top) {
            RemoteImage(line.thumbnailUrl, Modifier.size(76.dp), corner = 14.dp, fallback = partIcon(line.productName))
            Column(Modifier.padding(start = 12.dp).weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(verticalAlignment = Alignment.Top) {
                    Text(
                        line.productName,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f).clickable(role = Role.Button) { onProduct(line.productId) },
                    )
                    IconButton(onClick = { vm.remove(line.variantId) }, modifier = Modifier.size(32.dp)) {
                        Icon(Icons.Outlined.Delete, contentDescription = "Remove ${line.productName}", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                Text("${line.variantName} · ${rupees(line.unitPricePaise)} each", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                issueText(line)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                    QtyStepper(line.qty, { vm.setQty(line.variantId, it) }, min = line.minOrderQty.coerceAtLeast(1), max = line.stockQty.coerceAtLeast(line.qty))
                    Spacer(Modifier.weight(1f))
                    Text(rupees(line.lineTotalPaise), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun CouponBox(applied: String?, cart: Cart, apply: (String?) -> Unit) {
    var code by rememberSaveable { mutableStateOf(applied ?: "") }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = code,
                onValueChange = { code = it.uppercase().filter { c -> c.isLetterOrDigit() }.take(20) },
                label = { Text("Coupon code") },
                leadingIcon = { Icon(Icons.Outlined.LocalOffer, null) },
                singleLine = true,
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
                modifier = Modifier.weight(1f),
            )
            if (cart.coupon != null) {
                TextButton(onClick = {
                    code = ""
                    apply(null)
                }) { Text("Remove") }
            } else {
                TextButton(onClick = { apply(code) }, enabled = code.length >= 3) { Text("Apply") }
            }
        }
        when {
            cart.coupon != null -> Text("${cart.coupon.code} applied: you save ${rupees(cart.coupon.discountPaise)}", color = SavingGreen, style = MaterialTheme.typography.bodyMedium)
            cart.couponError != null && applied != null -> Text(cart.couponError, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun Totals(cart: Cart) {
    Surface(shape = RoundedCornerShape(18.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Bill details", style = MaterialTheme.typography.titleSmall)
            MoneyRow("Items (${cart.itemCount})", cart.subtotalPaise)
            if (cart.discountPaise > 0) MoneyRow("Coupon discount", -cart.discountPaise, color = SavingGreen)
            MoneyRow("Delivery", cart.deliveryFeePaise, freeWhenZero = true)
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            MoneyRow("To pay", cart.totalPaise, bold = true)
            Text("Prices include GST. A GST invoice comes with your order.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
fun MoneyRow(label: String, paise: Long, bold: Boolean = false, freeWhenZero: Boolean = false, color: androidx.compose.ui.graphics.Color = androidx.compose.ui.graphics.Color.Unspecified) {
    Row {
        Text(label, style = if (bold) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Text(
            if (freeWhenZero && paise == 0L) "Free" else rupees(paise),
            style = if (bold) MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyMedium,
            fontWeight = if (bold) FontWeight.Bold else null,
            color = if (freeWhenZero && paise == 0L) SavingGreen else color,
        )
    }
}

// ------------------------------------------------------------------------------------- checkout

data class CheckoutData(val addresses: List<Address>)

@HiltViewModel
class CheckoutViewModel @Inject constructor(private val api: ShopApi, val cart: CartStore) : LoadingViewModel<CheckoutData>() {
    /** One key per checkout screen: a retry after a timeout returns the same orders, never duplicates. */
    private val idempotencyKey = "android-${UUID.randomUUID()}"

    init {
        reload()
    }

    override suspend fun fetch() = CheckoutData(api.addresses().items)

    /** Places the order with Sakshay Connect; returns it for the confirmation screen. */
    suspend fun place(addressId: String): PlacedOrder {
        val placed = apiCall { api.placeOrder(PlaceOrderBody(addressId, idempotencyKey, cart.couponCode.value)) }
        cart.clearLocal()
        return placed.orders.first()
    }

    suspend fun addAddress(input: AddressInput): Address {
        val a = apiCall { api.addAddress(input) }
        update { it.copy(addresses = it.addresses + a) }
        return a
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CheckoutScreen(onBack: () -> Unit, onPlaced: (PlacedOrder) -> Unit, vm: CheckoutViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val cart by vm.cart.cart.collectAsStateWithLifecycle()
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    var adding by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Checkout") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") } },
            )
        },
    ) { padding ->
        when (val s = state) {
            Load.Loading -> LoadingScreen()
            is Load.Failed -> `in`.partpoint.core.ui.ErrorState(s.message) { vm.reload() }
            is Load.Ready -> {
                val addresses = s.data.addresses
                LaunchedEffect(addresses) { if (selected == null) selected = (addresses.firstOrNull { it.isDefault } ?: addresses.firstOrNull())?.id }
                Column(Modifier.padding(padding).fillMaxSize().imePadding()) {
                    LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        item { Text("Deliver to", style = MaterialTheme.typography.titleMedium) }
                        items(addresses, key = { it.id }) { a ->
                            Surface(
                                shape = RoundedCornerShape(12.dp),
                                color = if (a.id == selected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f) else MaterialTheme.colorScheme.surfaceContainerLow,
                                modifier = Modifier.fillMaxWidth().selectable(selected = a.id == selected, role = Role.RadioButton) { selected = a.id },
                            ) {
                                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                    RadioButton(selected = a.id == selected, onClick = null)
                                    Column(Modifier.padding(start = 8.dp)) {
                                        Text("${a.label} · ${a.contactName}", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                                        Text(a.oneLine(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        Text(a.contactPhone, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                            }
                        }
                        item {
                            if (adding || addresses.isEmpty()) {
                                AddressForm(
                                    onSave = { input ->
                                        val a = vm.addAddress(input)
                                        selected = a.id
                                        adding = false
                                    },
                                    onCancel = if (addresses.isEmpty()) null else ({ adding = false }),
                                )
                            } else {
                                SecondaryButton(onClick = { adding = true }) { Text("Add a new address") }
                            }
                        }
                        item {
                            Text("Order summary", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
                        }
                        item { Totals(cart) }
                        item {
                            Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.secondaryContainer) {
                                Text(
                                    "Payment: pay on delivery or as agreed with Sakshay Connect. Online payment is coming soon.",
                                    style = MaterialTheme.typography.bodySmall,
                                    modifier = Modifier.padding(12.dp),
                                )
                            }
                        }
                    }
                    Surface(tonalElevation = 3.dp, shadowElevation = 8.dp) {
                        Column(Modifier.navigationBarsPadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            ErrorText(error)
                            PrimaryButton(
                                "Place order · ${rupees(cart.totalPaise)}",
                                enabled = selected != null && cart.canCheckout,
                                loading = busy,
                                onClick = {
                                    val addressId = selected ?: return@PrimaryButton
                                    scope.launch {
                                        busy = true
                                        error = null
                                        try {
                                            onPlaced(vm.place(addressId))
                                        } catch (e: ApiException) {
                                            error = e.message
                                        } finally {
                                            busy = false
                                        }
                                    }
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}

private val PINCODE = Regex("^[1-9]\\d{5}$")

/** Add or edit an address. [onSave] throws [ApiException] to show the server's message. */
@Composable
fun AddressForm(initial: Address? = null, onSave: suspend (AddressInput) -> Unit, onCancel: (() -> Unit)?) {
    var label by rememberSaveable { mutableStateOf(initial?.label ?: "Shop") }
    var name by rememberSaveable { mutableStateOf(initial?.contactName ?: "") }
    var phone by rememberSaveable { mutableStateOf(initial?.contactPhone?.removePrefix("+91") ?: "") }
    var line1 by rememberSaveable { mutableStateOf(initial?.line1 ?: "") }
    var landmark by rememberSaveable { mutableStateOf(initial?.landmark ?: "") }
    var city by rememberSaveable { mutableStateOf(initial?.city ?: "") }
    var stateName by rememberSaveable { mutableStateOf(initial?.state ?: "Maharashtra") }
    var pincode by rememberSaveable { mutableStateOf(initial?.pincode ?: "") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val phoneOk = `in`.partpoint.core.auth.PhoneNumber.normalize(phone) != null
    val valid = name.isNotBlank() && phoneOk && line1.isNotBlank() && city.isNotBlank() && stateName.isNotBlank() && PINCODE.matches(pincode)

    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(if (initial == null) "New address" else "Edit address", style = MaterialTheme.typography.titleSmall)
            Field("Label (e.g. Shop, Godown)", label) { label = it.take(30) }
            Field("Contact name", name, KeyboardCapitalization.Words) { name = it }
            Field("Mobile number", phone, keyboard = androidx.compose.ui.text.input.KeyboardType.Phone, error = if (phone.isNotEmpty() && !phoneOk) "Enter a 10-digit mobile number" else null) { phone = it.filter { c -> c.isDigit() }.take(10) }
            Field("Shop no., building, street", line1) { line1 = it }
            Field("Landmark (optional)", landmark) { landmark = it }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Field("City", city, KeyboardCapitalization.Words, modifier = Modifier.weight(1f)) { city = it }
                Field("PIN code", pincode, keyboard = androidx.compose.ui.text.input.KeyboardType.Number, modifier = Modifier.weight(1f), error = if (pincode.isNotEmpty() && !PINCODE.matches(pincode)) "6 digits" else null) {
                    pincode = it.filter { c -> c.isDigit() }.take(6)
                }
            }
            Field("State", stateName, KeyboardCapitalization.Words) { stateName = it }
            ErrorText(error)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (onCancel != null) SecondaryButton(onClick = onCancel) { Text("Cancel") }
                Button(
                    enabled = valid && !busy,
                    onClick = {
                        scope.launch {
                            busy = true
                            error = null
                            try {
                                onSave(
                                    AddressInput(
                                        label = label.trim().ifEmpty { "Shop" },
                                        contactName = name.trim(),
                                        contactPhone = phone,
                                        line1 = line1.trim(),
                                        landmark = landmark.trim().ifEmpty { null },
                                        city = city.trim(),
                                        state = stateName.trim(),
                                        pincode = pincode,
                                        isDefault = initial?.isDefault ?: false,
                                    ),
                                )
                            } catch (e: ApiException) {
                                error = e.message
                            } finally {
                                busy = false
                            }
                        }
                    },
                ) { Text("Save address") }
            }
        }
    }
}

@Composable
private fun Field(
    label: String,
    value: String,
    capitalization: KeyboardCapitalization = KeyboardCapitalization.Sentences,
    keyboard: androidx.compose.ui.text.input.KeyboardType = androidx.compose.ui.text.input.KeyboardType.Text,
    modifier: Modifier = Modifier.fillMaxWidth(),
    error: String? = null,
    onChange: (String) -> Unit,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        singleLine = true,
        isError = error != null,
        supportingText = error?.let { { Text(it) } },
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(capitalization = capitalization, keyboardType = keyboard),
        modifier = modifier,
    )
}

/** Shown after placing the order. */
@Composable
fun OrderPlacedScreen(orderNumber: String, totalPaise: Long, onViewOrders: () -> Unit, onContinue: () -> Unit) {
    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Surface(shape = androidx.compose.foundation.shape.CircleShape, color = SavingGreen.copy(alpha = 0.14f)) {
                Icon(Icons.Outlined.CheckCircle, null, tint = SavingGreen, modifier = Modifier.padding(18.dp).size(64.dp))
            }
            Text("Order placed", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(top = 20.dp))
            Text(
                "$orderNumber · ${rupees(totalPaise)}",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(top = 6.dp),
            )
            Text(
                "Sakshay Connect is confirming stock and will pack your order. We will notify you at every step, and you get a delivery code when it is on the way.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                modifier = Modifier.padding(top = 10.dp),
            )
            Spacer(Modifier.height(28.dp))
            PrimaryButton("Track my order", onClick = onViewOrders)
            TextButton(onClick = onContinue) { Text("Continue shopping") }
        }
    }
}
