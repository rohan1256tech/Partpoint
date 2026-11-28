package `in`.partpoint.delivery

import `in`.partpoint.core.ui.ProfileHeader
import `in`.partpoint.core.auth.push.OpenOrderFromNotification
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
import androidx.compose.material.icons.filled.DeliveryDining
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.outlined.AccountBalanceWallet
import androidx.compose.material.icons.outlined.DeliveryDining
import androidx.compose.material.icons.outlined.Person
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
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
import `in`.partpoint.core.ui.Load
import `in`.partpoint.core.ui.LoadingScreen
import `in`.partpoint.core.ui.LoadingViewModel
import `in`.partpoint.core.ui.SavingGreen
import `in`.partpoint.core.ui.dateTime
import `in`.partpoint.core.ui.rupees
import kotlinx.serialization.Serializable
import javax.inject.Inject
import kotlin.reflect.KClass

@Serializable data object JobsTab
@Serializable data object EarningsTab
@Serializable data object ProfileTab
@Serializable data class JobRoute(val id: String)

private data class TabItem(val route: Any, val type: KClass<*>, val label: String, val icon: ImageVector, val selected: ImageVector)

private val TABS = listOf(
    TabItem(JobsTab, JobsTab::class, "Jobs", Icons.Outlined.DeliveryDining, Icons.Filled.DeliveryDining),
    TabItem(EarningsTab, EarningsTab::class, "Earnings", Icons.Outlined.AccountBalanceWallet, Icons.Filled.AccountBalanceWallet),
    TabItem(ProfileTab, ProfileTab::class, "Account", Icons.Outlined.Person, Icons.Filled.Person),
)

@Composable
fun RiderApp(me: Me) {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val onTab = TABS.any { entry?.destination?.hasRoute(it.type) == true }
    OpenOrderFromNotification { nav.navigate(JobRoute(it)) }
    Scaffold(
        bottomBar = {
            if (onTab) {
                NavigationBar {
                    TABS.forEach { t ->
                        val selected = entry?.destination?.hasRoute(t.type) == true
                        NavigationBarItem(colors = `in`.partpoint.core.ui.brandNavColors(),selected = selected, onClick = { nav.switchTo(t.route) }, icon = { Icon(if (selected) t.selected else t.icon, null) }, label = { Text(t.label) })
                    }
                }
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = JobsTab, modifier = Modifier.padding(bottom = padding.calculateBottomPadding())) {
            composable<JobsTab> { JobsScreen(onJob = { nav.navigate(JobRoute(it)) }) }
            composable<EarningsTab> { EarningsScreen() }
            composable<ProfileTab> { ProfileScreen(me) }
            composable<JobRoute> { JobScreen(onBack = { nav.popBackStack() }) }
        }
    }
}

private fun NavHostController.switchTo(route: Any) = navigate(route) {
    popUpTo(graph.findStartDestination().id) { saveState = true }
    launchSingleTop = true
    restoreState = true
}

@HiltViewModel
class EarningsViewModel @Inject constructor(private val api: DeliveryApi) : LoadingViewModel<Earnings>() {
    init {
        reload()
    }

    override suspend fun fetch() = api.earnings()
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EarningsScreen(vm: EarningsViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.reload() }
    Scaffold(topBar = { TopAppBar(title = { Text("Earnings") }) }) { padding ->
        when (val s = state) {
            Load.Loading -> LoadingScreen()
            is Load.Failed -> ErrorState(s.message) { vm.reload() }
            is Load.Ready -> PullToRefreshBox(isRefreshing = refreshing, onRefresh = { vm.reload(pullToRefresh = true) }, modifier = Modifier.padding(padding)) {
                val e = s.data
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Surface(shape = RoundedCornerShape(20.dp), color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(20.dp)) {
                            Text("Today", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onPrimaryContainer)
                            Text(rupees(e.todayPaise), style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimaryContainer)
                            Text("Waiting to be paid: ${rupees(e.unpaidPaise)}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Stat("Last 7 days", rupees(e.last7DaysPaise), Modifier.weight(1f))
                        Stat("This month", rupees(e.thisMonthPaise), Modifier.weight(1f))
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Stat("Deliveries", e.deliveredCount.toString(), Modifier.weight(1f))
                        Stat("All time", rupees(e.allTimePaise), Modifier.weight(1f))
                    }
                    if (e.recent.isNotEmpty()) {
                        HorizontalDivider()
                        Text("Recent deliveries", style = MaterialTheme.typography.titleMedium)
                        e.recent.forEach { r ->
                            Row {
                                Column(Modifier.weight(1f)) {
                                    Text(r.orderNumber, style = MaterialTheme.typography.bodyMedium)
                                    Text(dateTime(r.deliveredAt), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                Column(horizontalAlignment = androidx.compose.ui.Alignment.End) {
                                    Text(rupees(r.amountPaise), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                                    Text(if (r.paidOut) "Paid" else "Unpaid", style = MaterialTheme.typography.labelSmall, color = if (r.paidOut) SavingGreen else MaterialTheme.colorScheme.onSurfaceVariant)
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
private fun Stat(label: String, value: String, modifier: Modifier) {
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = modifier) {
        Column(Modifier.padding(14.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(me: Me) {
    Scaffold(topBar = { TopAppBar(title = { Text("Account") }) }) { padding ->
        Column(Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            ProfileHeader(me.name, "Delivery partner", listOfNotNull(me.phone?.let { "+91 ${PhoneNumber.display(it)}" }, me.email), badge = "Verified partner")
            Text(
                "Your phone number is shared with the wholesaler and the retailer of each order you deliver, so they can reach you. Sakshay Connect does not track your location.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            AccountActions()
        }
    }
}
