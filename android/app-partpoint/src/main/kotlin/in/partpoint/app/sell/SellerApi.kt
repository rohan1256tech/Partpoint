package `in`.partpoint.app.sell

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import `in`.partpoint.app.shop.OrderDetail
import `in`.partpoint.app.shop.OrderSummary
import `in`.partpoint.app.shop.Page
import `in`.partpoint.app.shop.ProductDetail
import `in`.partpoint.app.shop.ProductSummary
import kotlinx.serialization.Serializable
import okhttp3.ResponseBody
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming
import javax.inject.Singleton

// Mirrors backend catalog (supplier offers) and orders. Partpoint owns the catalog; a wholesaler
// only sets their own supply price and stock for the variants they can supply.

@Serializable data class OfferBody(val supplyPricePaise: Long, val stockQty: Int, val isActive: Boolean = true)
@Serializable data class RejectBody(val reason: String)
@Serializable data class Ok(val ok: Boolean = true)

@Serializable
data class Balance(
    val deliveredOrders: Int,
    val goodsPaise: Long,
    val commissionPaise: Long,
    val owedPaise: Long,
    val paidPaise: Long,
    val balancePaise: Long,
)

@Serializable data class Payout(val id: String, val amountPaise: Long, val reference: String? = null, val paidAt: String)
@Serializable data class FinanceView(val balance: Balance? = null, val payouts: List<Payout> = emptyList())

@Serializable data class SoldProduct(val name: String, val variant: String, val qty: Int, val salesPaise: Long)

@Serializable
data class SalesReport(
    val deliveredOrders: Int = 0,
    val goodsPaise: Long = 0,
    val commissionPaise: Long = 0,
    val netPaise: Long = 0,
    val products: List<SoldProduct> = emptyList(),
)

interface SellerApi {
    /** Partpoint's published catalog, with the wholesaler's own stock (myStockQty). */
    @GET("v1/wholesaler/catalog")
    suspend fun catalog(
        @Query("q") q: String? = null,
        @Query("mine") mine: Boolean? = null,
        @Query("cursor") cursor: String? = null,
        @Query("limit") limit: Int = 30,
    ): Page<ProductSummary>

    /** A catalog product; each variant carries the wholesaler's own offer (myOffer). */
    @GET("v1/wholesaler/catalog/{id}") suspend fun product(@Path("id") id: String): ProductDetail

    @PUT("v1/wholesaler/catalog/variants/{variantId}/offer")
    suspend fun setOffer(@Path("variantId") variantId: String, @Body body: OfferBody): ProductDetail

    @GET("v1/wholesaler/orders")
    suspend fun orders(@Query("status") status: String? = null, @Query("cursor") cursor: String? = null, @Query("limit") limit: Int = 50): Page<OrderSummary>

    @GET("v1/wholesaler/orders/{id}") suspend fun order(@Path("id") id: String): OrderDetail
    @POST("v1/wholesaler/orders/{id}/accept") suspend fun accept(@Path("id") id: String): OrderDetail
    @POST("v1/wholesaler/orders/{id}/pack") suspend fun pack(@Path("id") id: String): OrderDetail
    /** Hands the order back to Partpoint, which forwards it to another wholesaler. */
    @POST("v1/wholesaler/orders/{id}/reject") suspend fun reject(@Path("id") id: String, @Body body: RejectBody): Ok
    @Streaming @GET("v1/wholesaler/orders/{id}/invoice.pdf") suspend fun invoice(@Path("id") id: String): ResponseBody

    @GET("v1/wholesaler/finance") suspend fun finance(): FinanceView
    @GET("v1/wholesaler/reports/sales") suspend fun sales(@Query("from") from: String, @Query("to") to: String, @Query("format") format: String = "json"): SalesReport
}

@Module
@InstallIn(SingletonComponent::class)
object SellerModule {
    @Provides
    @Singleton
    fun sellerApi(retrofit: Retrofit): SellerApi = retrofit.create(SellerApi::class.java)
}

