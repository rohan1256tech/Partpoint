package `in`.partpoint.app.shop

import `in`.partpoint.core.ui.Load
import `in`.partpoint.core.ui.LoadingViewModel
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.SearchOff
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.partpoint.core.network.ApiException
import `in`.partpoint.core.network.apiCall
import `in`.partpoint.core.ui.ErrorState
import `in`.partpoint.core.ui.LoadingScreen
import `in`.partpoint.core.ui.MessageState
import `in`.partpoint.core.ui.PriceLine
import `in`.partpoint.core.ui.RemoteImage
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

// ------------------------------------------------------------------------------------- home

data class HomeData(val banners: List<Banner>, val categories: List<Category>, val brands: List<Brand>)

@HiltViewModel
class HomeViewModel @Inject constructor(private val api: ShopApi, val feed: ProductFeed) : LoadingViewModel<HomeData>() {
    init {
        reload()
        feed.start(viewModelScope, ProductQuery())
    }

    override suspend fun fetch(): HomeData = coroutineScope {
        val banners = async { runCatching { api.banners().items }.getOrDefault(emptyList()) }
        val categories = async { api.categories().items }
        val brands = async { runCatching { api.brands().items }.getOrDefault(emptyList()) }
        HomeData(banners.await(), categories.await(), brands.await())
    }

    fun refreshAll() {
        reload(pullToRefresh = true)
        feed.restart()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(onSearch: () -> Unit, onCategory: (Category) -> Unit, onBrand: (Brand) -> Unit, onProduct: (String) -> Unit, vm: HomeViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    val feed by vm.feed.state.collectAsStateWithLifecycle()
    val grid = rememberLazyGridState()
    LoadMoreWhenNearEnd(grid) { vm.feed.loadMore() }

    Scaffold(topBar = { TopAppBar(title = { Text("Partpoint", fontWeight = FontWeight.Bold) }) }) { padding ->
        when (val s = state) {
            Load.Loading -> LoadingScreen()
            is Load.Failed -> ErrorState(s.message) { vm.reload() }
            is Load.Ready -> PullToRefreshBox(isRefreshing = refreshing, onRefresh = vm::refreshAll, modifier = Modifier.padding(padding)) {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(minSize = 160.dp),
                    state = grid,
                    contentPadding = PaddingValues(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    item(span = { GridItemSpan(maxLineSpan) }) { SearchBarButton(onSearch) }
                    if (s.data.banners.isNotEmpty()) {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            BannerCarousel(s.data.banners) { b ->
                                when (b.linkType) {
                                    "category" -> s.data.categories.flatMap { listOf(it) + it.children }.firstOrNull { it.id == b.linkValue }?.let(onCategory)
                                    "brand" -> s.data.brands.firstOrNull { it.id == b.linkValue }?.let(onBrand)
                                    "product" -> b.linkValue?.let(onProduct)
                                }
                            }
                        }
                    }
                    if (s.data.categories.isNotEmpty()) {
                        item(span = { GridItemSpan(maxLineSpan) }) { SectionTitle("Shop by category") }
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                items(s.data.categories, key = { it.id }) { c -> CategoryTile(c) { onCategory(c) } }
                            }
                        }
                    }
                    if (s.data.brands.isNotEmpty()) {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                items(s.data.brands, key = { it.id }) { b ->
                                    FilterChip(selected = false, onClick = { onBrand(b) }, label = { Text(b.name) })
                                }
                            }
                        }
                    }
                    item(span = { GridItemSpan(maxLineSpan) }) { SectionTitle("Products") }
                    productItems(feed, onProduct, onRetry = vm.feed::loadMore)
                }
            }
        }
    }
}

@Composable
private fun SearchBarButton(onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(28.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier.fillMaxWidth().height(52.dp),
    ) {
        Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Search, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.width(12.dp))
            Text("Search parts, part numbers, brands", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SectionTitle(text: String) = Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 8.dp))

@Composable
private fun BannerCarousel(banners: List<Banner>, onOpen: (Banner) -> Unit) {
    val pager = rememberPagerState { banners.size }
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        HorizontalPager(state = pager, pageSpacing = 12.dp) { page ->
            val b = banners[page]
            RemoteImage(
                b.imageUrl,
                modifier = Modifier.fillMaxWidth().aspectRatio(2.2f).clickable(enabled = b.linkType != "none", role = Role.Button, onClickLabel = b.title) { onOpen(b) },
                corner = 16.dp,
            )
        }
        if (banners.size > 1) {
            Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                repeat(banners.size) { i ->
                    val current = i == pager.currentPage
                    Surface(
                        shape = CircleShape,
                        color = if (current) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
                        modifier = Modifier.size(if (current) 8.dp else 6.dp),
                    ) {}
                }
            }
        }
    }
}

@Composable
private fun CategoryTile(c: Category, onClick: () -> Unit) {
    Column(
        Modifier.width(84.dp).clickable(role = Role.Button, onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        RemoteImage(c.imageUrl, Modifier.size(72.dp), corner = 20.dp)
        Text(
            c.name,
            style = MaterialTheme.typography.labelMedium,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 6.dp),
        )
    }
}

// ------------------------------------------------------------------------------------- product feed (paged)

data class ProductQuery(val q: String? = null, val categoryId: String? = null, val brandId: String? = null, val wholesalerId: String? = null)

data class FeedState(
    val items: List<ProductSummary> = emptyList(),
    val loading: Boolean = false,
    val endReached: Boolean = false,
    val error: String? = null,
    val initialLoadDone: Boolean = false,
)

/** Cursor-paged product list. One instance per screen (not a singleton). */
class ProductFeed @Inject constructor(private val api: ShopApi) {
    private val _state = MutableStateFlow(FeedState())
    val state: StateFlow<FeedState> = _state.asStateFlow()
    private var scope: kotlinx.coroutines.CoroutineScope? = null
    private var query = ProductQuery()
    private var cursor: String? = null
    private var job: Job? = null

    fun start(scope: kotlinx.coroutines.CoroutineScope, query: ProductQuery) {
        this.scope = scope
        this.query = query
        restart()
    }

    fun restart() {
        job?.cancel()
        cursor = null
        _state.value = FeedState()
        loadMore()
    }

    fun loadMore() {
        val s = _state.value
        if (s.loading || s.endReached) return
        val scope = scope ?: return
        job = scope.launch {
            _state.update { it.copy(loading = true, error = null) }
            try {
                val page = apiCall { api.products(query.q, query.categoryId, query.brandId, query.wholesalerId, cursor) }
                cursor = page.nextCursor
                _state.update { it.copy(items = it.items + page.items, loading = false, endReached = page.nextCursor == null, initialLoadDone = true) }
            } catch (e: ApiException) {
                _state.update { it.copy(loading = false, error = e.message, initialLoadDone = true) }
            }
        }
    }
}

/** Calls [loadMore] when the user scrolls within a few items of the end. */
@Composable
fun LoadMoreWhenNearEnd(grid: LazyGridState, loadMore: () -> Unit) {
    val nearEnd by remember {
        derivedStateOf {
            val last = grid.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            last >= grid.layoutInfo.totalItemsCount - 6
        }
    }
    LaunchedEffect(grid) { snapshotFlow { nearEnd }.distinctUntilChanged().filter { it }.collect { loadMore() } }
}

fun androidx.compose.foundation.lazy.grid.LazyGridScope.productItems(feed: FeedState, onProduct: (String) -> Unit, onRetry: () -> Unit, emptyText: String = "No products here yet") {
    items(feed.items, key = { it.id }) { p -> ProductCard(p) { onProduct(p.id) } }
    when {
        feed.loading -> item(span = { GridItemSpan(maxLineSpan) }) {
            Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        }
        feed.error != null -> item(span = { GridItemSpan(maxLineSpan) }) {
            Column(Modifier.fillMaxWidth().padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(feed.error, color = MaterialTheme.colorScheme.error)
                androidx.compose.material3.TextButton(onClick = onRetry) { Text("Try again") }
            }
        }
        feed.initialLoadDone && feed.items.isEmpty() -> item(span = { GridItemSpan(maxLineSpan) }) {
            Box(Modifier.height(280.dp)) { MessageState(Icons.Outlined.SearchOff, emptyText, "Try another search or category.") }
        }
    }
}

@Composable
fun ProductCard(p: ProductSummary, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Box {
            RemoteImage(p.thumbnailUrl, Modifier.fillMaxWidth().aspectRatio(1f), corner = 16.dp)
            if (p.totalStock <= 0) {
                Surface(color = Color.Black.copy(alpha = 0.6f), shape = RoundedCornerShape(bottomEnd = 12.dp, topStart = 16.dp)) {
                    Text("Out of stock", color = Color.White, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp))
                }
            }
        }
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(p.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(
                listOfNotNull(p.brandName, p.wholesaler.businessName).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (p.minPricePaise != null) PriceLine(p.minPricePaise, p.mrpPaise, Modifier.padding(top = 4.dp))
            if (p.ratingCount > 0) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Star, contentDescription = null, tint = Color(0xFFF59E0B), modifier = Modifier.size(14.dp))
                    Text(" %.1f (%d)".format(p.ratingAvg, p.ratingCount), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

// ------------------------------------------------------------------------------------- product list (category, brand, search)

@HiltViewModel
class ProductListViewModel @Inject constructor(val feed: ProductFeed) : ViewModel() {
    private val queryText = MutableStateFlow("")
    private var base = ProductQuery()

    fun open(query: ProductQuery) {
        base = query
        feed.start(viewModelScope, query)
    }

    @OptIn(FlowPreview::class)
    fun startSearch() {
        viewModelScope.launch {
            queryText.debounce(350).distinctUntilChanged().collect { q ->
                val trimmed = q.trim()
                if (trimmed.length >= 2) feed.start(viewModelScope, base.copy(q = trimmed))
            }
        }
    }

    fun onQuery(q: String) {
        queryText.value = q
    }
}

/** Products in a category or brand ([title] set), or the search screen ([title] null). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProductListScreen(title: String?, query: ProductQuery, onBack: () -> Unit, onProduct: (String) -> Unit, vm: ProductListViewModel = hiltViewModel()) {
    val isSearch = title == null
    LaunchedEffect(query) { if (isSearch) vm.startSearch() else vm.open(query) }
    val feed by vm.feed.state.collectAsStateWithLifecycle()
    var text by androidx.compose.runtime.saveable.rememberSaveable { androidx.compose.runtime.mutableStateOf("") }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (isSearch) focus.requestFocus() }
    val grid = rememberLazyGridState()
    LoadMoreWhenNearEnd(grid) { vm.feed.loadMore() }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") } },
                title = {
                    if (isSearch) {
                        TextField(
                            value = text,
                            onValueChange = {
                                text = it
                                vm.onQuery(it)
                            },
                            placeholder = { Text("Search parts, part numbers, brands") },
                            singleLine = true,
                            colors = TextFieldDefaults.colors(
                                focusedContainerColor = Color.Transparent,
                                unfocusedContainerColor = Color.Transparent,
                                focusedIndicatorColor = Color.Transparent,
                                unfocusedIndicatorColor = Color.Transparent,
                            ),
                            modifier = Modifier.fillMaxWidth().focusRequester(focus),
                        )
                    } else {
                        Text(title ?: "")
                    }
                },
            )
        },
    ) { padding ->
        if (isSearch && text.trim().length < 2) {
            Box(Modifier.padding(padding)) {
                MessageState(Icons.Outlined.Search, "Find the right part", "Type a part name, part number or brand, e.g. \"oil filter\" or \"VA-OF-125\".")
            }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 160.dp),
                state = grid,
                contentPadding = PaddingValues(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.padding(padding).fillMaxSize(),
            ) {
                productItems(feed, onProduct, onRetry = vm.feed::loadMore, emptyText = if (isSearch) "No parts match \"${text.trim()}\"" else "No products here yet")
            }
        }
    }
}

// ------------------------------------------------------------------------------------- categories tab

@HiltViewModel
class CategoriesViewModel @Inject constructor(private val api: ShopApi) : LoadingViewModel<List<Category>>() {
    init {
        reload()
    }

    override suspend fun fetch() = api.categories().items
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CategoriesScreen(onCategory: (Category) -> Unit, vm: CategoriesViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    Scaffold(topBar = { TopAppBar(title = { Text("Categories") }) }) { padding ->
        when (val s = state) {
            Load.Loading -> LoadingScreen()
            is Load.Failed -> ErrorState(s.message) { vm.reload() }
            is Load.Ready -> androidx.compose.foundation.lazy.LazyColumn(
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
                modifier = Modifier.padding(padding),
            ) {
                items(s.data, key = { it.id }) { top ->
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(
                            Modifier.fillMaxWidth().clickable(role = Role.Button) { onCategory(top) },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RemoteImage(top.imageUrl, Modifier.size(44.dp), corner = 12.dp)
                            Text(top.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 12.dp).weight(1f))
                            Text("See all", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
                        }
                        if (top.children.isNotEmpty()) {
                            androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                top.children.forEach { c -> FilterChip(selected = false, onClick = { onCategory(c) }, label = { Text(c.name) }) }
                            }
                        }
                    }
                }
            }
        }
    }
}
