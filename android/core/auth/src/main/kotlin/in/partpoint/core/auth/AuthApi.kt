package `in`.partpoint.core.auth

import `in`.partpoint.core.network.AuthInterceptor
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Headers
import retrofit2.http.POST
import retrofit2.http.PUT

@Serializable
data class Tokens(val accessToken: String, val refreshToken: String, val expiresIn: Int)

@Serializable
data class Me(
    val id: String,
    val role: String,
    val status: String, // pending | approved | blocked
    val name: String,
    val phone: String? = null,
    val email: String? = null,
    val statusReason: String? = null,
) {
    val isApproved get() = status == "approved"
}

@Serializable
data class OtpRequest(val phone: String)

@Serializable
data class OtpVerify(val phone: String, val code: String, val app: String, val deviceId: String)

/** `status` is "authenticated" (tokens present) or "registration_required" (registrationToken present). */
@Serializable
data class OtpResult(
    val status: String,
    val tokens: Tokens? = null,
    val user: Me? = null,
    val registrationToken: String? = null,
)

/** The role-specific part of a signup (the API discriminates on "role"). */
@Serializable
sealed interface SignupProfile {
    @Serializable
    @SerialName("retailer")
    data class Retailer(val shopName: String, val gstin: String? = null) : SignupProfile

    @Serializable
    @SerialName("wholesaler")
    data class Wholesaler(
        val businessName: String,
        val gstin: String? = null,
        val addressLine: String,
        val city: String,
        val state: String,
        val pincode: String,
    ) : SignupProfile

    @Serializable
    @SerialName("delivery")
    data class Delivery(val vehicleType: String? = null, val vehicleNumber: String? = null) : SignupProfile
}

@Serializable
data class RegisterPhone(
    val registrationToken: String,
    val name: String,
    val consent: Boolean,
    val profile: SignupProfile,
    val app: String,
    val deviceId: String,
    val email: String? = null,
)

@Serializable
data class RegisterResult(val user: Me, val tokens: Tokens)

@Serializable
data class RefreshBody(val refreshToken: String, val deviceId: String)

@Serializable
data class LogoutBody(val refreshToken: String)

@Serializable
data class PushTokenBody(val token: String)

@Serializable
data class DeleteAccountBody(val confirm: Boolean = true, val reason: String? = null)

interface AuthApi {
    @Headers("${AuthInterceptor.NO_AUTH}: 1")
    @POST("v1/auth/otp/request")
    suspend fun requestOtp(@Body body: OtpRequest)

    @Headers("${AuthInterceptor.NO_AUTH}: 1")
    @POST("v1/auth/otp/verify")
    suspend fun verifyOtp(@Body body: OtpVerify): OtpResult

    @Headers("${AuthInterceptor.NO_AUTH}: 1")
    @POST("v1/auth/register/phone")
    suspend fun registerPhone(@Body body: RegisterPhone): RegisterResult

    @Headers("${AuthInterceptor.NO_AUTH}: 1")
    @POST("v1/auth/logout")
    suspend fun logout(@Body body: LogoutBody)

    @GET("v1/me")
    suspend fun me(): Me

    @PUT("v1/me/push-token")
    suspend fun registerPushToken(@Body body: PushTokenBody)

    @POST("v1/me/delete-account")
    suspend fun deleteAccount(@Body body: DeleteAccountBody)
}
