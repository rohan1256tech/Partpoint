package `in`.partpoint.app

import android.app.Application
import android.os.Build
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.HiltAndroidApp
import dagger.hilt.components.SingletonComponent
import `in`.partpoint.core.network.ApiConfig
import `in`.partpoint.core.network.ClientApp
import javax.inject.Inject
import javax.inject.Singleton
import `in`.partpoint.core.auth.push.PushConfig
import `in`.partpoint.core.auth.push.PushRegistrar
import `in`.partpoint.core.auth.push.PushSetup

@HiltAndroidApp
class PartpointApp : Application() {
    @Inject lateinit var push: PushRegistrar
    @Inject lateinit var pushConfig: PushConfig

    override fun onCreate() {
        super.onCreate()
        if (PushSetup.init(this, pushConfig)) push.start()
    }
}

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    @Singleton
    fun pushConfig() = PushConfig(BuildConfig.FIREBASE_PROJECT_ID, BuildConfig.FIREBASE_API_KEY, BuildConfig.FIREBASE_SENDER_ID, BuildConfig.FIREBASE_APP_ID)

    @Provides
    @Singleton
    fun apiConfig(): ApiConfig = ApiConfig(
        baseUrl = BuildConfig.API_BASE_URL,
        app = ClientApp.PARTPOINT,
        userAgent = "Partpoint/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE})",
    )
}
