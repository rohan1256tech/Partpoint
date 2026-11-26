package `in`.partpoint.app.shop

import kotlinx.serialization.Serializable
import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

// Models mirror backend/src/modules (catalog, orders, addresses, marketing, reviews). Money is integer paise.

@Serializable data class Page<T>(val items: List<T>, val nextCursor: String? = null)
@Serializable data class Items<T>(val items: List<T>)

@Serializable data class Category(val id: String, val name: String, val slug: String, val imageUrl: String? = null, val children: List<Category> = emptyList())
@Serializable data class Brand(val id: String, val name: String, val slug: String, val logoUrl: String? = null)
@Serializable data class Banner(val id: String, val title: String, val imageUrl: String, val linkType: String = "none", val linkValue: String? = null)

@Serializable data class WholesalerRef(val id: String, val businessName: String, val city: String = "", val state: String = "")

@Serializable
data class ProductSummary(
    val id: String,
    val name: String,
    val partNumber: String? = null,
    val brandName: String? = null,
    val wholesaler: WholesalerRef,
    val minPricePaise: Long? = null,
    val mrpPaise: Long? = null,
    val totalStock: Int = 0,
    val thumbnailUrl: String? = null,
    val ratingAvg: Double = 0.0,
    val ratingCount: Int = 0,
    /** draft | active | hidden | blocked (the seller sees all of them; buyers only active). */
    val status: String = "active",
    val statusReason: String? = null,
)

@Serializable data class Slab(val minQty: Int, val pricePaise: Long)

@Serializable
data class Variant(
    val id: String,
    val name: String,
    val sku: String? = null,
    val mrpPaise: Long,
    val pricePaise: Long,
    val stockQty: Int,
    val minOrderQty: Int = 1,
    val isActive: Boolean = true,
    val slabs: List<Slab> = emptyList(),
) {
    /** The unit price that applies at [qty]: the best bulk slab reached, else the base price. */
    fun unitPriceAt(qty: Int): Long = slabs.filter { qty >= it.minQty }.minOfOrNull { it.pricePaise } ?: pricePaise
}

@Serializable data class NamedRef(val id: String, val name: String)
@Serializable data class ProductImage(val id: String, val url: String, val sortOrder: Int = 0)

@Serializable
data class ProductDetail(
    val id: String,
    val name: String,
    val description: String? = null,
    val partNumber: String? = null,
    val hsnCode: String? = null,
    val gstRateBps: Int = 1800,
    val status: String = "active",
    val statusReason: String? = null,
    val ratingAvg: Double = 0.0,
    val ratingCount: Int = 0,
    val category: NamedRef,
    val brand: NamedRef? = null,
    val wholesaler: WholesalerRef,
    val images: List<ProductImage> = emptyList(),
    val variants: List<Variant> = emptyList(),
)

@Serializable
data class CartLine(
    val variantId: String,
    val productId: String,
    val productName: String,
    val variantName: String,
    val thumbnailUrl: String? = null,
    val qty: Int,
    val unitPricePaise: Long,
    val mrpPaise: Long,
    val lineTotalPaise: Long,
    val minOrderQty: Int = 1,
    val stockQty: Int,
    /** UNAVAILABLE | BELOW_MIN_QTY | OUT_OF_STOCK */
    val issue: String? = null,
)

@Serializable
data class CartGroup(
    val wholesaler: WholesalerRef,
    val lines: List<CartLine>,
    val subtotalPaise: Long,
    val discountPaise: Long,
    val deliveryFeePaise: Long,
    val totalPaise: Long,
    val belowMinOrder: Boolean = false,
)

@Serializable data class AppliedCoupon(val code: String, val discountPaise: Long)

@Serializable
data class Cart(
    val groups: List<CartGroup> = emptyList(),
    val itemCount: Int = 0,
    val subtotalPaise: Long = 0,
    val discountPaise: Long = 0,
    val deliveryFeePaise: Long = 0,
    val totalPaise: Long = 0,
    val coupon: AppliedCoupon? = null,
    val couponError: String? = null,
    val minOrderPaise: Long = 0,
    val canCheckout: Boolean = false,
)

@Serializable data class QtyBody(val qty: Int)

@Serializable
data class Address(
    val id: String,
    val label: String,
    val contactName: String,
    val contactPhone: String,
    val line1: String,
    val line2: String? = null,
    val landmark: String? = null,
    val city: String,
    val state: String,
    val pincode: String,
    val isDefault: Boolean = false,
) {
    fun oneLine() = listOfNotNull(line1, line2, landmark).joinToString(", ") + ", $city $pincode"
}

@Serializable
data class AddressInput(
    val label: String,
    val contactName: String,
    val contactPhone: String,
    val line1: String,
    val line2: String? = null,
    val landmark: String? = null,
    val city: String,
    val state: String,
    val pincode: String,
    val isDefault: Boolean = false,
)

@Serializable data class PlaceOrderBody(val addressId: String, val idempotencyKey: String, val couponCode: String? = null)

@Serializable data class RetailerRef(val id: String, val shopName: String)

@Serializable
data class OrderSummary(
    val id: String,
    val orderNumber: String,
    val status: String,
    val totalPaise: Long,
    val itemCount: Int,
    val wholesaler: WholesalerRef,
    val retailer: RetailerRef? = null,
    val createdAt: String,
)

/** The reply to placing an order: one short entry per seller (backend PlacedOrders). */
@Serializable data class PlacedOrder(val id: String, val orderNumber: String, val wholesalerId: String, val totalPaise: Long)

@Serializable data class PlacedOrders(val checkoutId: String, val totalPaise: Long, val orders: List<PlacedOrder>)

@Serializable
data class OrderItem(
    val productId: String,
    val variantId: String,
    val productName: String,
    val variantName: String,
    val qty: Int,
    val unitPricePaise: Long,
    val lineTotalPaise: Long,
)

@Serializable data class TimelineEvent(val status: String, val note: String? = null, val at: String)
@Serializable data class PersonRef(val id: String, val name: String, val phone: String? = null)

/** Retailers and riders get the full address; sellers only the area (city, state, PIN code). */
@Serializable
data class OrderAddress(
    val contactName: String? = null,
    val contactPhone: String? = null,
    val line1: String? = null,
    val line2: String? = null,
    val landmark: String? = null,
    val city: String,
    val state: String,
    val pincode: String,
)

@Serializable
data class OrderDetail(
    val id: String,
    val orderNumber: String,
    val status: String,
    val totalPaise: Long,
    val subtotalPaise: Long,
    val discountPaise: Long = 0,
    val deliveryFeePaise: Long = 0,
    val itemCount: Int,
    val wholesaler: WholesalerRef,
    val retailer: RetailerRef? = null,
    val address: OrderAddress,
    val items: List<OrderItem>,
    val timeline: List<TimelineEvent>,
    val cancelReason: String? = null,
    val deliveredAt: String? = null,
    val deliveryPartner: PersonRef? = null,
    val deliveryAccepted: Boolean = false,
    /** 4-digit code the retailer gives the rider; shown once the goods are on the way. */
    val deliveryOtp: String? = null,
    val createdAt: String,
)

@Serializable data class ReasonBody(val reason: String? = null)
@Serializable data class ReviewBody(val rating: Int, val comment: String? = null)
@Serializable data class ReportBody(val reason: String)

@Serializable
data class MyReview(val rating: Int, val comment: String? = null)

@Serializable
data class PublicReview(val id: String, val rating: Int, val comment: String? = null, val reviewerName: String, val createdAt: String)

interface ShopApi {
    @GET("v1/categories") suspend fun categories(): Items<Category>
    @GET("v1/brands") suspend fun brands(): Items<Brand>
    @GET("v1/banners") suspend fun banners(): Items<Banner>

    @GET("v1/products")
    suspend fun products(
        @Query("q") q: String? = null,
        @Query("categoryId") categoryId: String? = null,
        @Query("brandId") brandId: String? = null,
        @Query("wholesalerId") wholesalerId: String? = null,
        @Query("cursor") cursor: String? = null,
        @Query("limit") limit: Int = 20,
    ): Page<ProductSummary>

    @GET("v1/products/{id}") suspend fun product(@Path("id") id: String): ProductDetail

    @GET("v1/cart") suspend fun cart(@Query("couponCode") couponCode: String? = null): Cart
    @PUT("v1/cart/items/{variantId}") suspend fun setQty(@Path("variantId") variantId: String, @Body body: QtyBody): Cart
    @DELETE("v1/cart/items/{variantId}") suspend fun removeLine(@Path("variantId") variantId: String): Cart

    @GET("v1/wishlist") suspend fun wishlist(): Items<ProductSummary>
    @PUT("v1/wishlist/{productId}") suspend fun addToWishlist(@Path("productId") productId: String)
    @DELETE("v1/wishlist/{productId}") suspend fun removeFromWishlist(@Path("productId") productId: String)

    @GET("v1/me/addresses") suspend fun addresses(): Items<Address>
    @POST("v1/me/addresses") suspend fun addAddress(@Body body: AddressInput): Address
    @PATCH("v1/me/addresses/{id}") suspend fun updateAddress(@Path("id") id: String, @Body body: AddressInput): Address
    @DELETE("v1/me/addresses/{id}") suspend fun deleteAddress(@Path("id") id: String)

    @POST("v1/orders") suspend fun placeOrder(@Body body: PlaceOrderBody): PlacedOrders
    @GET("v1/orders") suspend fun orders(@Query("scope") scope: String? = null, @Query("cursor") cursor: String? = null): Page<OrderSummary>
    @GET("v1/orders/{id}") suspend fun order(@Path("id") id: String): OrderDetail
    @POST("v1/orders/{id}/cancel") suspend fun cancelOrder(@Path("id") id: String, @Body body: ReasonBody): OrderDetail

    @Streaming @GET("v1/orders/{id}/invoice.pdf") suspend fun invoice(@Path("id") id: String): ResponseBody

    @GET("v1/products/{id}/reviews") suspend fun productReviews(@Path("id") id: String, @Query("cursor") cursor: String? = null): Page<PublicReview>

    @PUT("v1/orders/{orderId}/reviews/{productId}")
    suspend fun review(@Path("orderId") orderId: String, @Path("productId") productId: String, @Body body: ReviewBody): MyReview

    @POST("v1/reviews/{id}/report") suspend fun reportReview(@Path("id") id: String, @Body body: ReportBody)
}
