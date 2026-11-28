pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "partpoint-android"

// Two apps from one codebase (README: "Applications").
include(":app-partpoint") // retailers + wholesalers
include(":app-delivery") // delivery partners; the only module with location permission
include(":core:network")
include(":core:auth")
include(":core:ui")
