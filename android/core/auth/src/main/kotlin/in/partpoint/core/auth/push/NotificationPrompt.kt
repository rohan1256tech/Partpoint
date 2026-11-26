package `in`.partpoint.core.auth.push

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat

private const val PREFS = "push_prompt"

private fun needsAsk(context: Context): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED

/**
 * Asks for notification permission in context (Play policy and good manners): shown on the screen
 * where notifications matter, explains why, and stays away once answered or dismissed.
 */
@Composable
fun NotificationPrompt(key: String, title: String, reason: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
    var visible by remember { mutableStateOf(needsAsk(context) && !prefs.getBoolean(key, false)) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        prefs.edit().putBoolean(key, true).apply()
        visible = false
    }
    if (!visible) return
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.tertiaryContainer, modifier = modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.NotificationsActive, null, tint = MaterialTheme.colorScheme.onTertiaryContainer)
                Text(title, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onTertiaryContainer, modifier = Modifier.padding(start = 10.dp))
            }
            Text(reason, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onTertiaryContainer)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) launcher.launch(Manifest.permission.POST_NOTIFICATIONS) }) { Text("Turn on") }
                TextButton(onClick = {
                    prefs.edit().putBoolean(key, true).apply()
                    visible = false
                }) { Text("Not now") }
            }
        }
    }
}
