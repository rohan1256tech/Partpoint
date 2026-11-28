package `in`.partpoint.core.auth.ui

import `in`.partpoint.core.ui.SecondaryButton
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.partpoint.core.auth.AuthRepository
import `in`.partpoint.core.auth.Me
import `in`.partpoint.core.auth.Session
import `in`.partpoint.core.auth.SessionManager
import `in`.partpoint.core.network.ApiException
import `in`.partpoint.core.ui.ErrorText
import `in`.partpoint.core.ui.PrimaryButton
import `in`.partpoint.core.ui.ScreenColumn
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Drives the top level of each app: which screen to show for the current session. */
@HiltViewModel
class SessionViewModel @Inject constructor(
    private val auth: AuthRepository,
    sessions: SessionManager,
) : ViewModel() {
    val session: StateFlow<Session> = sessions.session

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    init {
        viewModelScope.launch { runCatching { auth.restore() } }
    }

    fun reload() = act { auth.reloadMe() }
    fun signOut() = act { auth.signOut() }
    fun deleteAccount(reason: String?) = act { auth.deleteAccount(reason) }

    private fun act(block: suspend () -> Unit) = viewModelScope.launch {
        _busy.value = true
        _error.value = null
        try {
            block()
        } catch (e: ApiException) {
            _error.value = e.message
        } finally {
            _busy.value = false
        }
    }
}

/** Shown until an admin approves the account (the API keeps pending users out of everything else). */
@Composable
fun PendingApprovalScreen(me: Me, vm: SessionViewModel = hiltViewModel()) {
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    ScreenColumn {
        `in`.partpoint.core.ui.BrandHero {
            `in`.partpoint.core.ui.BrandMark(size = 48.dp)
            Spacer(Modifier.height(12.dp))
            Text("Thanks, ${me.name.substringBefore(' ')}", style = MaterialTheme.typography.headlineSmall, color = androidx.compose.ui.graphics.Color.White)
            Text("Your account is under review", style = MaterialTheme.typography.titleSmall, color = `in`.partpoint.core.ui.BrandColors.Yellow)
        }
        Text(
            "We check every new business account to keep the network safe. The app opens fully as soon as our team approves you, and you get a notification.",
            style = MaterialTheme.typography.bodyLarge,
        )
        ApprovalStep(done = true, title = "Account created", body = "Your details have reached our team.")
        ApprovalStep(done = false, title = "Review by Sakshay Connect", body = "We verify your business details.")
        ApprovalStep(done = false, title = "Start using the app", body = "Shop, supply or deliver, depending on your account.")
        ErrorText(error)
        PrimaryButton("Check again", onClick = vm::reload, loading = busy)
        AccountActions(vm)
    }
}

@Composable
private fun ApprovalStep(done: Boolean, title: String, body: String) {
    androidx.compose.foundation.layout.Row(verticalAlignment = androidx.compose.ui.Alignment.Top) {
        androidx.compose.material3.Icon(
            if (done) androidx.compose.material.icons.Icons.Filled.CheckCircle else androidx.compose.material.icons.Icons.Outlined.Schedule,
            contentDescription = if (done) "Done" else "Pending",
            tint = if (done) `in`.partpoint.core.ui.SavingGreen else MaterialTheme.colorScheme.onSurfaceVariant,
        )
        androidx.compose.foundation.layout.Column(Modifier.padding(start = 12.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Text(body, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** Sign out and in-app account deletion (Google Play requires the latter). */
@Composable
fun AccountActions(vm: SessionViewModel = hiltViewModel()) {
    var confirmDelete by remember { mutableStateOf(false) }
    var reason by remember { mutableStateOf("") }
    val busy by vm.busy.collectAsStateWithLifecycle()

    SecondaryButton(onClick = vm::signOut, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("Sign out") }
    PrivacyPolicyButton(Modifier.fillMaxWidth())
    TextButton(onClick = { confirmDelete = true }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
        Text("Delete account", color = MaterialTheme.colorScheme.error)
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete your account?") },
            text = {
                androidx.compose.foundation.layout.Column {
                    Text(
                        "Your name, phone number, addresses, cart and wishlist are erased and you are signed out. " +
                            "Past orders are kept for GST records. This cannot be undone.",
                    )
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(value = reason, onValueChange = { reason = it.take(500) }, label = { Text("Reason (optional)") })
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    vm.deleteAccount(reason.trim().ifEmpty { null })
                }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Keep account") } },
        )
    }
}

/** A notice on the sign-in screen, e.g. "Your account has been blocked". */
@Composable
fun SignedOutNotice(notice: String?) {
    if (notice != null) Text(notice, color = Color(0xFFB42318), style = MaterialTheme.typography.bodyMedium)
}
