package `in`.partpoint.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material.icons.outlined.Warehouse
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.partpoint.core.auth.AuthRepository
import `in`.partpoint.core.auth.PhoneNumber
import `in`.partpoint.core.auth.SignupProfile
import `in`.partpoint.core.auth.ui.ConsentText
import `in`.partpoint.core.auth.ui.EmailField
import `in`.partpoint.core.auth.ui.PasswordField
import `in`.partpoint.core.auth.ui.looksLikeEmail
import `in`.partpoint.core.network.ApiException
import `in`.partpoint.core.ui.ChoiceCard
import `in`.partpoint.core.ui.ErrorText
import `in`.partpoint.core.ui.FormSection
import `in`.partpoint.core.ui.SignupHeader
import `in`.partpoint.core.ui.PrimaryButton
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SignupViewModel @Inject constructor(val auth: AuthRepository) : ViewModel()

private val GSTIN = Regex("^\\d{2}[A-Z]{5}\\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
private val PINCODE = Regex("^[1-9]\\d{5}$")

/**
 * New account: who you are, your business, and consent to the privacy policy. Either after a
 * verified phone ([registrationToken]) or with email and password, verified by an emailed code.
 */
@Composable
fun SignupScreen(
    phone: String?,
    registrationToken: String?,
    onBack: () -> Unit,
    onEmailCodeSent: (email: String) -> Unit,
    vm: SignupViewModel = hiltViewModel(),
) {
    val byEmail = registrationToken == null
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var wholesaler by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var business by remember { mutableStateOf("") }
    var gstin by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    var city by remember { mutableStateOf("") }
    var state by remember { mutableStateOf("") }
    var pincode by remember { mutableStateOf("") }
    var consent by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    val gstinOk = gstin.isBlank() || GSTIN.matches(gstin.trim().uppercase())
    val addressOk = !wholesaler || (address.isNotBlank() && city.isNotBlank() && state.isNotBlank() && PINCODE.matches(pincode))
    val credentialsOk = !byEmail || (looksLikeEmail(email) && password.length >= 8)
    val valid = name.isNotBlank() && business.isNotBlank() && gstinOk && addressOk && consent && credentialsOk

    fun submit() {
        val profile = if (wholesaler) {
            SignupProfile.Wholesaler(
                businessName = business.trim(),
                gstin = gstin.trim().uppercase().ifEmpty { null },
                addressLine = address.trim(),
                city = city.trim(),
                state = state.trim(),
                pincode = pincode.trim(),
            )
        } else {
            SignupProfile.Retailer(shopName = business.trim(), gstin = gstin.trim().uppercase().ifEmpty { null })
        }
        scope.launch {
            busy = true
            error = null
            try {
                if (registrationToken != null) {
                    vm.auth.register(registrationToken, name.trim(), profile, email = null)
                } else {
                    vm.auth.registerWithEmail(email, password, name.trim(), profile)
                    onEmailCodeSent(email.trim())
                }
            } catch (e: ApiException) {
                error = e.message
            } finally {
                busy = false
            }
        }
    }

    Surface(Modifier.fillMaxSize()) {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            SignupHeader(
                title = "Create your account",
                subtitle = "Tell us about your business. We check every account before it goes live.",
                verifiedPhone = phone?.let { "+91 ${PhoneNumber.display(it)}" },
            )
            FormSection("I want to")
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                ChoiceCard("Buy parts", "Retail shop or repair centre", Icons.Outlined.Storefront, !wholesaler, { wholesaler = false }, Modifier.weight(1f))
                ChoiceCard("Sell parts", "Wholesaler or distributor", Icons.Outlined.Warehouse, wholesaler, { wholesaler = true }, Modifier.weight(1f))
            }
            if (byEmail) {
                FormSection("Sign-in details")
                EmailField(email, { email = it })
                PasswordField("Choose a password", password, { password = it }, newPassword = true)
            }

            FormSection("About you")
            Field("Your name", name, { name = it }, capitalize = KeyboardCapitalization.Words)
            Field(if (wholesaler) "Business name" else "Shop name", business, { business = it }, capitalize = KeyboardCapitalization.Words)
            Field(
                "GSTIN (optional)",
                gstin,
                { gstin = it.uppercase().take(15) },
                capitalize = KeyboardCapitalization.Characters,
                error = if (gstinOk) null else "Check the GSTIN: 15 characters, e.g. 27AAPFU0939F1ZV",
            )
            if (wholesaler) {
                FormSection("Pickup address")
                Field("Address", address, { address = it })
                Field("City", city, { city = it }, capitalize = KeyboardCapitalization.Words)
                Field("State", state, { state = it }, capitalize = KeyboardCapitalization.Words)
                Field(
                    "PIN code",
                    pincode,
                    { pincode = it.filter(Char::isDigit).take(6) },
                    keyboard = KeyboardType.Number,
                    error = if (pincode.isEmpty() || PINCODE.matches(pincode)) null else "Enter the 6-digit PIN code",
                )
            }

            Row(
                Modifier.fillMaxWidth().toggleable(value = consent, role = Role.Checkbox, onValueChange = { consent = it }),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Checkbox(checked = consent, onCheckedChange = null)
                ConsentText()
            }

            ErrorText(error)
            PrimaryButton("Create account", onClick = ::submit, enabled = valid, loading = busy)
            TextButton(onClick = onBack) { Text("Back") }
        }
    }
}

@Composable
private fun Field(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    capitalize: KeyboardCapitalization = KeyboardCapitalization.Sentences,
    keyboard: KeyboardType = KeyboardType.Text,
    error: String? = null,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        singleLine = true,
        isError = error != null,
        supportingText = error?.let { { Text(it) } },
        keyboardOptions = KeyboardOptions(capitalization = capitalize, keyboardType = keyboard),
        modifier = Modifier.fillMaxWidth(),
    )
}
