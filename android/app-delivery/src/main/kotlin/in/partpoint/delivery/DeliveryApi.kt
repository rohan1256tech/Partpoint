package `in`.partpoint.delivery

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.Serializable
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import javax.inject.Singleton

// Mirrors backend delivery.routes.ts and the delivery view of orders.service.ts. Money is paise.

@Serializable data class Page<T>(val items: List<T>, val nextCursor: String? = null)
@Serializable data class Ref(val id: String, val businessName: String? = null, val shopName: String? = null)

@Serializable
data class JobSummary(
    val id: String,
    val orderNumber: String,
    val status: String,
    val totalPaise: Long,
    val itemCount: Int,
    val wholesaler: Ref,
    val retailer: Ref? = null,
    val createdAt: String,
)

@Serializable
data class Place(
    val businessName: String? = null,
    val contactName: String? = null,
    val contactPhone: String? = null,
    val phone: String? = null,
    val addressLine: String? = null,
    val line1: String? = null,
    val line2: String? = null,
    val landmark: String? = null,
    val city: String,
    val state: String = "",
    val pincode: String,
    val latitude: Double? = null,
    val longitude: Double? = null,
) {
    fun street() = addressLine ?: listOfNotNull(line1, line2, landmark).joinToString(", ")
    /** After delivery the street is withheld; show just the area then, without a stray comma. */
    fun full() = listOf(street(), "$city $pincode").filter { it.isNotBlank() }.joinToString(", ")
    fun phoneNumber() = phone ?: contactPhone
}

@Serializable data class JobItem(val productName: String, val variantName: String, val qty: Int)

@Serializable
data class Job(
    val id: String,
    val orderNumber: String,
    val status: String,
    val itemCount: Int,
    val wholesaler: Ref,
    val retailer: Ref? = null,
    val address: Place,
    val pickup: Place? = null,
    val items: List<JobItem> = emptyList(),
    val deliveryAccepted: Boolean = false,
    val deliveredAt: String? = null,
    val createdAt: String,
) {
    /** Assigned but not yet accepted: an offer the rider can take or decline. */
    val isOffer get() = status == "assigned" && !deliveryAccepted
}

/** A packed order no rider has taken yet (backend OpenJob): areas only until it is taken. */
@Serializable data class JobArea(val businessName: String? = null, val city: String, val pincode: String)
@Serializable
data class OpenJob(
    val id: String,
    val orderNumber: String,
    val itemCount: Int,
    val pickup: JobArea,
    val drop: JobArea,
    val earningPaise: Long = 0,
    val readySince: String,
)
@Serializable data class OpenJobs(val items: List<OpenJob>)

@Serializable data class Availability(val isAvailable: Boolean)
@Serializable data class OtpBody(val otp: String)
@Serializable data class DeclineBody(val reason: String? = null)

@Serializable
data class Earning(val orderId: String, val orderNumber: String, val amountPaise: Long, val deliveredAt: String, val paidOut: Boolean = false)

@Serializable
data class Earnings(
    val todayPaise: Long = 0,
    val last7DaysPaise: Long = 0,
    val thisMonthPaise: Long = 0,
    val allTimePaise: Long = 0,
    val unpaidPaise: Long = 0,
    val deliveredCount: Int = 0,
    val recent: List<Earning> = emptyList(),
)

@Serializable data class RiderProfile(val vehicleType: String? = null, val vehicleNumber: String? = null, val isAvailable: Boolean = false)
@Serializable data class RiderMe(val id: String, val name: String, val phone: String? = null, val profile: RiderProfile? = null)

interface DeliveryApi {
    @GET("v1/me") suspend fun me(): RiderMe
    @PATCH("v1/delivery/availability") suspend fun setAvailability(@Body body: Availability): Availability

    /** Packed orders offered to every available rider; the first to take one gets it. */
    @GET("v1/delivery/jobs") suspend fun openJobs(): OpenJobs
    @POST("v1/delivery/jobs/{id}/take") suspend fun take(@Path("id") id: String): Job

    @GET("v1/delivery/orders") suspend fun jobs(@Query("scope") scope: String? = null, @Query("cursor") cursor: String? = null, @Query("limit") limit: Int = 50): Page<JobSummary>
    @GET("v1/delivery/orders/{id}") suspend fun job(@Path("id") id: String): Job

    @POST("v1/delivery/orders/{id}/accept") suspend fun accept(@Path("id") id: String): Job
    @POST("v1/delivery/orders/{id}/decline") suspend fun decline(@Path("id") id: String, @Body body: DeclineBody)
    @POST("v1/delivery/orders/{id}/pickup") suspend fun pickup(@Path("id") id: String): Job
    @POST("v1/delivery/orders/{id}/out-for-delivery") suspend fun outForDelivery(@Path("id") id: String): Job
    @POST("v1/delivery/orders/{id}/deliver") suspend fun deliver(@Path("id") id: String, @Body body: OtpBody): Job

    @GET("v1/delivery/earnings") suspend fun earnings(): Earnings
}

@Module
@InstallIn(SingletonComponent::class)
object DeliveryModule {
    @Provides
    @Singleton
    fun deliveryApi(retrofit: Retrofit): DeliveryApi = retrofit.create(DeliveryApi::class.java)
}
