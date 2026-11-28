package `in`.partpoint.app.shop

import `in`.partpoint.core.auth.push.OpenOrderFromNotification
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Category
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Receipt
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.outlined.Category
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Receipt
import androidx.compose.material.icons.outlined.ShoppingCart
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.partpoint.core.auth.Me
import kotlinx.serialization.Serializable
import javax.inject.Inject
import kotlin.reflect.KClass

// Routes
@Serializable data object HomeTab
@Serializable data object CategoriesTab
@Serializable data object CartTab
@Serializable data object OrdersTab
@Serializable data object AccountTab
@Serializable data object Search
@Serializable data class Products(val title: String, val categoryId: String? = null, val brandId: String? = null)
@Serializable data class Product(val id: String)
@Serializable data object Checkout
@Serializable data class Placed(val number: String, val total: Long)
@Serializable data class Order(val id: String)
@Serializable data object Addresses
@Serializable data object Wishlist

private data class Tab(val route: Any, val type: KClass<*>, val label: String, val icon: ImageVector, val selectedIcon: ImageVector)

private val TABS = listOf(
    Tab(HomeTab, HomeTab::class, "Home", Icons.Outlined.Home, Icons.Filled.Home),
    Tab(CategoriesTab, CategoriesTab::class, "Categories", Icons.Outlined.Category, Icons.Filled.Category),
    Tab(CartTab, CartTab::class, "Cart", Icons.Outlined.ShoppingCart, Icons.Filled.ShoppingCart),
    Tab(OrdersTab, OrdersTab::class, "Orders", Icons.Outlined.Receipt, Icons.Filled.Receipt),
    Tab(AccountTab, AccountTab::class, "Account", Icons.Outlined.Person, Icons.Filled.Person),
)

@HiltViewModel
class RetailerShellViewModel @Inject constructor(val cart: CartStore) : ViewModel()

/** The retailer's app: five tabs, with detail screens pushed on top (the tab bar hides there). */
@Composable
fun RetailerApp(me: Me, shell: RetailerShellViewModel = hiltViewModel()) {
    val nav = rememberNavController()
    val cart by shell.cart.cart.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { runCatching { shell.cart.refresh() } }
    val entry by nav.currentBackStackEntryAsState()
    val onTab = TABS.any { t -> entry?.destination?.hasRoute(t.type) == true }
    OpenOrderFromNotification { nav.navigate(Order(it)) }

    Scaffold(
        bottomBar = {
            if (onTab) {
                NavigationBar {
                    TABS.forEach { t ->
                        val selected = entry?.destination?.hasRoute(t.type) == true
                        NavigationBarItem(
                            selected = selected,
                            onClick = { nav.switchTab(t.route) },
                            label = { Text(t.label) },
                            icon = {
                                if (t.route == CartTab && cart.itemCount > 0) {
                                    BadgedBox(badge = { Badge { Text(cart.itemCount.toString()) } }) { Icon(if (selected) t.selectedIcon else t.icon, null) }
                                } else {
                                    Icon(if (selected) t.selectedIcon else t.icon, null)
                                }
                            },
                        )
                    }
                }
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = HomeTab, modifier = Modifier.padding(bottom = padding.calculateBottomPadding())) {
            val openProduct: (String) -> Unit = { nav.navigate(Product(it)) }
            composable<HomeTab> {
                HomeScreen(
                    onSearch = { nav.navigate(Search) },
                    onCategory = { nav.navigate(Products(it.name, categoryId = it.id)) },
                    onBrand = { nav.navigate(Products(it.name, brandId = it.id)) },
                    onProduct = openProduct,
                    onShop = { nav.switchTab(CategoriesTab) },
                    onOrders = { nav.switchTab(OrdersTab) },
                    onAddresses = { nav.navigate(Addresses) },
                )
            }
            composable<CategoriesTab> { CategoriesScreen(onCategory = { nav.navigate(Products(it.name, categoryId = it.id)) }) }
            composable<CartTab> {
                CartScreen(onBrowse = { nav.switchTab(HomeTab) }, onProduct = openProduct, onCheckout = { nav.navigate(Checkout) })
            }
            composable<OrdersTab> { OrdersScreen(onOrder = { nav.navigate(Order(it)) }, onBrowse = { nav.switchTab(HomeTab) }) }
            composable<AccountTab> { AccountScreen(me, onAddresses = { nav.navigate(Addresses) }, onWishlist = { nav.navigate(Wishlist) }) }

            composable<Search> { ProductListScreen(title = null, query = ProductQuery(), onBack = { nav.popBackStack() }, onProduct = openProduct) }
            composable<Products> { e ->
                val r = e.toRoute<Products>()
                ProductListScreen(r.title, ProductQuery(categoryId = r.categoryId, brandId = r.brandId), onBack = { nav.popBackStack() }, onProduct = openProduct)
            }
            composable<Product> {
                ProductScreen(
                    onBack = { nav.popBackStack() },
                    onOpenCart = { nav.switchTab(CartTab) },
                )
            }
            composable<Checkout> {
                CheckoutScreen(onBack = { nav.popBackStack() }, onPlaced = { placed ->
                    nav.navigate(Placed(placed.orderNumber, placed.totalPaise)) { popUpTo(CartTab) }
                })
            }
            composable<Placed> { e ->
                val p = e.toRoute<Placed>()
                OrderPlacedScreen(p.number, p.total, onViewOrders = { nav.switchTab(OrdersTab) }, onContinue = { nav.switchTab(HomeTab) })
            }
            composable<Order> { OrderDetailScreen(onBack = { nav.popBackStack() }, onProduct = openProduct) }
            composable<Addresses> { AddressesScreen(onBack = { nav.popBackStack() }) }
            composable<Wishlist> { WishlistScreen(onBack = { nav.popBackStack() }, onProduct = openProduct) }
        }
    }
}

/** Standard tab switch: one copy of each tab, state kept when you come back to it. */
private fun NavHostController.switchTab(route: Any) = navigate(route) {
    popUpTo(graph.findStartDestination().id) { saveState = true }
    launchSingleTop = true
    restoreState = true
}
