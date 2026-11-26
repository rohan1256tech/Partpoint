package `in`.partpoint.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import dagger.hilt.android.AndroidEntryPoint
import `in`.partpoint.core.auth.Me
import `in`.partpoint.core.auth.Session
import `in`.partpoint.core.auth.ui.AccountActions
import `in`.partpoint.core.auth.ui.LoginScreen
import `in`.partpoint.core.auth.ui.PendingApprovalScreen
import `in`.partpoint.core.auth.ui.SessionViewModel
import `in`.partpoint.core.auth.ui.SignedOutNotice
import `in`.partpoint.core.ui.LoadingScreen
import `in`.partpoint.core.ui.PartpointTheme
import `in`.partpoint.core.ui.ScreenColumn
import kotlinx.serialization.Serializable

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { PartpointTheme { Root() } }
    }
}

@Serializable private data object Login
@Serializable private data class Signup(val phone: String, val token: String)

@Composable
private fun Root(vm: SessionViewModel = hiltViewModel()) {
    val session by vm.session.collectAsStateWithLifecycle()
    when (val s = session) {
        Session.Loading -> LoadingScreen()
        is Session.SignedOut -> SignedOutFlow(s.notice)
        is Session.Active -> when {
            !s.me.isApproved -> PendingApprovalScreen(s.me)
            s.me.role == "retailer" -> `in`.partpoint.app.shop.RetailerApp(s.me)
            s.me.role == "wholesaler" -> `in`.partpoint.app.sell.SellerApp(s.me)
            else -> HomeScreen(s.me)
        }
    }
}

@Composable
private fun SignedOutFlow(notice: String?) {
    val nav = rememberNavController()
    NavHost(nav, startDestination = Login) {
        composable<Login> {
            androidx.compose.foundation.layout.Column {
                SignedOutNotice(notice)
                LoginScreen(
                    appTitle = "Partpoint",
                    tagline = "Spare parts from trusted wholesalers, delivered to your shop.",
                    onNeedsSignup = { phone, token -> nav.navigate(Signup(phone, token)) { launchSingleTop = true } },
                )
            }
        }
        composable<Signup> { entry ->
            val args = entry.toRoute<Signup>()
            SignupScreen(phone = args.phone, registrationToken = args.token, onBack = { nav.popBackStack() })
        }
    }
}

/** Placeholder until the catalog, cart and orders screens land (next slice). */
@Composable
private fun HomeScreen(me: Me) {
    ScreenColumn {
        Spacer(Modifier.height(24.dp))
        Text("Welcome, ${me.name.substringBefore(' ')}", style = MaterialTheme.typography.headlineMedium)
        Text(
            if (me.role == "wholesaler") "Your wholesaler account is active." else "Your retailer account is active.",
            style = MaterialTheme.typography.bodyLarge,
        )
        AccountActions()
    }
}
