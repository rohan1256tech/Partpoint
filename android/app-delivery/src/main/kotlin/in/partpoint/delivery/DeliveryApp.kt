package `in`.partpoint.delivery

import android.app.Application
import android.os.Build
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.HiltAndroidApp
import dagger.hilt.components.SingletonComponent
import `in`.partpoint.core.network.ApiConfig
import `in`.partpoint.core.network.ClientApp
import javax.inject.Singleton

@HiltAndroidApp
class DeliveryApp : Application()

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    @Singleton
    fun apiConfig(): ApiConfig = ApiConfig(
        baseUrl = BuildConfig.API_BASE_URL,
        app = ClientApp.DELIVERY,
        userAgent = "PartpointDelivery/${BuildConfig.VERSION_NAME} (Android ${Build.VERSION.RELEASE})",
    )
}
