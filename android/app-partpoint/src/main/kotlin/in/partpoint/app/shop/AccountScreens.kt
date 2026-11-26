package `in`.partpoint.app.shop

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.partpoint.core.auth.Me
import `in`.partpoint.core.auth.PhoneNumber
import `in`.partpoint.core.auth.ui.AccountActions
import `in`.partpoint.core.network.ApiException
import `in`.partpoint.core.network.apiCall
import `in`.partpoint.core.ui.ErrorState
import `in`.partpoint.core.ui.LoadingScreen
import `in`.partpoint.core.ui.MessageState
import kotlinx.coroutines.launch
import javax.inject.Inject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountScreen(me: Me, onAddresses: () -> Unit, onWishlist: () -> Unit) {
    Scaffold(topBar = { TopAppBar(title = { Text("Account") }) }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(me.name, style = MaterialTheme.typography.titleLarge)
                    me.phone?.let { Text("+91 ${PhoneNumber.display(it)}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    me.email?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
            Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                Column {
                    ListItem(
                        headlineContent = { Text("Saved addresses") },
                        leadingContent = { Icon(Icons.Outlined.LocationOn, null) },
                        trailingContent = { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null) },
                        modifier = Modifier.clickableRow(onAddresses),
                    )
                    ListItem(
                        headlineContent = { Text("Wishlist") },
                        leadingContent = { Icon(Icons.Outlined.FavoriteBorder, null) },
                        trailingContent = { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null) },
                        modifier = Modifier.clickableRow(onWishlist),
                    )
                }
            }
            AccountActions()
        }
    }
}

private fun Modifier.clickableRow(onClick: () -> Unit) =
    this.then(Modifier.clickable(role = androidx.compose.ui.semantics.Role.Button, onClick = onClick))

// ------------------------------------------------------------------------------------- addresses

@HiltViewModel
class AddressesViewModel @Inject constructor(private val api: ShopApi) : LoadingViewModel<List<Address>>() {
    init {
        reload()
    }

    override suspend fun fetch() = api.addresses().items
    suspend fun save(id: String?, input: AddressInput) {
        apiCall { if (id == null) api.addAddress(input) else api.updateAddress(id, input) }
        reload()
    }

    suspend fun delete(id: String) {
        apiCall { api.deleteAddress(id) }
        update { list -> list.filterNot { it.id == id } }
    }

    suspend fun makeDefault(a: Address) = save(a.id, a.toInput().copy(isDefault = true))
}

fun Address.toInput() = AddressInput(label, contactName, contactPhone, line1, line2, landmark, city, state, pincode, isDefault)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddressesScreen(onBack: () -> Unit, vm: AddressesViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    var editing by rememberSaveable { mutableStateOf<String?>(null) } // address id, "new", or null
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    fun act(block: suspend () -> Unit) = scope.launch {
        try {
            block()
        } catch (e: ApiException) {
            snackbar.showSnackbar(e.message ?: "Something went wrong")
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Saved addresses") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") } },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        when (val s = state) {
            Load.Loading -> LoadingScreen()
            is Load.Failed -> ErrorState(s.message) { vm.reload() }
            is Load.Ready -> LazyColumn(Modifier.padding(padding), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (s.data.isEmpty() && editing == null) {
                    item { Box(Modifier.fillMaxWidth()) { MessageState(Icons.Outlined.LocationOn, "No saved addresses", "Add your shop address so checkout is one tap.") } }
                }
                items(s.data, key = { it.id }) { a ->
                    if (editing == a.id) {
                        AddressForm(a, onSave = { vm.save(a.id, it); editing = null }, onCancel = { editing = null })
                    } else {
                        Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceContainerLow) {
                            Column(Modifier.fillMaxWidth().padding(12.dp)) {
                                Text(a.label + if (a.isDefault) " · Default" else "", style = MaterialTheme.typography.titleSmall)
                                Text("${a.contactName} · ${a.contactPhone}", style = MaterialTheme.typography.bodyMedium)
                                Text(a.oneLine(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Row {
                                    TextButton(onClick = { editing = a.id }) { Text("Edit") }
                                    if (!a.isDefault) TextButton(onClick = { act { vm.makeDefault(a) } }) { Text("Make default") }
                                    TextButton(onClick = { act { vm.delete(a.id) } }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
                                }
                            }
                        }
                    }
                }
                item {
                    if (editing == "new") {
                        AddressForm(onSave = { vm.save(null, it); editing = null }, onCancel = { editing = null })
                    } else {
                        OutlinedButton(onClick = { editing = "new" }) { Text("Add a new address") }
                    }
                }
            }
        }
    }
}

// ------------------------------------------------------------------------------------- wishlist

@HiltViewModel
class WishlistViewModel @Inject constructor(private val api: ShopApi) : LoadingViewModel<List<ProductSummary>>() {
    init {
        reload()
    }

    override suspend fun fetch() = api.wishlist().items
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WishlistScreen(onBack: () -> Unit, onProduct: (String) -> Unit, vm: WishlistViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.reload() }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Wishlist") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") } },
            )
        },
    ) { padding ->
        when (val s = state) {
            Load.Loading -> LoadingScreen()
            is Load.Failed -> ErrorState(s.message) { vm.reload() }
            is Load.Ready -> if (s.data.isEmpty()) {
                Box(Modifier.padding(padding)) { MessageState(Icons.Outlined.FavoriteBorder, "Nothing saved yet", "Tap the heart on a product to keep it here for later.") }
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(160.dp),
                    contentPadding = PaddingValues(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.padding(padding),
                ) {
                    items(s.data, key = { it.id }) { p -> ProductCard(p) { onProduct(p.id) } }
                }
            }
        }
    }
}
