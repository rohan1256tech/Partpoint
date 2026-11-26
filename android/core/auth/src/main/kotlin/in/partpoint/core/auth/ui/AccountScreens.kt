package `in`.partpoint.core.auth.ui

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
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
        Spacer(Modifier.height(24.dp))
        Text("Thanks, ${me.name.substringBefore(' ')}", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Your account is waiting for approval. We check every new business account to keep the marketplace " +
                "safe. You will get a notification as soon as it is approved.",
            style = MaterialTheme.typography.bodyLarge,
        )
        ErrorText(error)
        PrimaryButton("Check again", onClick = vm::reload, loading = busy)
        AccountActions(vm)
    }
}

/** Sign out and in-app account deletion (Google Play requires the latter). */
@Composable
fun AccountActions(vm: SessionViewModel = hiltViewModel()) {
    var confirmDelete by remember { mutableStateOf(false) }
    var reason by remember { mutableStateOf("") }
    val busy by vm.busy.collectAsStateWithLifecycle()

    OutlinedButton(onClick = vm::signOut, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("Sign out") }
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
