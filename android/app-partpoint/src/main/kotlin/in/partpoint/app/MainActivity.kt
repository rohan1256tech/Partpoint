package `in`.partpoint.app

import `in`.partpoint.core.auth.push.PushRegistrar
import javax.inject.Inject
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
import `in`.partpoint.core.auth.ui.EmailSignInScreen
import `in`.partpoint.core.auth.ui.ForgotPasswordScreen
import `in`.partpoint.core.auth.ui.VerifyEmailScreen
import androidx.compose.foundation.layout.padding
import `in`.partpoint.core.auth.ui.PendingApprovalScreen
import `in`.partpoint.core.auth.ui.SessionViewModel
import `in`.partpoint.core.auth.ui.SignedOutNotice
import `in`.partpoint.core.ui.LoadingScreen
import `in`.partpoint.core.ui.PartpointTheme
import `in`.partpoint.core.ui.ScreenColumn
import kotlinx.serialization.Serializable

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var push: PushRegistrar

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Opened from a notification: remember which order to show.
        push.handleLaunch(intent)
        enableEdgeToEdge()
        setContent { PartpointTheme { Root() } }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        push.handleLaunch(intent)
    }
}

@Serializable private data object Login
/** New account: by verified phone ([token] set) or by email and password ([token] null). */
@Serializable private data class Signup(val phone: String? = null, val token: String? = null)
@Serializable private data object EmailSignIn
@Serializable private data class VerifyEmail(val email: String)
@Serializable private data class ForgotPassword(val email: String = "")

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
                    tagline = "Mobile spare parts and accessories at wholesale prices, delivered to your shop.",
                    onNeedsSignup = { phone, token -> nav.navigate(Signup(phone, token)) { launchSingleTop = true } },
                    onUseEmail = { nav.navigate(EmailSignIn) { launchSingleTop = true } },
                )
            }
        }
        composable<Signup> { entry ->
            val args = entry.toRoute<Signup>()
            SignupScreen(
                phone = args.phone,
                registrationToken = args.token,
                onBack = { nav.popBackStack() },
                onEmailCodeSent = { email -> nav.navigate(VerifyEmail(email)) { popUpTo(Login) } },
            )
        }
        composable<EmailSignIn> {
            androidx.compose.foundation.layout.Column {
                EmailSignInScreen(
                    onNeedsVerification = { nav.navigate(VerifyEmail(it)) },
                    onForgot = { nav.navigate(ForgotPassword(it)) },
                    onUsePhone = { nav.popBackStack() },
                )
                androidx.compose.material3.TextButton(onClick = { nav.navigate(Signup()) }, modifier = androidx.compose.ui.Modifier.padding(horizontal = 16.dp)) {
                    Text("New to Partpoint? Create an account with email")
                }
            }
        }
        composable<VerifyEmail> { e -> VerifyEmailScreen(e.toRoute<VerifyEmail>().email, onBack = { nav.popBackStack() }) }
        composable<ForgotPassword> { e ->
            ForgotPasswordScreen(
                initialEmail = e.toRoute<ForgotPassword>().email,
                onDone = { nav.popBackStack(EmailSignIn, inclusive = false) },
                onBack = { nav.popBackStack() },
            )
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
