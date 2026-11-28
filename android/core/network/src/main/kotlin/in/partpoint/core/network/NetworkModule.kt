package `in`.partpoint.core.network

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Qualifier
import javax.inject.Singleton

/** Which app this is; sent at sign-in so the server only lets the right roles in. */
enum class ClientApp(val wire: String) { PARTPOINT("partpoint"), DELIVERY("delivery") }

/** Provided by each app module. */
data class ApiConfig(val baseUrl: String, val app: ClientApp, val userAgent: String)

/** A client without the authenticator, for the refresh call itself (it must never recurse). */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class BareClient

val apiJson = Json {
    ignoreUnknownKeys = true // the API may add fields; old app versions keep working
    explicitNulls = false
    encodeDefaults = true
    // Signup profiles are told apart by "role", as the API expects.
    classDiscriminator = "role"
}

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    private fun base(config: ApiConfig): OkHttpClient.Builder = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            chain.proceed(chain.request().newBuilder().header("User-Agent", config.userAgent).build())
        }

    @Provides
    @Singleton
    @BareClient
    fun bareClient(config: ApiConfig): OkHttpClient = base(config).build()

    @Provides
    @Singleton
    fun client(config: ApiConfig, tokens: TokenProvider): OkHttpClient = base(config)
        .addInterceptor(AuthInterceptor(tokens))
        .authenticator(TokenAuthenticator(tokens))
        .build()

    @Provides
    @Singleton
    fun retrofit(config: ApiConfig, client: OkHttpClient): Retrofit = Retrofit.Builder()
        .baseUrl(config.baseUrl)
        .client(client)
        .addConverterFactory(apiJson.asConverterFactory("application/json".toMediaType()))
        .build()
}
