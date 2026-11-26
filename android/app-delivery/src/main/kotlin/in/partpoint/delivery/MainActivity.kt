package `in`.partpoint.delivery

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import dagger.hilt.android.AndroidEntryPoint
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.partpoint.core.auth.AuthRepository
import `in`.partpoint.core.auth.Me
import `in`.partpoint.core.auth.PhoneNumber
import `in`.partpoint.core.auth.Session
import `in`.partpoint.core.auth.SignupProfile
import `in`.partpoint.core.auth.ui.AccountActions
import `in`.partpoint.core.auth.ui.LoginScreen
import `in`.partpoint.core.auth.ui.PendingApprovalScreen
import `in`.partpoint.core.auth.ui.SessionViewModel
import `in`.partpoint.core.auth.ui.SignedOutNotice
import `in`.partpoint.core.network.ApiException
import `in`.partpoint.core.ui.ErrorText
import `in`.partpoint.core.ui.LoadingScreen
import `in`.partpoint.core.ui.PartpointTheme
import `in`.partpoint.core.ui.PrimaryButton
import `in`.partpoint.core.ui.ScreenColumn
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import javax.inject.Inject

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
        is Session.Active -> if (s.me.isApproved) RiderApp(s.me) else PendingApprovalScreen(s.me)
    }
}

@Composable
private fun SignedOutFlow(notice: String?) {
    val nav = rememberNavController()
    NavHost(nav, startDestination = Login) {
        composable<Login> {
            Column {
                SignedOutNotice(notice)
                LoginScreen(
                    appTitle = "Partpoint Delivery",
                    tagline = "Deliver spare-part orders from wholesalers to shops near you.",
                    onNeedsSignup = { phone, token -> nav.navigate(Signup(phone, token)) { launchSingleTop = true } },
                )
            }
        }
        composable<Signup> { entry ->
            val args = entry.toRoute<Signup>()
            RiderSignupScreen(args.phone, args.token, onBack = { nav.popBackStack() })
        }
    }
}

@HiltViewModel
class RiderSignupViewModel @Inject constructor(val auth: AuthRepository) : ViewModel()

@Composable
private fun RiderSignupScreen(phone: String, token: String, onBack: () -> Unit, vm: RiderSignupViewModel = hiltViewModel()) {
    var name by remember { mutableStateOf("") }
    var vehicleType by remember { mutableStateOf("") }
    var vehicleNumber by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    ScreenColumn {
        Text("Join as a delivery partner", style = MaterialTheme.typography.headlineSmall)
        Text("+91 ${PhoneNumber.display(phone)} is verified.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(name, { name = it }, label = { Text("Your name") }, singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words), modifier = Modifier.fillMaxWidth())
        OutlinedTextField(vehicleType, { vehicleType = it.take(30) }, label = { Text("Vehicle (e.g. bike, scooter)") }, singleLine = true,
            modifier = Modifier.fillMaxWidth())
        OutlinedTextField(vehicleNumber, { vehicleNumber = it.uppercase().take(15) }, label = { Text("Vehicle number (optional)") }, singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters), modifier = Modifier.fillMaxWidth())
        Text(
            "By joining you agree to the Partpoint privacy policy and terms. Your phone number is shared with the " +
                "shop and wholesaler of each order you deliver.",
            style = MaterialTheme.typography.bodySmall,
        )
        ErrorText(error)
        PrimaryButton("Join", enabled = name.isNotBlank(), loading = busy, onClick = {
            scope.launch {
                busy = true
                error = null
                try {
                    vm.auth.register(
                        token,
                        name.trim(),
                        SignupProfile.Delivery(vehicleType.trim().ifEmpty { null }, vehicleNumber.trim().ifEmpty { null }),
                        email = null,
                    )
                } catch (e: ApiException) {
                    error = e.message
                } finally {
                    busy = false
                }
            }
        })
        TextButton(onClick = onBack) { Text("Back") }
    }
}
