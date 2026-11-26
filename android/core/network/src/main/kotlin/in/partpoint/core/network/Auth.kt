package `in`.partpoint.core.network

import okhttp3.Authenticator
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route

/**
 * Supplied by core:auth. Kept as an interface so the network layer never sees how tokens
 * are stored (encrypted with an Android Keystore key).
 */
interface TokenProvider {
    /** The current access token, or null when signed out. */
    fun accessToken(): String?

    /**
     * Gets a new access token with the refresh token. Called on OkHttp's thread, so it blocks.
     * [failedToken] is the token the server just rejected: if another request already refreshed,
     * the implementation returns the newer token without refreshing again.
     * Returns null when the session is over.
     */
    fun refreshBlocking(failedToken: String?): String?
}

/** Adds `Authorization: Bearer …` to every request that does not opt out. */
class AuthInterceptor(private val tokens: TokenProvider) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        if (request.header(NO_AUTH) != null) {
            return chain.proceed(request.newBuilder().removeHeader(NO_AUTH).build())
        }
        val token = tokens.accessToken() ?: return chain.proceed(request)
        return chain.proceed(request.withToken(token))
    }

    companion object {
        /** Add this header (any value) to a Retrofit method to send it without a token. */
        const val NO_AUTH = "X-No-Auth"
    }
}

/**
 * On 401, refreshes the access token once and retries. Gives up after one retry, so a bad
 * refresh can never loop. Concurrent 401s share one refresh (see [TokenProvider.refreshBlocking]).
 */
class TokenAuthenticator(private val tokens: TokenProvider) : Authenticator {
    override fun authenticate(route: Route?, response: Response): Request? {
        if (response.priorResponse != null) return null // already retried once
        val failed = response.request.header("Authorization")?.removePrefix("Bearer ")?.trim() ?: return null
        val fresh = tokens.refreshBlocking(failed) ?: return null
        return response.request.withToken(fresh)
    }
}

private fun Request.withToken(token: String): Request = newBuilder().header("Authorization", "Bearer $token").build()
