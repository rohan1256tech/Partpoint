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
import `in`.partpoint.app.shop.Slab
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.ResponseBody
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming
import javax.inject.Singleton

// Mirrors backend catalog.schemas.ts (productCreate, productUpdate, variantInput, variantUpdate).

@Serializable
data class VariantInput(
    val name: String,
    val sku: String? = null,
    val mrpPaise: Long,
    val pricePaise: Long,
    val stockQty: Int,
    val minOrderQty: Int = 1,
    val slabs: List<Slab> = emptyList(),
)

@Serializable
data class VariantPatch(
    val name: String? = null,
    val sku: String? = null,
    val mrpPaise: Long? = null,
    val pricePaise: Long? = null,
    val stockQty: Int? = null,
    val minOrderQty: Int? = null,
    val isActive: Boolean? = null,
    val slabs: List<Slab>? = null,
)

@Serializable
data class ProductCreate(
    val categoryId: String,
    val brandId: String? = null,
    val name: String,
    val description: String? = null,
    val partNumber: String? = null,
    val hsnCode: String? = null,
    val gstRateBps: Int,
    val variants: List<VariantInput>,
)

/**
 * PATCH body: every field is sent, with null meaning "clear it". The shared JSON settings omit
 * nulls, so [toJson] writes them explicitly; otherwise clearing a brand would silently do nothing.
 */
data class ProductPatch(
    val categoryId: String,
    val brandId: String?,
    val name: String,
    val description: String?,
    val partNumber: String?,
    val hsnCode: String?,
    val gstRateBps: Int,
) {
    fun toJson(): JsonObject = buildJsonObject {
        put("categoryId", categoryId)
        put("brandId", brandId)
        put("name", name)
        put("description", description)
        put("partNumber", partNumber)
        put("hsnCode", hsnCode)
        put("gstRateBps", gstRateBps)
    }
}

@Serializable data class UploadRequest(val contentType: String = "image/webp", val sizeBytes: Int)
@Serializable data class PresignedUpload(val method: String, val url: String, val headers: Map<String, String>, val expiresAt: String)
@Serializable data class UploadTicket(val objectKey: String, val upload: PresignedUpload)
@Serializable data class AttachImage(val objectKey: String)
@Serializable data class RejectBody(val reason: String)

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
    @GET("v1/wholesaler/products")
    suspend fun products(@Query("status") status: String? = null, @Query("q") q: String? = null, @Query("cursor") cursor: String? = null, @Query("limit") limit: Int = 50): Page<ProductSummary>

    @GET("v1/wholesaler/products/{id}") suspend fun product(@Path("id") id: String): ProductDetail
    @POST("v1/wholesaler/products") suspend fun create(@Body body: ProductCreate): ProductDetail
    @PATCH("v1/wholesaler/products/{id}") suspend fun update(@Path("id") id: String, @Body body: JsonObject): ProductDetail
    @POST("v1/wholesaler/products/{id}/publish") suspend fun publish(@Path("id") id: String): ProductDetail
    @POST("v1/wholesaler/products/{id}/hide") suspend fun hide(@Path("id") id: String): ProductDetail
    @POST("v1/wholesaler/products/{id}/variants") suspend fun addVariant(@Path("id") id: String, @Body body: VariantInput): ProductDetail
    @PATCH("v1/wholesaler/products/variants/{variantId}") suspend fun updateVariant(@Path("variantId") variantId: String, @Body body: VariantPatch): ProductDetail

    @POST("v1/wholesaler/products/{id}/images/upload-url") suspend fun imageUploadUrl(@Path("id") id: String, @Body body: UploadRequest): UploadTicket
    @POST("v1/wholesaler/products/{id}/images") suspend fun attachImage(@Path("id") id: String, @Body body: AttachImage): ProductDetail
    @DELETE("v1/wholesaler/products/{id}/images/{imageId}") suspend fun removeImage(@Path("id") id: String, @Path("imageId") imageId: String): ProductDetail

    @GET("v1/wholesaler/orders")
    suspend fun orders(@Query("status") status: String? = null, @Query("cursor") cursor: String? = null, @Query("limit") limit: Int = 50): Page<OrderSummary>

    @GET("v1/wholesaler/orders/{id}") suspend fun order(@Path("id") id: String): OrderDetail
    @POST("v1/wholesaler/orders/{id}/accept") suspend fun accept(@Path("id") id: String): OrderDetail
    @POST("v1/wholesaler/orders/{id}/pack") suspend fun pack(@Path("id") id: String): OrderDetail
    @POST("v1/wholesaler/orders/{id}/reject") suspend fun reject(@Path("id") id: String, @Body body: RejectBody): OrderDetail
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

