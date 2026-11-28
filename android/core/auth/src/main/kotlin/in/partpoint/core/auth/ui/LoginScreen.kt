package `in`.partpoint.core.auth.ui

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.partpoint.core.auth.AuthRepository
import `in`.partpoint.core.auth.OtpOutcome
import `in`.partpoint.core.auth.PhoneNumber
import `in`.partpoint.core.network.ApiException
import `in`.partpoint.core.ui.ErrorText
import `in`.partpoint.core.ui.PrimaryButton
import `in`.partpoint.core.ui.ScreenColumn
import `in`.partpoint.core.ui.SecureScreen
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LoginState(
    val phoneInput: String = "",
    /** Set once a code has been sent; the screen then asks for the code. */
    val phone: String? = null,
    val code: String = "",
    val busy: Boolean = false,
    val error: String? = null,
    /** Seconds until "Resend code" is allowed (the API allows one code per 30 s). */
    val resendIn: Int = 0,
    /** A new number: the app shows its signup form with this token. */
    val signupToken: String? = null,
)

@HiltViewModel
class LoginViewModel @Inject constructor(private val auth: AuthRepository) : ViewModel() {
    private val _state = MutableStateFlow(LoginState())
    val state: StateFlow<LoginState> = _state.asStateFlow()

    fun onPhone(v: String) = _state.update { it.copy(phoneInput = v.filter { c -> c.isDigit() || c == '+' || c == ' ' }.take(16), error = null) }
    fun onCode(v: String) {
        val digits = v.filter(Char::isDigit).take(6)
        _state.update { it.copy(code = digits, error = null) }
        if (digits.length == 6) verify()
    }

    fun sendCode() {
        val phone = PhoneNumber.normalize(_state.value.phoneInput)
        if (phone == null) {
            _state.update { it.copy(error = "Enter a valid 10-digit Indian mobile number") }
            return
        }
        run {
            auth.requestOtp(phone)
            _state.update { it.copy(phone = phone, code = "", resendIn = 30) }
            countdown()
        }
    }

    fun verify() {
        val s = _state.value
        val phone = s.phone ?: return
        if (s.code.length != 6 || s.busy) return
        run {
            when (val out = auth.verifyOtp(phone, s.code)) {
                OtpOutcome.SignedIn -> Unit // the session flow moves the app on
                is OtpOutcome.NeedsSignup -> _state.update { it.copy(signupToken = out.registrationToken) }
            }
        }
    }

    fun changeNumber() = _state.update { LoginState(phoneInput = it.phoneInput) }

    private fun countdown() = viewModelScope.launch {
        while (_state.value.resendIn > 0) {
            delay(1_000)
            _state.update { it.copy(resendIn = (it.resendIn - 1).coerceAtLeast(0)) }
        }
    }

    private fun run(block: suspend () -> Unit) = viewModelScope.launch {
        _state.update { it.copy(busy = true, error = null) }
        try {
            block()
        } catch (e: ApiException) {
            _state.update { it.copy(error = e.message, code = if (e is ApiException.Http && e.code.startsWith("OTP")) "" else it.code) }
        } finally {
            _state.update { it.copy(busy = false) }
        }
    }
}

/**
 * Phone + OTP sign-in, shared by both apps. [onNeedsSignup] receives the verified phone and the
 * registration token when the number is new; each app shows its own signup form.
 */
@Composable
fun LoginScreen(
    appTitle: String,
    tagline: String,
    onNeedsSignup: (phone: String, registrationToken: String) -> Unit,
    /** Shown as "Sign in with email instead" when set (the Partpoint app). */
    onUseEmail: (() -> Unit)? = null,
    vm: LoginViewModel = hiltViewModel(),
) {
    val s by vm.state.collectAsStateWithLifecycle()
    LaunchedEffect(s.signupToken) {
        val token = s.signupToken
        val phone = s.phone
        if (token != null && phone != null) onNeedsSignup(phone, token)
    }

    ScreenColumn {
        `in`.partpoint.core.ui.BrandHero(photo = `in`.partpoint.core.ui.BrandPhotos.Repair) {
            Spacer(Modifier.height(40.dp))
            `in`.partpoint.core.ui.BrandMark(size = 56.dp)
            Spacer(Modifier.height(14.dp))
            Text(appTitle, style = MaterialTheme.typography.headlineMedium, color = androidx.compose.ui.graphics.Color.White)
            Text(`in`.partpoint.core.ui.Brand.TAGLINE, style = MaterialTheme.typography.titleSmall, color = `in`.partpoint.core.ui.BrandColors.Yellow)
            Spacer(Modifier.height(8.dp))
            Text(tagline, style = MaterialTheme.typography.bodyMedium, color = androidx.compose.ui.graphics.Color.White.copy(alpha = 0.8f))
        }
        Text(if (s.phone == null) "Sign in or create an account" else "Verify your number", style = MaterialTheme.typography.titleLarge)

        if (s.phone == null) {
            OutlinedTextField(
                value = s.phoneInput,
                onValueChange = vm::onPhone,
                label = { Text("Mobile number") },
                prefix = { Text("+91 ") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { vm.sendCode() }),
                modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.PhoneNumber },
            )
            ErrorText(s.error)
            PrimaryButton("Send code", onClick = vm::sendCode, loading = s.busy)
            if (onUseEmail != null) TextButton(onClick = onUseEmail) { Text("Sign in with email instead") }
        } else {
            SecureScreen() // no screenshots of the code
            Text("Enter the 6-digit code sent to +91 ${PhoneNumber.display(s.phone!!)}")
            OutlinedTextField(
                value = s.code,
                onValueChange = vm::onCode,
                label = { Text("Code") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { vm.verify() }),
                // Lets the keyboard offer the code from the SMS (no READ_SMS permission needed).
                modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.SmsOtpCode },
            )
            ErrorText(s.error)
            PrimaryButton("Verify", onClick = vm::verify, enabled = s.code.length == 6, loading = s.busy)
            TextButton(onClick = vm::sendCode, enabled = s.resendIn == 0 && !s.busy) {
                Text(if (s.resendIn > 0) "Resend code in ${s.resendIn}s" else "Resend code")
            }
            TextButton(onClick = vm::changeNumber) { Text("Change number") }
        }
    }
}
