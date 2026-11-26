package `in`.partpoint.core.auth

import `in`.partpoint.core.network.ApiConfig
import `in`.partpoint.core.network.ApiException
import `in`.partpoint.core.network.TokenProvider
import `in`.partpoint.core.network.apiCall
import `in`.partpoint.core.network.apiJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

sealed interface Session {
    data object Loading : Session
    /** [notice] explains why, e.g. "Your account has been blocked". */
    data class SignedOut(val notice: String? = null) : Session
    /** Signed in. [me] says whether the account is approved yet. */
    data class Active(val me: Me) : Session
}

/**
 * Owns the session: the access token (memory only), the refresh token (encrypted at rest) and
 * the signed-in user. Implements [TokenProvider] for the network layer.
 */
class SessionManager(
    private val store: TokenStore,
    private val config: ApiConfig,
    /** Client WITHOUT the token authenticator, so a refresh never triggers another refresh. */
    private val bareClient: OkHttpClient,
) : TokenProvider {
    private val lock = Any()
    @Volatile private var access: String? = null

    private val _session = MutableStateFlow<Session>(Session.Loading)
    val session: StateFlow<Session> = _session.asStateFlow()

    val deviceId: String by lazy { store.deviceId() }

    override fun accessToken(): String? = access

    override fun refreshBlocking(failedToken: String?): String? = synchronized(lock) {
        // Another request refreshed while we waited for the lock: use its token.
        access?.let { current -> if (current != failedToken) return current }
        val refresh = store.refreshToken() ?: return null
        val body = apiJson.encodeToString(RefreshBody.serializer(), RefreshBody(refresh, deviceId))
        val request = Request.Builder()
            .url(config.baseUrl.trimEnd('/') + "/v1/auth/token/refresh")
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
        try {
            bareClient.newCall(request).execute().use { res ->
                if (res.isSuccessful) {
                    val tokens = apiJson.decodeFromString(Tokens.serializer(), res.body.string())
                    access = tokens.accessToken
                    store.saveRefreshToken(tokens.refreshToken)
                    return tokens.accessToken
                }
                if (res.code == 401 || res.code == 403) endSession("Your session has ended. Please sign in again.")
                return null
            }
        } catch (_: IOException) {
            return null // offline: keep the session, the request just fails for now
        }
    }

    /** At app start: resume from the stored refresh token, if any. */
    suspend fun restore(loadMe: suspend () -> Me) {
        if (store.refreshToken() == null) {
            _session.value = Session.SignedOut()
            return
        }
        val token = withContext(Dispatchers.IO) { refreshBlocking(null) }
        if (token == null) {
            if (_session.value is Session.Loading) _session.value = Session.SignedOut()
            return
        }
        refreshMe(loadMe)
    }

    suspend fun refreshMe(loadMe: suspend () -> Me) {
        try {
            val me = apiCall { loadMe() }
            _session.value = Session.Active(me)
        } catch (e: ApiException.Http) {
            when (e.code) {
                "ACCOUNT_BLOCKED" -> endSession(e.message)
                "SESSION_REVOKED", "UNAUTHORIZED", "INVALID_TOKEN" -> endSession(null)
                else -> throw e
            }
        }
    }

    fun signedIn(tokens: Tokens, me: Me) {
        synchronized(lock) {
            access = tokens.accessToken
            store.saveRefreshToken(tokens.refreshToken)
        }
        _session.value = Session.Active(me)
    }

    /** Local sign-out. The caller revokes the server session first when online. */
    fun endSession(notice: String?) {
        synchronized(lock) {
            access = null
            store.saveRefreshToken(null)
        }
        _session.value = Session.SignedOut(notice)
    }

    fun currentRefreshToken(): String? = store.refreshToken()
}
