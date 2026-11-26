package `in`.partpoint.app.shop

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import `in`.partpoint.core.network.apiCall
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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
