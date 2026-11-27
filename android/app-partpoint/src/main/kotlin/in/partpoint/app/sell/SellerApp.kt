package `in`.partpoint.app.sell

import `in`.partpoint.core.auth.push.OpenOrderFromNotification
import `in`.partpoint.core.ui.Load
import `in`.partpoint.core.ui.LoadingViewModel
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Receipt
import androidx.compose.material.icons.outlined.AccountBalanceWallet
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Receipt
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.partpoint.core.auth.Me
import `in`.partpoint.core.auth.PhoneNumber
import `in`.partpoint.core.auth.ui.AccountActions
import `in`.partpoint.core.ui.ErrorState
import `in`.partpoint.core.ui.LoadingScreen
import `in`.partpoint.core.ui.SavingGreen
import `in`.partpoint.core.ui.dateTime
import `in`.partpoint.core.ui.rupees
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.Serializable
import java.time.LocalDate
import java.time.ZoneId
import javax.inject.Inject
import kotlin.reflect.KClass

@Serializable data object SellerOrdersTab
@Serializable data object StockTab
@Serializable data object EarningsTab
@Serializable data object SellerAccountTab
@Serializable data class SellerOrder(val id: String)
@Serializable data class StockProduct(val id: String)

private data class SellerTabItem(val route: Any, val type: KClass<*>, val label: String, val icon: ImageVector, val selected: ImageVector)

private val SELLER_TABS = listOf(
    SellerTabItem(SellerOrdersTab, SellerOrdersTab::class, "Orders", Icons.Outlined.Receipt, Icons.Filled.Receipt),
    SellerTabItem(StockTab, StockTab::class, "Stock", Icons.Outlined.Inventory2, Icons.Filled.Inventory2),
    SellerTabItem(EarningsTab, EarningsTab::class, "Earnings", Icons.Outlined.AccountBalanceWallet, Icons.Filled.AccountBalanceWallet),
    SellerTabItem(SellerAccountTab, SellerAccountTab::class, "Account", Icons.Outlined.Person, Icons.Filled.Person),
)

/** The wholesaler's app: orders Partpoint sends them first (the daily work), then their stock, earnings and account. */
@Composable
fun SellerApp(me: Me) {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val onTab = SELLER_TABS.any { entry?.destination?.hasRoute(it.type) == true }
    OpenOrderFromNotification { nav.navigate(SellerOrder(it)) }
    Scaffold(
        bottomBar = {
            if (onTab) {
                NavigationBar {
                    SELLER_TABS.forEach { t ->
                        val selected = entry?.destination?.hasRoute(t.type) == true
                        NavigationBarItem(
                            selected = selected,
                            onClick = { nav.switchTo(t.route) },
                            icon = { Icon(if (selected) t.selected else t.icon, null) },
                            label = { Text(t.label) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = SellerOrdersTab, modifier = Modifier.padding(bottom = padding.calculateBottomPadding())) {
            composable<SellerOrdersTab> { SellerOrdersScreen(onOrder = { nav.navigate(SellerOrder(it)) }) }
            composable<StockTab> { StockScreen(onProduct = { nav.navigate(StockProduct(it)) }) }
            composable<EarningsTab> { EarningsScreen() }
            composable<SellerAccountTab> { SellerAccountScreen(me) }
            composable<SellerOrder> { SellerOrderScreen(onBack = { nav.popBackStack() }) }
            composable<StockProduct> { StockProductScreen(onBack = { nav.popBackStack() }) }
        }
    }
}

private fun NavHostController.switchTo(route: Any) = navigate(route) {
    popUpTo(graph.findStartDestination().id) { saveState = true }
    launchSingleTop = true
    restoreState = true
}

// ------------------------------------------------------------------------------------- earnings

data class Earnings(val finance: FinanceView, val month: SalesReport, val monthLabel: String)

@HiltViewModel
class EarningsViewModel @Inject constructor(private val api: SellerApi) : LoadingViewModel<Earnings>() {
    init {
        reload()
    }

    override suspend fun fetch(): Earnings = coroutineScope {
        val today = LocalDate.now(ZoneId.of("Asia/Kolkata"))
        val first = today.withDayOfMonth(1)
        val finance = async { api.finance() }
        val month = async { api.sales(first.toString(), today.toString()) }
        Earnings(finance.await(), month.await(), today.month.name.lowercase().replaceFirstChar { it.uppercase() })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EarningsScreen(vm: EarningsViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    Scaffold(topBar = { TopAppBar(title = { Text("Earnings") }) }) { padding ->
        when (val s = state) {
            Load.Loading -> LoadingScreen()
            is Load.Failed -> ErrorState(s.message) { vm.reload() }
            is Load.Ready -> PullToRefreshBox(isRefreshing = refreshing, onRefresh = { vm.reload(pullToRefresh = true) }, modifier = Modifier.padding(padding)) {
                val (finance, month, label) = s.data
                val b = finance.balance
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(20.dp)) {
                            Text("Partpoint owes you", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onPrimaryContainer)
                            Text(rupees(b?.balancePaise ?: 0), style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimaryContainer)
                            Text(
                                "At your supply prices, for delivered orders. Paid to your bank by transfer.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onPrimaryContainer,
                            )
                        }
                    }
                    if (b != null) {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Line("Delivered orders", b.deliveredOrders.toString())
                            Line("Value of goods you supplied", rupees(b.owedPaise))
                            Line("Paid to you so far", rupees(b.paidPaise))
                        }
                    }

                    HorizontalDivider()
                    Text("$label so far", style = MaterialTheme.typography.titleMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Tile("Delivered orders", month.deliveredOrders.toString(), Modifier.weight(1f))
                        Tile("Your earnings", rupees(month.netPaise), Modifier.weight(1f))
                    }
                    if (month.products.isNotEmpty()) {
                        Text("Top sellers", style = MaterialTheme.typography.titleSmall)
                        month.products.take(5).forEach { p ->
                            Row {
                                Text("${p.name} · ${p.variant}", style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                Text("${p.qty} sold", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }

                    if (finance.payouts.isNotEmpty()) {
                        HorizontalDivider()
                        Text("Payouts received", style = MaterialTheme.typography.titleMedium)
                        finance.payouts.forEach { p ->
                            Row {
                                Column(Modifier.weight(1f)) {
                                    Text(dateTime(p.paidAt), style = MaterialTheme.typography.bodyMedium)
                                    p.reference?.let { Text("Ref $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                                }
                                Text(rupees(p.amountPaise), style = MaterialTheme.typography.bodyMedium, color = SavingGreen, fontWeight = FontWeight.Medium)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Line(label: String, value: String) = Row {
    Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
    Text(value, style = MaterialTheme.typography.bodyMedium)
}

@Composable
private fun Tile(label: String, value: String, modifier: Modifier) {
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = modifier) {
        Column(Modifier.padding(14.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        }
    }
}

// ------------------------------------------------------------------------------------- account

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SellerAccountScreen(me: Me) {
    Scaffold(topBar = { TopAppBar(title = { Text("Account") }) }) { padding ->
        Column(Modifier.padding(padding).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text(me.name, style = MaterialTheme.typography.titleLarge)
                    Text("Wholesaler", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                    me.phone?.let { Text("+91 ${PhoneNumber.display(it)}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
            }
            Text(
                "To change your business details, GSTIN or bank account, contact Partpoint support.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            AccountActions()
        }
    }
}
