package `in`.partpoint.core.auth

import android.content.Context
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import `in`.partpoint.core.network.ApiConfig
import `in`.partpoint.core.network.BareClient
import `in`.partpoint.core.network.TokenProvider
import `in`.partpoint.core.network.apiCall
import okhttp3.OkHttpClient
import `in`.partpoint.core.auth.push.PushRegistrar
import retrofit2.Retrofit
import javax.inject.Inject
import javax.inject.Singleton

sealed interface OtpOutcome {
    data object SignedIn : OtpOutcome
    /** New number: finish signing up with this token (valid 15 minutes). */
    data class NeedsSignup(val registrationToken: String) : OtpOutcome
}

@Singleton
class AuthRepository @Inject constructor(
    private val api: AuthApi,
    private val session: SessionManager,
    private val config: ApiConfig,
    private val push: PushRegistrar,
) {
    suspend fun requestOtp(phoneE164: String) = apiCall { api.requestOtp(OtpRequest(phoneE164)) }

    suspend fun verifyOtp(phoneE164: String, code: String): OtpOutcome {
        val res = apiCall { api.verifyOtp(OtpVerify(phoneE164, code, config.app.wire, session.deviceId)) }
        val tokens = res.tokens
        val user = res.user
        return if (tokens != null && user != null) {
            session.signedIn(tokens, user)
            OtpOutcome.SignedIn
        } else {
            OtpOutcome.NeedsSignup(requireNotNull(res.registrationToken) { "registration token missing" })
        }
    }

    suspend fun register(registrationToken: String, name: String, profile: SignupProfile, email: String?) {
        val res = apiCall {
            api.registerPhone(
                RegisterPhone(
                    registrationToken = registrationToken,
                    name = name,
                    consent = true,
                    profile = profile,
                    app = config.app.wire,
                    deviceId = session.deviceId,
                    email = email,
                ),
            )
        }
        session.signedIn(res.tokens, res.user)
    }

    suspend fun restore() = session.restore { api.me() }

    /** E.g. pull-to-refresh on the "awaiting approval" screen. */
    suspend fun reloadMe() = session.refreshMe { api.me() }

    suspend fun signOut() {
        push.unregister() // while still signed in, so the server accepts the removal
        session.currentRefreshToken()?.let { token ->
            runCatching { apiCall { api.logout(LogoutBody(token)) } } // best effort when offline
        }
        session.endSession(null)
    }

    /** Play policy: in-app account deletion. Throws with the server's reason when not possible yet. */
    suspend fun deleteAccount(reason: String?) {
        push.unregister()
        apiCall { api.deleteAccount(DeleteAccountBody(reason = reason)) }
        session.endSession("Your account has been deleted.")
    }
}

@Module
@InstallIn(SingletonComponent::class)
object AuthModule {
    @Provides
    @Singleton
    fun tokenStore(@ApplicationContext context: Context): TokenStore = DataStoreTokenStore(context, KeystoreCipher())

    @Provides
    @Singleton
    fun sessionManager(store: TokenStore, config: ApiConfig, @BareClient client: OkHttpClient): SessionManager =
        SessionManager(store, config, client)

    @Provides
    fun tokenProvider(session: SessionManager): TokenProvider = session

    @Provides
    @Singleton
    fun authApi(retrofit: Retrofit): AuthApi = retrofit.create(AuthApi::class.java)
}
