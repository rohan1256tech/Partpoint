package `in`.partpoint.app.shop

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import `in`.partpoint.core.network.ApiException
import `in`.partpoint.core.network.apiCall
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import retrofit2.Retrofit
import javax.inject.Inject
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object ShopModule {
    @Provides
    @Singleton
    fun shopApi(retrofit: Retrofit): ShopApi = retrofit.create(ShopApi::class.java)
}

/** What a screen shows while it loads data. */
sealed interface Load<out T> {
    data object Loading : Load<Nothing>
    data class Ready<T>(val data: T) : Load<T>
    data class Failed(val message: String) : Load<Nothing>
}

/** Loads [fetch] into a [Load] flow; call [reload] for pull-to-refresh and "Try again". */
abstract class LoadingViewModel<T> : ViewModel() {
    private val _state = MutableStateFlow<Load<T>>(Load.Loading)
    val state: StateFlow<Load<T>> = _state.asStateFlow()
    private val _refreshing = MutableStateFlow(false)
    val refreshing: StateFlow<Boolean> = _refreshing.asStateFlow()

    protected abstract suspend fun fetch(): T

    fun reload(pullToRefresh: Boolean = false) {
        viewModelScope.launch {
            if (pullToRefresh) _refreshing.value = true else if (_state.value !is Load.Ready) _state.value = Load.Loading
            try {
                _state.value = Load.Ready(apiCall { fetch() })
            } catch (e: ApiException) {
                // Keep showing old data when a refresh fails; only replace a spinner with the error.
                if (_state.value !is Load.Ready) _state.value = Load.Failed(e.message ?: "Something went wrong")
            } finally {
                _refreshing.value = false
            }
        }
    }

    protected fun update(transform: (T) -> T) = _state.update { s -> if (s is Load.Ready) Load.Ready(transform(s.data)) else s }
}

/**
 * The cart, shared by every screen (badge, product page, cart, checkout). Changes are serialised
 * so fast taps on + never race; the server's reply is always the source of truth.
 */
@Singleton
class CartStore @Inject constructor(private val api: ShopApi) {
    private val mutex = Mutex()
    private val _cart = MutableStateFlow(Cart())
    val cart: StateFlow<Cart> = _cart.asStateFlow()
    private val _couponCode = MutableStateFlow<String?>(null)
    val couponCode: StateFlow<String?> = _couponCode.asStateFlow()

    suspend fun refresh() = mutex.withLock { _cart.value = apiCall { api.cart(_couponCode.value) } }

    suspend fun setQty(variantId: String, qty: Int) = mutex.withLock {
        settle(apiCall { api.setQty(variantId, QtyBody(qty)) })
    }

    suspend fun remove(variantId: String) = mutex.withLock {
        settle(apiCall { api.removeLine(variantId) })
    }

    /** Updates return the cart without the coupon applied; refetch only when a coupon is in use. */
    private suspend fun settle(updated: Cart) {
        _cart.value = if (_couponCode.value == null) updated else apiCall { api.cart(_couponCode.value) }
    }

    /** Applies a coupon; the cart reports whether it is valid (couponError). */
    suspend fun applyCoupon(code: String?) = mutex.withLock {
        _couponCode.value = code?.trim()?.uppercase()?.ifEmpty { null }
        _cart.value = apiCall { api.cart(_couponCode.value) }
    }

    fun qtyOf(variantId: String): Int = _cart.value.groups.flatMap { it.lines }.firstOrNull { it.variantId == variantId }?.qty ?: 0

    /** After a successful order the server empties the cart. */
    fun clearLocal() {
        _cart.value = Cart()
        _couponCode.value = null
    }
}
