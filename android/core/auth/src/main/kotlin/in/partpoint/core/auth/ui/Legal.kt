package `in`.partpoint.core.auth.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.partpoint.core.network.ApiConfig
import javax.inject.Inject

/** The public privacy policy is served by the API at /privacy (also the Play listing URL). */
@HiltViewModel
class LegalViewModel @Inject constructor(config: ApiConfig) : ViewModel() {
    val privacyUrl: String = config.baseUrl.trimEnd('/') + "/privacy"
}

/** "I agree to the Partpoint privacy policy" with the policy as a real, tappable link. */
@Composable
fun ConsentText(prefix: String = "I agree to the Partpoint ", vm: LegalViewModel = hiltViewModel()) {
    val linkStyle = TextLinkStyles(SpanStyle(color = MaterialTheme.colorScheme.primary, textDecoration = TextDecoration.Underline))
    Text(
        buildAnnotatedString {
            append(prefix)
            withLink(LinkAnnotation.Url(vm.privacyUrl, linkStyle)) { append("privacy policy") }
            append(".")
        },
        style = MaterialTheme.typography.bodyMedium,
    )
}

@Composable
fun PrivacyPolicyButton(modifier: Modifier = Modifier, vm: LegalViewModel = hiltViewModel()) {
    val uri = LocalUriHandler.current
    TextButton(onClick = { uri.openUri(vm.privacyUrl) }, modifier = modifier) { Text("Privacy policy") }
}
