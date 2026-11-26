plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
}

/** README: versionCode = git commit count (CI checks out full history). */
val commitCount: Int = providers.exec { commandLine("git", "rev-list", "--count", "HEAD") }
    .standardOutput.asText.map { it.trim().toIntOrNull() ?: 1 }.getOrElse(1)

val appIdPrefix = providers.gradleProperty("partpoint.appIdPrefix").get()

android {
    namespace = "in.partpoint.delivery"
    compileSdk {
        version = release(37) { minorApiLevel = 1 }
    }

    defaultConfig {
        applicationId = "$appIdPrefix.delivery"
        minSdk = 26
        targetSdk = 36
        versionCode = commitCount
        versionName = "0.1.0"
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug" // installs next to the release app
            buildConfigField("String", "API_BASE_URL", "\"${providers.gradleProperty("partpoint.debugApiBaseUrl").get()}\"")
        }
        release {
            isMinifyEnabled = true // R8: shrink + obfuscate
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            buildConfigField("String", "API_BASE_URL", "\"${providers.gradleProperty("partpoint.apiBaseUrl").get()}\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(project(":core:network"))
    implementation(project(":core:auth"))
    implementation(project(":core:ui"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.hilt.android)
    implementation(libs.hilt.navigation.compose)
    implementation(libs.hilt.lifecycle.viewmodel.compose)
    ksp(libs.hilt.compiler)

    testImplementation(libs.junit)
}
