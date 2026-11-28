package `in`.partpoint.core.auth.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dagger.hilt.android.AndroidEntryPoint
import `in`.partpoint.core.auth.AuthApi
import `in`.partpoint.core.auth.PushTokenBody
import `in`.partpoint.core.auth.R
import `in`.partpoint.core.auth.Session
import `in`.partpoint.core.auth.SessionManager
import `in`.partpoint.core.network.apiCall
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

/** Values from the client's Firebase project (gradle.properties). Empty = push is off. */
data class PushConfig(val projectId: String, val apiKey: String, val senderId: String, val appId: String) {
    val enabled get() = listOf(projectId, apiKey, senderId, appId).all { it.isNotBlank() }
}

const val CHANNEL_ORDERS = "orders"
const val CHANNEL_GENERAL = "general"
const val EXTRA_ORDER_ID = "orderId"

object PushSetup {
    /** Call from Application.onCreate. Without a Google services file, Firebase is set up from [config]. */
    fun init(context: Context, config: PushConfig): Boolean {
        createChannels(context)
        if (!config.enabled) return false
        if (FirebaseApp.getApps(context).isEmpty()) {
            FirebaseApp.initializeApp(
                context,
                FirebaseOptions.Builder()
                    .setProjectId(config.projectId)
                    .setApiKey(config.apiKey)
                    .setGcmSenderId(config.senderId)
                    .setApplicationId(config.appId)
                    .build(),
            )
        }
        return true
    }

    private fun createChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_ORDERS, "Orders and deliveries", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "New orders, status changes and delivery jobs"
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_GENERAL, "Account and announcements", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Account approval and messages from Sakshay Connect"
            },
        )
    }
}

/** A push about an order arrived: open screens refresh themselves. */
data class OrderPush(val orderId: String, val status: String?)

/**
 * Keeps this device's push token registered for whoever is signed in, and removes it on sign-out
 * so a shared phone stops receiving the previous user's notifications.
 */
@Singleton
class PushRegistrar @Inject constructor(
    private val api: AuthApi,
    private val sessions: SessionManager,
    private val config: PushConfig,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _orderPushes = MutableSharedFlow<OrderPush>(extraBufferCapacity = 8)
    val orderPushes: SharedFlow<OrderPush> = _orderPushes.asSharedFlow()

    /** Order to open after the user tapped a notification. */
    private val _openOrder = MutableStateFlow<String?>(null)
    val openOrder: StateFlow<String?> = _openOrder.asStateFlow()

    fun start() {
        if (!config.enabled) return
        scope.launch {
            sessions.session.distinctUntilChangedBy { (it as? Session.Active)?.me?.id }.collect { s ->
                if (s is Session.Active) runCatching { register(FirebaseMessaging.getInstance().token.await()) }
            }
        }
    }

    fun onNewToken(token: String) {
        if (sessions.session.value is Session.Active) scope.launch { runCatching { register(token) } }
    }

    private suspend fun register(token: String) = apiCall { api.registerPushToken(PushTokenBody(token)) }

    /** Before signing out: stop this device receiving pushes for the account. Best effort. */
    suspend fun unregister() {
        if (!config.enabled) return
        runCatching {
            val token = FirebaseMessaging.getInstance().token.await()
            apiCall { api.removePushToken(PushTokenBody(token)) }
            FirebaseMessaging.getInstance().deleteToken().await()
        }
    }

    fun onOrderPush(orderId: String, status: String?) {
        _orderPushes.tryEmit(OrderPush(orderId, status))
    }

    fun handleLaunch(intent: Intent?) {
        intent?.getStringExtra(EXTRA_ORDER_ID)?.let { _openOrder.value = it }
    }

    fun consumeOpenOrder() {
        _openOrder.value = null
    }
}

/**
 * Receives pushes. In the background Android shows them itself (from the "notification" part);
 * this shows them while the app is open, and tells open screens to refresh.
 */
@AndroidEntryPoint
class PartpointMessagingService : FirebaseMessagingService() {
    @Inject lateinit var registrar: PushRegistrar

    override fun onNewToken(token: String) = registrar.onNewToken(token)

    override fun onMessageReceived(message: RemoteMessage) {
        val orderId = message.data[EXTRA_ORDER_ID]
        if (orderId != null) registrar.onOrderPush(orderId, message.data["status"])
        val n = message.notification ?: return
        val channel = if (message.data["type"] == "order") CHANNEL_ORDERS else CHANNEL_GENERAL
        val open = (packageManager.getLaunchIntentForPackage(packageName) ?: return).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            message.data.forEach { (k, v) -> putExtra(k, v) }
        }
        val pending = PendingIntent.getActivity(this, (orderId ?: "general").hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(this, channel)
            .setSmallIcon(R.drawable.ic_stat_partpoint)
            .setContentTitle(n.title)
            .setContentText(n.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(n.body))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setPriority(if (channel == CHANNEL_ORDERS) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .build()
        if (NotificationManagerCompat.from(this).areNotificationsEnabled()) {
            try {
                // One notification per order: a newer status replaces the older one.
                NotificationManagerCompat.from(this).notify((orderId ?: message.messageId ?: "p").hashCode(), notification)
            } catch (_: SecurityException) {
                // Permission was revoked between the check and the call.
            }
        }
    }
}
