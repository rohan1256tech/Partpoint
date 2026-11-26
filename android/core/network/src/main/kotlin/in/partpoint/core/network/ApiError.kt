package `in`.partpoint.core.network

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import retrofit2.HttpException
import java.io.IOException

/** The API's error body: `{ "error": "...", "code": "OTP_INVALID", "statusCode": 400, "details": ... }`. */
@Serializable
internal data class ErrorBody(
    val error: String? = null,
    val code: String? = null,
    val statusCode: Int? = null,
    val details: JsonElement? = null,
)

/**
 * Every failure the UI needs to handle. [message] is safe to show to the user: the API writes
 * its messages for people, and network problems get a plain explanation.
 */
sealed class ApiException(message: String) : Exception(message) {
    /** The server answered with an error. [code] is stable and can be branched on (e.g. "ACCOUNT_PENDING"). */
    class Http(val status: Int, val code: String, message: String) : ApiException(message)

    /** No connection, timeout, DNS failure… */
    class Network(cause: IOException) : ApiException("No internet connection. Check your network and try again.") {
        init {
            initCause(cause)
        }
    }

    /** Session ended (refresh failed); the app should return to sign-in. */
    class SignedOut : ApiException("Your session has ended. Please sign in again.")
}

internal val errorJson = Json { ignoreUnknownKeys = true }

/** Turns Retrofit/OkHttp failures into [ApiException]s with user-facing messages. */
fun Throwable.toApiException(): ApiException = when (this) {
    is ApiException -> this
    is HttpException -> {
        val raw = response()?.errorBody()?.string()
        val body = raw?.let { runCatching { errorJson.decodeFromString(ErrorBody.serializer(), it) }.getOrNull() }
        ApiException.Http(
            status = code(),
            code = body?.code ?: "HTTP_${code()}",
            message = body?.error ?: if (code() >= 500) "Something went wrong on our side. Please try again." else "Request failed",
        )
    }
    is IOException -> ApiException.Network(this)
    else -> ApiException.Http(0, "UNKNOWN", message ?: "Something went wrong")
}

/** Runs an API call and maps any failure to [ApiException]. */
suspend fun <T> apiCall(block: suspend () -> T): T = try {
    block()
} catch (t: Throwable) {
    if (t is kotlinx.coroutines.CancellationException) throw t
    throw t.toApiException()
}
