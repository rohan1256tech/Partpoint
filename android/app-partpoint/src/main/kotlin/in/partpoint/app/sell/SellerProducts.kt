package `in`.partpoint.app.sell

import `in`.partpoint.core.ui.Load
import `in`.partpoint.core.ui.LoadingViewModel
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AddAPhoto
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.partpoint.app.shop.Brand
import `in`.partpoint.app.shop.Category
import `in`.partpoint.app.shop.ProductSummary
import `in`.partpoint.app.shop.ShopApi
import `in`.partpoint.core.network.ApiException
import `in`.partpoint.core.network.apiCall
import `in`.partpoint.core.ui.ErrorState
import `in`.partpoint.core.ui.LoadingScreen
import `in`.partpoint.core.ui.MessageState
import `in`.partpoint.core.ui.RemoteImage
import `in`.partpoint.core.ui.StatusPill
import `in`.partpoint.core.ui.rupees
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

private fun statusLabel(s: String) = when (s) {
    "active" -> "Live"
    "draft" -> "Draft"
    "hidden" -> "Hidden"
    "blocked" -> "Blocked"
    else -> s
}

private fun statusColor(s: String) = when (s) {
    "active" -> Color(0xFF15803D)
    "draft" -> Color(0xFF6B7280)
    "hidden" -> Color(0xFFB45309)
    else -> Color(0xFFB91C1C)
}

// ------------------------------------------------------------------------------------- list

@HiltViewModel
class SellerProductsViewModel @Inject constructor(private val api: SellerApi) : LoadingViewModel<List<ProductSummary>>() {
    init {
        reload()
    }

    override suspend fun fetch() = api.products(limit = 50).items
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SellerProductsScreen(onProduct: (String?) -> Unit, vm: SellerProductsViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    var filter by rememberSaveable { mutableStateOf<String?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(Unit) { vm.reload() }

    Scaffold(
        topBar = { TopAppBar(title = { Text("My products") }) },
        floatingActionButton = {
            ExtendedFloatingActionButton(onClick = { onProduct(null) }, icon = { Icon(Icons.Outlined.Add, null) }, text = { Text("Add product") })
        },
    ) { padding ->
        when (val s = state) {
            Load.Loading -> LoadingScreen()
            is Load.Failed -> ErrorState(s.message) { vm.reload() }
            is Load.Ready -> PullToRefreshBox(isRefreshing = refreshing, onRefresh = { vm.reload(pullToRefresh = true) }, modifier = Modifier.padding(padding)) {
                if (s.data.isEmpty()) {
                    MessageState(Icons.Outlined.Inventory2, "List your first product", "Add your parts with prices, stock and photos. Retailers can order as soon as you publish.", "Add product" to { onProduct(null) })
                } else {
                    val q = query.trim().lowercase()
                    val shown = s.data.filter { (filter == null || it.status == filter) && (q.isEmpty() || it.name.lowercase().contains(q) || it.partNumber?.lowercase()?.contains(q) == true) }
                    LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        item {
                            OutlinedTextField(
                                query,
                                { query = it },
                                placeholder = { Text("Search your products") },
                                leadingIcon = { Icon(Icons.Outlined.Search, null) },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        item {
                            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                val counts = s.data.groupingBy { it.status }.eachCount()
                                item { FilterChip(selected = filter == null, onClick = { filter = null }, label = { Text("All ${s.data.size}") }) }
                                listOf("active", "draft", "hidden", "blocked").filter { (counts[it] ?: 0) > 0 }.forEach { st ->
                                    item { FilterChip(selected = filter == st, onClick = { filter = if (filter == st) null else st }, label = { Text("${statusLabel(st)} ${counts[st]}") }) }
                                }
                            }
                        }
                        items(shown, key = { it.id }) { p -> SellerProductRow(p) { onProduct(p.id) } }
                    }
                }
            }
        }
    }
}

@Composable
private fun SellerProductRow(p: ProductSummary, onClick: () -> Unit) {
    Card(onClick = onClick, shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            RemoteImage(p.thumbnailUrl, Modifier.size(60.dp), corner = 10.dp)
            Column(Modifier.padding(start = 12.dp).weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(p.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(
                    listOfNotNull(p.minPricePaise?.let { "From ${rupees(it)}" }, "Stock ${p.totalStock}").joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = if (p.totalStock == 0) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (p.status == "blocked" && p.statusReason != null) Text("Blocked: ${p.statusReason}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
            StatusPill(statusLabel(p.status), statusColor(p.status))
        }
    }
}

// ------------------------------------------------------------------------------------- editor

data class EditorState(
    val draft: ProductDraft = ProductDraft(),
    val categories: List<Category> = emptyList(),
    val brands: List<Brand> = emptyList(),
    val loading: Boolean = true,
    val saving: Boolean = false,
    val uploading: Boolean = false,
    val loadError: String? = null,
    /** Shown once the seller has tried to save, so a fresh form isn't covered in errors. */
    val showProblems: Boolean = false,
)

@HiltViewModel
class ProductEditorViewModel @Inject constructor(
    private val api: SellerApi,
    private val shop: ShopApi,
    private val photos: PhotoUploader,
    handle: SavedStateHandle,
) : ViewModel() {
    private val initialId: String? = handle["id"]
    private val _state = MutableStateFlow(EditorState())
    val state: StateFlow<EditorState> = _state.asStateFlow()
    private val _messages = MutableStateFlow<String?>(null)
    val messages: StateFlow<String?> = _messages.asStateFlow()

    init {
        load()
    }

    fun load() = viewModelScope.launch {
        _state.update { it.copy(loading = true, loadError = null) }
        try {
            coroutineScope {
                val cats = async { apiCall { shop.categories().items } }
                val brands = async { runCatching { apiCall { shop.brands().items } }.getOrDefault(emptyList()) }
                val product = initialId?.let { id -> async { apiCall { api.product(id) } } }
                _state.update {
                    it.copy(
                        categories = cats.await(),
                        brands = brands.await(),
                        draft = product?.await()?.let(ProductDraft::from) ?: it.draft,
                        loading = false,
                    )
                }
            }
        } catch (e: ApiException) {
            _state.update { it.copy(loading = false, loadError = e.message) }
        }
    }

    fun edit(change: (ProductDraft) -> ProductDraft) = _state.update { it.copy(draft = change(it.draft)) }
    fun consumeMessage() {
        _messages.value = null
    }

    /** Saves everything; with [publish] also makes it live. New products are created as drafts first. */
    fun save(publish: Boolean, then: () -> Unit = {}) = viewModelScope.launch {
        val d = _state.value.draft
        if (d.problems().isNotEmpty()) {
            _state.update { it.copy(showProblems = true) }
            _messages.value = "Fix the highlighted problems first"
            return@launch
        }
        _state.update { it.copy(saving = true) }
        try {
            var product = if (d.id == null) {
                apiCall { api.create(d.toCreate()) }
            } else {
                apiCall { api.update(d.id, d.toPatch().toJson()) }
                var latest = apiCall { api.product(d.id) }
                for (v in d.variants) {
                    latest = if (v.id == null) apiCall { api.addVariant(d.id, v.toInput()) } else apiCall { api.updateVariant(v.id, v.toPatch()) }
                }
                latest
            }
            if (publish && product.status != "active") product = apiCall { api.publish(product.id) }
            _state.update { it.copy(draft = ProductDraft.from(product), saving = false, showProblems = false) }
            _messages.value = when {
                publish -> "Published: retailers can order it now"
                d.id == null -> "Saved as a draft. Add photos, then publish."
                else -> "Saved"
            }
            then()
        } catch (e: ApiException) {
            _state.update { it.copy(saving = false) }
            _messages.value = e.message
        }
    }

    fun hide() = viewModelScope.launch {
        val id = _state.value.draft.id ?: return@launch
        try {
            val p = apiCall { api.hide(id) }
            _state.update { it.copy(draft = ProductDraft.from(p)) }
            _messages.value = "Hidden from retailers"
        } catch (e: ApiException) {
            _messages.value = e.message
        }
    }

    fun addPhoto(uri: android.net.Uri) = viewModelScope.launch {
        val id = _state.value.draft.id ?: return@launch
        _state.update { it.copy(uploading = true) }
        try {
            val p = photos.upload(id, uri)
            _state.update { it.copy(draft = it.draft.copy(images = ProductDraft.from(p).images), uploading = false) }
        } catch (e: ApiException) {
            _state.update { it.copy(uploading = false) }
            _messages.value = if (e is ApiException.Http && e.code == "STORAGE_NOT_CONFIGURED") "Photo storage isn't set up on this server yet." else e.message
        }
    }

    fun removePhoto(imageId: String) = viewModelScope.launch {
        val id = _state.value.draft.id ?: return@launch
        try {
            val p = apiCall { api.removeImage(id, imageId) }
            _state.update { it.copy(draft = it.draft.copy(images = ProductDraft.from(p).images)) }
        } catch (e: ApiException) {
            _messages.value = e.message
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProductEditorScreen(onBack: () -> Unit, vm: ProductEditorViewModel = hiltViewModel()) {
    val s by vm.state.collectAsStateWithLifecycle()
    val message by vm.messages.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(message) {
        message?.let {
            snackbar.showSnackbar(it)
            vm.consumeMessage()
        }
    }
    val d = s.draft
    val problems = if (s.showProblems) d.problems() else emptyList()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(if (d.id == null) "New product" else "Edit product") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") } },
                actions = { if (d.id != null) StatusPill(statusLabel(d.status), statusColor(d.status), Modifier.padding(end = 12.dp)) },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            if (!s.loading && s.loadError == null && d.status != "blocked") {
                Surface(tonalElevation = 3.dp, shadowElevation = 8.dp) {
                    Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        if (d.status == "active") {
                            OutlinedButton(onClick = { vm.hide() }, enabled = !s.saving) { Text("Hide") }
                            Button(onClick = { vm.save(publish = false) }, enabled = !s.saving, modifier = Modifier.weight(1f)) { Text(if (s.saving) "Saving…" else "Save changes") }
                        } else {
                            OutlinedButton(onClick = { vm.save(publish = false) }, enabled = !s.saving) { Text("Save draft") }
                            Button(onClick = { vm.save(publish = true) }, enabled = !s.saving, modifier = Modifier.weight(1f)) { Text(if (s.saving) "Saving…" else "Publish") }
                        }
                    }
                }
            }
        },
    ) { padding ->
        when {
            s.loading -> LoadingScreen()
            s.loadError != null -> ErrorState(s.loadError!!) { vm.load() }
            else -> Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                if (d.status == "blocked") {
                    Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.errorContainer) {
                        Text("Blocked by Partpoint: ${d.statusReason ?: "contact support"}. Retailers can't see it.", modifier = Modifier.padding(12.dp), color = MaterialTheme.colorScheme.onErrorContainer)
                    }
                }
                if (problems.isNotEmpty()) {
                    Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.errorContainer) {
                        Column(Modifier.padding(12.dp)) { problems.forEach { Text("• $it", color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodyMedium) } }
                    }
                }

                Photos(d, s.uploading, onAdd = vm::addPhoto, onRemove = vm::removePhoto)

                Section("Details")
                Input("Product name", d.name, capitalization = KeyboardCapitalization.Sentences) { v -> vm.edit { it.copy(name = v.take(150)) } }
                CategoryPicker(s.categories, d.categoryId) { id -> vm.edit { it.copy(categoryId = id) } }
                BrandPicker(s.brands, d.brandId) { id -> vm.edit { it.copy(brandId = id) } }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Input("Part number (optional)", d.partNumber, Modifier.weight(1f), KeyboardCapitalization.Characters) { v -> vm.edit { it.copy(partNumber = v.take(60)) } }
                    Input("HSN code", d.hsnCode, Modifier.weight(1f), keyboard = KeyboardType.Number) { v -> vm.edit { it.copy(hsnCode = v.filter(Char::isDigit).take(8)) } }
                }
                Text("GST rate (prices include GST)", style = MaterialTheme.typography.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    GST_RATES.forEach { r -> FilterChip(selected = d.gstRateBps == r, onClick = { vm.edit { it.copy(gstRateBps = r) } }, label = { Text("${r / 100}%") }) }
                }
                OutlinedTextField(
                    d.description,
                    { v -> vm.edit { it.copy(description = v.take(5000)) } },
                    label = { Text("Description (fits which vehicles, material, warranty…)") },
                    minLines = 3,
                    modifier = Modifier.fillMaxWidth(),
                )

                Section("Options and prices")
                Text("Add one option per pack size or type, e.g. Single and Box of 10.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                d.variants.forEachIndexed { i, v ->
                    VariantCard(
                        v,
                        canRemove = v.id == null && d.variants.size > 1,
                        onChange = { nv -> vm.edit { p -> p.copy(variants = p.variants.toMutableList().also { it[i] = nv }) } },
                        onRemove = { vm.edit { p -> p.copy(variants = p.variants.toMutableList().also { it.removeAt(i) }) } },
                    )
                }
                if (d.variants.size < 20) {
                    OutlinedButton(onClick = { vm.edit { it.copy(variants = it.variants + VariantDraft()) } }) {
                        Icon(Icons.Outlined.Add, null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Add another option")
                    }
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun Section(title: String) = Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 4.dp))

@Composable
private fun Input(
    label: String,
    value: String,
    modifier: Modifier = Modifier.fillMaxWidth(),
    capitalization: KeyboardCapitalization = KeyboardCapitalization.None,
    keyboard: KeyboardType = KeyboardType.Text,
    prefix: String? = null,
    onChange: (String) -> Unit,
) {
    OutlinedTextField(
        value,
        onChange,
        label = { Text(label) },
        singleLine = true,
        prefix = prefix?.let { { Text(it) } },
        keyboardOptions = KeyboardOptions(capitalization = capitalization, keyboardType = keyboard),
        modifier = modifier,
    )
}

@Composable
private fun Photos(d: ProductDraft, uploading: Boolean, onAdd: (android.net.Uri) -> Unit, onRemove: (String) -> Unit) {
    // The system Photo Picker: no storage permission, the seller chooses exactly what to share.
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> uri?.let(onAdd) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Section("Photos")
        if (d.id == null) {
            Text("Save the product first, then add up to 8 photos.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            return
        }
        LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            items(d.images, key = { it.first }) { (id, url) ->
                Box {
                    RemoteImage(url, Modifier.size(96.dp), corner = 12.dp)
                    Surface(shape = RoundedCornerShape(50), color = Color.Black.copy(alpha = 0.6f), modifier = Modifier.align(Alignment.TopEnd).padding(4.dp)) {
                        IconButton(onClick = { onRemove(id) }, modifier = Modifier.size(28.dp)) { Icon(Icons.Outlined.Close, "Remove photo", tint = Color.White, modifier = Modifier.size(16.dp)) }
                    }
                }
            }
            if (d.images.size < 8) {
                item {
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = MaterialTheme.colorScheme.surfaceContainerHigh,
                        modifier = Modifier.size(96.dp).clickable(enabled = !uploading, role = Role.Button, onClickLabel = "Add photo") {
                            picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                        },
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            if (uploading) CircularProgressIndicator(Modifier.size(28.dp)) else Icon(Icons.Outlined.AddAPhoto, "Add photo")
                        }
                    }
                }
            }
        }
        Text("Clear photos on a plain background sell better. The first photo is shown in search.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun CategoryPicker(categories: List<Category>, selectedId: String?, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val all = categories.flatMap { top -> listOf(top to null) + top.children.map { it to top } }
    val selected = all.firstOrNull { it.first.id == selectedId }
    PickerField("Category", selected?.let { (c, parent) -> listOfNotNull(parent?.name, c.name).joinToString(" › ") } ?: "") { open = true }
    if (open) {
        AlertDialog(
            onDismissRequest = { open = false },
            title = { Text("Choose a category") },
            text = {
                LazyColumn {
                    categories.forEach { top ->
                        item { Text(top.name, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 12.dp, bottom = 4.dp)) }
                        val options = top.children.ifEmpty { listOf(top) }
                        items(options, key = { it.id }) { c ->
                            Text(
                                c.name,
                                style = MaterialTheme.typography.bodyLarge,
                                color = if (c.id == selectedId) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.fillMaxWidth().clickable(role = Role.Button) {
                                    onSelect(c.id)
                                    open = false
                                }.padding(vertical = 10.dp, horizontal = 8.dp),
                            )
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { open = false }) { Text("Close") } },
        )
    }
}

@Composable
private fun BrandPicker(brands: List<Brand>, selectedId: String?, onSelect: (String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    PickerField("Brand (optional)", brands.firstOrNull { it.id == selectedId }?.name ?: "") { open = true }
    if (open) {
        AlertDialog(
            onDismissRequest = { open = false },
            title = { Text("Choose a brand") },
            text = {
                LazyColumn {
                    item {
                        Text("No brand / unbranded", modifier = Modifier.fillMaxWidth().clickable(role = Role.Button) {
                            onSelect(null)
                            open = false
                        }.padding(vertical = 10.dp, horizontal = 8.dp))
                    }
                    items(brands, key = { it.id }) { b ->
                        Text(
                            b.name,
                            color = if (b.id == selectedId) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier.fillMaxWidth().clickable(role = Role.Button) {
                                onSelect(b.id)
                                open = false
                            }.padding(vertical = 10.dp, horizontal = 8.dp),
                        )
                    }
                }
            },
            confirmButton = { TextButton(onClick = { open = false }) { Text("Close") } },
        )
    }
}

@Composable
private fun PickerField(label: String, value: String, onClick: () -> Unit) {
    Box {
        OutlinedTextField(value, {}, label = { Text(label) }, readOnly = true, singleLine = true, placeholder = { Text("Tap to choose") }, modifier = Modifier.fillMaxWidth())
        // Covers the read-only field so the whole box opens the picker.
        Box(Modifier.matchParentSize().clickable(role = Role.Button, onClickLabel = "Choose $label", onClick = onClick))
    }
}

@Composable
private fun VariantCard(v: VariantDraft, canRemove: Boolean, onChange: (VariantDraft) -> Unit, onRemove: () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow), shape = RoundedCornerShape(14.dp)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Input("Option name", v.name, Modifier.weight(1f), KeyboardCapitalization.Sentences) { onChange(v.copy(name = it.take(80))) }
                if (canRemove) IconButton(onClick = onRemove) { Icon(Icons.Outlined.Delete, "Remove option") }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Input("MRP", v.mrp, Modifier.weight(1f), keyboard = KeyboardType.Decimal, prefix = "₹ ") { onChange(v.copy(mrp = it.filter { c -> c.isDigit() || c == '.' }.take(12))) }
                Input("Your price", v.price, Modifier.weight(1f), keyboard = KeyboardType.Decimal, prefix = "₹ ") { onChange(v.copy(price = it.filter { c -> c.isDigit() || c == '.' }.take(12))) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Input("Stock", v.stock, Modifier.weight(1f), keyboard = KeyboardType.Number) { onChange(v.copy(stock = it.filter(Char::isDigit).take(8))) }
                Input("Minimum order", v.minQty, Modifier.weight(1f), keyboard = KeyboardType.Number) { onChange(v.copy(minQty = it.filter(Char::isDigit).take(7))) }
            }
            Text("Bulk prices (optional)", style = MaterialTheme.typography.labelLarge)
            v.slabs.forEachIndexed { i, slab ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Input("From qty", slab.minQty, Modifier.weight(1f), keyboard = KeyboardType.Number) { q -> onChange(v.copy(slabs = v.slabs.toMutableList().also { it[i] = slab.copy(minQty = q.filter(Char::isDigit).take(7)) })) }
                    Input("Price each", slab.price, Modifier.weight(1f), keyboard = KeyboardType.Decimal, prefix = "₹ ") { p -> onChange(v.copy(slabs = v.slabs.toMutableList().also { it[i] = slab.copy(price = p.filter { c -> c.isDigit() || c == '.' }.take(12)) })) }
                    IconButton(onClick = { onChange(v.copy(slabs = v.slabs.toMutableList().also { it.removeAt(i) })) }) { Icon(Icons.Outlined.Close, "Remove bulk price") }
                }
            }
            if (v.slabs.size < 5) TextButton(onClick = { onChange(v.copy(slabs = v.slabs + SlabDraft())) }) { Text("+ Add a bulk price, e.g. 10+ at a lower price") }
            if (v.id != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("On sale", modifier = Modifier.weight(1f))
                    Switch(checked = v.isActive, onCheckedChange = { onChange(v.copy(isActive = it)) })
                }
            }
        }
    }
}
