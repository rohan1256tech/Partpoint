package `in`.partpoint.core.auth.push

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class PushViewModel @Inject constructor(val registrar: PushRegistrar) : ViewModel()

/** Opens the order from a tapped notification once the signed-in app is showing. */
@Composable
fun OpenOrderFromNotification(vm: PushViewModel = hiltViewModel(), open: (orderId: String) -> Unit) {
    val pending by vm.registrar.openOrder.collectAsStateWithLifecycle()
    val onOpen by rememberUpdatedState(open)
    LaunchedEffect(pending) {
        pending?.let {
            vm.registrar.consumeOpenOrder()
            onOpen(it)
        }
    }
}

/** Runs [refresh] whenever a push about an order arrives while this screen is visible. */
@Composable
fun RefreshOnOrderPush(vm: PushViewModel = hiltViewModel(), refresh: () -> Unit) {
    val onPush by rememberUpdatedState(refresh)
    LaunchedEffect(Unit) { vm.registrar.orderPushes.collect { onPush() } }
}
