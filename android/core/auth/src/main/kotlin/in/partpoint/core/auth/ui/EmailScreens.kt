package `in`.partpoint.core.auth.ui

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.partpoint.core.auth.AuthRepository
import `in`.partpoint.core.network.ApiException
import `in`.partpoint.core.ui.ErrorText
import `in`.partpoint.core.ui.PrimaryButton
import `in`.partpoint.core.ui.ScreenColumn
import `in`.partpoint.core.ui.SecureScreen
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class EmailAuthViewModel @Inject constructor(val auth: AuthRepository) : ViewModel()

private val EMAIL = Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")
fun looksLikeEmail(s: String) = EMAIL.matches(s.trim())

/** Runs [block] with a busy flag and the server's message on failure. */
@Composable
private fun rememberRunner(): Triple<Boolean, String?, (suspend () -> Unit) -> Unit> {
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    return Triple(busy, error) { block ->
        scope.launch {
            busy = true
            error = null
            try {
                block()
            } catch (e: ApiException) {
                error = e.message
            } finally {
                busy = false
            }
        }
    }
}

@Composable
fun EmailField(value: String, onChange: (String) -> Unit, imeAction: ImeAction = ImeAction.Next) {
    OutlinedTextField(
        value = value,
        onValueChange = { onChange(it.trim().take(254)) },
        label = { Text("Email") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = imeAction),
        modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.EmailAddress },
    )
}

@Composable
fun PasswordField(label: String, value: String, onChange: (String) -> Unit, newPassword: Boolean = false) {
    var shown by remember { mutableStateOf(false) }
    OutlinedTextField(
        value = value,
        onValueChange = { onChange(it.take(128)) },
        label = { Text(label) },
        singleLine = true,
        visualTransformation = if (shown) VisualTransformation.None else PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        trailingIcon = {
            IconButton(onClick = { shown = !shown }) {
                Icon(if (shown) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, if (shown) "Hide password" else "Show password")
            }
        },
        supportingText = if (newPassword) ({ Text("At least 8 characters") }) else null,
        modifier = Modifier.fillMaxWidth().semantics { contentType = if (newPassword) ContentType.NewPassword else ContentType.Password },
    )
}

/** Sign in with email and password. An unverified email goes to [onNeedsVerification] (a code is sent). */
@Composable
fun EmailSignInScreen(
    onNeedsVerification: (email: String) -> Unit,
    onForgot: (email: String) -> Unit,
    onUsePhone: () -> Unit,
    vm: EmailAuthViewModel = hiltViewModel(),
) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    val (busy, error, run) = rememberRunner()
    ScreenColumn {
        Spacer(Modifier.height(24.dp))
        Text("Sign in with email", style = MaterialTheme.typography.headlineMedium)
        EmailField(email, { email = it })
        PasswordField("Password", password, { password = it })
        ErrorText(error)
        PrimaryButton("Sign in", enabled = looksLikeEmail(email) && password.isNotEmpty(), loading = busy, onClick = {
            run { if (!vm.auth.signInWithEmail(email, password)) onNeedsVerification(email) }
        })
        TextButton(onClick = { onForgot(email) }) { Text("Forgot password?") }
        TextButton(onClick = onUsePhone) { Text("Use mobile number instead") }
    }
}

/** Enter the 6-digit code emailed to [email]; success signs in. */
@Composable
fun VerifyEmailScreen(email: String, onBack: () -> Unit, vm: EmailAuthViewModel = hiltViewModel()) {
    SecureScreen()
    var code by rememberSaveable { mutableStateOf("") }
    var resent by remember { mutableStateOf(false) }
    val (busy, error, run) = rememberRunner()
    ScreenColumn {
        Spacer(Modifier.height(24.dp))
        Text("Check your email", style = MaterialTheme.typography.headlineMedium)
        Text("Enter the 6-digit code we sent to $email. It may take a minute; check spam too.")
        OutlinedTextField(
            value = code,
            onValueChange = { v ->
                code = v.filter(Char::isDigit).take(6)
                if (code.length == 6 && !busy) run { vm.auth.verifyEmail(email, code) }
            },
            label = { Text("Code") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            modifier = Modifier.fillMaxWidth(),
        )
        ErrorText(error)
        PrimaryButton("Verify", enabled = code.length == 6, loading = busy, onClick = { run { vm.auth.verifyEmail(email, code) } })
        TextButton(onClick = { run { vm.auth.resendEmailCode(email); resent = true } }, enabled = !busy) {
            Text(if (resent) "Code sent again" else "Send a new code")
        }
        TextButton(onClick = onBack) { Text("Back") }
    }
}

/** Two steps: send a code to the email, then set a new password with it. Every session is signed out. */
@Composable
fun ForgotPasswordScreen(initialEmail: String, onDone: (email: String) -> Unit, onBack: () -> Unit, vm: EmailAuthViewModel = hiltViewModel()) {
    var email by rememberSaveable { mutableStateOf(initialEmail) }
    var codeSent by rememberSaveable { mutableStateOf(false) }
    var code by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    val (busy, error, run) = rememberRunner()
    ScreenColumn {
        Spacer(Modifier.height(24.dp))
        Text("Reset your password", style = MaterialTheme.typography.headlineMedium)
        if (!codeSent) {
            Text("We'll email you a 6-digit code if an account uses this address.")
            EmailField(email, { email = it }, ImeAction.Done)
            ErrorText(error)
            PrimaryButton("Send code", enabled = looksLikeEmail(email), loading = busy, onClick = { run { vm.auth.forgotPassword(email); codeSent = true } })
        } else {
            SecureScreen()
            Text("Enter the code sent to $email and choose a new password. You'll be signed out on other devices.")
            OutlinedTextField(
                value = code,
                onValueChange = { code = it.filter(Char::isDigit).take(6) },
                label = { Text("Code") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                modifier = Modifier.fillMaxWidth(),
            )
            PasswordField("New password", password, { password = it }, newPassword = true)
            ErrorText(error)
            PrimaryButton("Set new password", enabled = code.length == 6 && password.length >= 8, loading = busy, onClick = {
                run {
                    vm.auth.resetPassword(email, code, password)
                    onDone(email)
                }
            })
            TextButton(onClick = { run { vm.auth.forgotPassword(email) } }, enabled = !busy) { Text("Send a new code") }
        }
        TextButton(onClick = onBack) { Text("Back to sign in") }
    }
}
