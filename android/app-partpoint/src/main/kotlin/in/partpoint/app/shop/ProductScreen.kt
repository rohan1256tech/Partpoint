package `in`.partpoint.app.shop

import `in`.partpoint.core.ui.Load
import `in`.partpoint.core.ui.LoadingViewModel
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.ShoppingCart
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.partpoint.core.network.ApiException
import `in`.partpoint.core.network.apiCall
import `in`.partpoint.core.ui.BrandColors
import `in`.partpoint.core.ui.ErrorState
import `in`.partpoint.core.ui.partIcon
import `in`.partpoint.core.ui.LoadingScreen
import `in`.partpoint.core.ui.PriceLine
import `in`.partpoint.core.ui.QtyStepper
import `in`.partpoint.core.ui.RemoteImage
import `in`.partpoint.core.ui.SavingGreen
import `in`.partpoint.core.ui.date
import `in`.partpoint.core.ui.rupees
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ProductPage(val product: ProductDetail, val reviews: List<PublicReview>, val wishlisted: Boolean)

@HiltViewModel
class ProductViewModel @Inject constructor(
    private val api: ShopApi,
    val cart: CartStore,
    handle: SavedStateHandle,
) : LoadingViewModel<ProductPage>() {
    private val id: String = checkNotNull(handle["id"])

    init {
        reload()
        viewModelScope.launch { runCatching { cart.refresh() } }
    }

    override suspend fun fetch(): ProductPage = coroutineScope {
        val product = async { api.product(id) }
        val reviews = async { runCatching { api.productReviews(id).items }.getOrDefault(emptyList()) }
        val wished = async { runCatching { api.wishlist().items.any { it.id == id } }.getOrDefault(false) }
        ProductPage(product.await(), reviews.await(), wished.await())
    }

    suspend fun toggleWishlist(now: Boolean) {
        apiCall { if (now) api.addToWishlist(id) else api.removeFromWishlist(id) }
        update { it.copy(wishlisted = now) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProductScreen(onBack: () -> Unit, onOpenCart: () -> Unit, vm: ProductViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {},
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") } },
                actions = {
                    val page = (state as? Load.Ready)?.data
                    if (page != null) {
                        IconButton(onClick = {
                            scope.launch {
                                try {
                                    vm.toggleWishlist(!page.wishlisted)
                                } catch (e: ApiException) {
                                    snackbar.showSnackbar(e.message ?: "Couldn't update your wishlist")
                                }
                            }
                        }) {
                            if (page.wishlisted) {
                                Icon(Icons.Filled.Favorite, contentDescription = "Remove from wishlist", tint = Color(0xFFE11D48))
                            } else {
                                Icon(Icons.Outlined.FavoriteBorder, contentDescription = "Add to wishlist")
                            }
                        }
                    }
                    IconButton(onClick = onOpenCart) { Icon(Icons.Outlined.ShoppingCart, contentDescription = "Cart") }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        when (val s = state) {
            Load.Loading -> LoadingScreen()
            is Load.Failed -> ErrorState(s.message) { vm.reload() }
            is Load.Ready -> ProductBody(s.data, vm, Modifier.padding(padding), snackbar, onOpenCart)
        }
    }
}

@Composable
private fun ProductBody(
    page: ProductPage,
    vm: ProductViewModel,
    modifier: Modifier,
    snackbar: SnackbarHostState,
    onOpenCart: () -> Unit,
) {
    val p = page.product
    val variants = p.variants.filter { it.isActive }
    var selectedId by rememberSaveable { mutableStateOf(variants.firstOrNull { it.stockQty > 0 }?.id ?: variants.firstOrNull()?.id) }
    val selected = variants.firstOrNull { it.id == selectedId }
    val cart by vm.cart.cart.collectAsStateWithLifecycle()
    val inCart = selected?.let { v -> cart.lines.firstOrNull { it.variantId == v.id }?.qty } ?: 0
    var qty by remember(selectedId, inCart) { mutableIntStateOf(if (inCart > 0) inCart else selected?.minOrderQty ?: 1) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            Gallery(p.images.sortedBy { it.sortOrder }.map { it.url }, partIcon(p.name, p.category.name))
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (p.brand != null) Text(p.brand.name.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                Text(p.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                if (p.ratingCount > 0) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Star, null, tint = BrandColors.Amber, modifier = Modifier.size(18.dp))
                        Text(" %.1f · %d review%s".format(p.ratingAvg, p.ratingCount, if (p.ratingCount == 1) "" else "s"), style = MaterialTheme.typography.bodyMedium)
                    }
                }
                if (selected != null) {
                    PriceLine(selected.unitPriceAt(qty), selected.mrpPaise, large = true)
                    Text("Price includes GST (${p.gstRateBps / 100}%)", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }

                if (variants.size > 1) {
                    Text("Choose", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        variants.forEach { v ->
                            FilterChip(
                                selected = v.id == selectedId,
                                onClick = { selectedId = v.id },
                                label = { Text("${v.name} · ${rupees(v.pricePaise)}") },
                                enabled = v.stockQty > 0,
                            )
                        }
                    }
                }

                if (selected != null && selected.slabs.isNotEmpty()) BulkPrices(selected, qty)

                StockLine(selected)

                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.45f),
                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                ) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.Verified, null, tint = MaterialTheme.colorScheme.primary)
                        Column(Modifier.padding(start = 12.dp).weight(1f)) {
                            Text("Sold and delivered by Sakshay Connect", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                            Text("Checked before dispatch · GST invoice with every order", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }

                Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Details", style = MaterialTheme.typography.titleSmall)
                        val details = listOfNotNull(
                            p.partNumber?.let { "Part number" to it },
                            p.brand?.let { "Brand" to it.name },
                            "Category" to p.category.name,
                            p.hsnCode?.let { "HSN code" to it },
                        )
                        details.forEach { (k, v) ->
                            Row {
                                Text(k, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(0.4f))
                                Text(v, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(0.6f))
                            }
                        }
                        if (!p.description.isNullOrBlank()) {
                            HorizontalDivider(Modifier.padding(vertical = 4.dp), color = MaterialTheme.colorScheme.outlineVariant)
                            Text(p.description, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }

                if (page.reviews.isNotEmpty()) {
                    HorizontalDivider(Modifier.padding(vertical = 8.dp))
                    Text("Reviews", style = MaterialTheme.typography.titleMedium)
                    page.reviews.take(5).forEach { r ->
                        Column(Modifier.padding(vertical = 6.dp)) {
                            Text("★".repeat(r.rating) + "☆".repeat(5 - r.rating) + "  ${r.reviewerName} · ${date(r.createdAt)}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (!r.comment.isNullOrBlank()) Text(r.comment, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
                Spacer(Modifier.padding(8.dp))
            }
        }

        // Sticky buy bar
        if (selected != null) {
            Surface(tonalElevation = 3.dp, shadowElevation = 8.dp) {
                Row(
                    Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    QtyStepper(qty, { qty = it }, min = selected.minOrderQty, max = selected.stockQty.coerceAtLeast(selected.minOrderQty), enabled = selected.stockQty > 0 && !busy)
                    Button(
                        onClick = {
                            scope.launch {
                                busy = true
                                try {
                                    vm.cart.setQty(selected.id, qty)
                                    val r = snackbar.showSnackbar("${if (inCart > 0) "Cart updated" else "Added to cart"}: $qty × ${selected.name}", actionLabel = "View cart")
                                    if (r == SnackbarResult.ActionPerformed) onOpenCart()
                                } catch (e: ApiException) {
                                    snackbar.showSnackbar(e.message ?: "Couldn't add to cart")
                                } finally {
                                    busy = false
                                }
                            }
                        },
                        enabled = selected.stockQty > 0 && !busy && qty != inCart,
                        modifier = Modifier.weight(1f).padding(start = 4.dp),
                    ) {
                        Text(
                            when {
                                selected.stockQty <= 0 -> "Out of stock"
                                inCart > 0 && qty == inCart -> "In cart"
                                inCart > 0 -> "Update cart · ${rupees(selected.unitPriceAt(qty) * qty)}"
                                else -> "Add · ${rupees(selected.unitPriceAt(qty) * qty)}"
                            },
                        )
                    }
                }
            }
        }
    }

    LaunchedEffect(selectedId) { if (selected != null && qty < selected.minOrderQty) qty = selected.minOrderQty }
}

@Composable
private fun Gallery(urls: List<String>, fallback: androidx.compose.ui.graphics.vector.ImageVector) {
    if (urls.isEmpty()) {
        RemoteImage(null, Modifier.fillMaxWidth().aspectRatio(1.3f), corner = 0.dp, fallback = fallback)
        return
    }
    val pager = rememberPagerState { urls.size }
    Box {
        HorizontalPager(state = pager) { i ->
            RemoteImage(urls[i], Modifier.fillMaxWidth().aspectRatio(1.3f), corner = 0.dp, contentScale = androidx.compose.ui.layout.ContentScale.Fit, fallback = fallback)
        }
        if (urls.size > 1) {
            Surface(
                color = Color.Black.copy(alpha = 0.55f),
                shape = RoundedCornerShape(50),
                modifier = Modifier.align(Alignment.BottomEnd).padding(12.dp),
            ) {
                Text("${pager.currentPage + 1}/${urls.size}", color = Color.White, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp))
            }
        }
    }
}

/** Bulk-price tiers; the tier reached at the current quantity is highlighted. */
@Composable
private fun BulkPrices(v: Variant, qty: Int) {
    val tiers = listOf(v.minOrderQty to v.pricePaise) + v.slabs.sortedBy { it.minQty }.map { it.minQty to it.pricePaise }
    val reached = tiers.lastOrNull { qty >= it.first }?.first
    Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 4.dp)) {
        Text("Buy more, pay less", style = MaterialTheme.typography.titleSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            tiers.forEach { (minQty, price) ->
                val active = minQty == reached
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = if (active) SavingGreen.copy(alpha = 0.12f) else MaterialTheme.colorScheme.surfaceContainerLow,
                    border = if (active) androidx.compose.foundation.BorderStroke(1.5.dp, SavingGreen) else null,
                    modifier = Modifier.weight(1f),
                ) {
                    Column(Modifier.padding(10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(rupees(price), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                        Text("$minQty+ pcs", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

@Composable
private fun StockLine(v: Variant?) {
    val (text, color) = when {
        v == null -> return
        v.stockQty <= 0 -> "Out of stock" to MaterialTheme.colorScheme.error
        v.stockQty <= 10 -> "Only ${v.stockQty} left" to Color(0xFFC2410C)
        else -> "In stock, ready to ship" to SavingGreen
    }
    Text(
        text + if (v.minOrderQty > 1) " · minimum order ${v.minOrderQty}" else "",
        color = color,
        style = MaterialTheme.typography.bodyMedium,
        fontWeight = FontWeight.Medium,
    )
}
