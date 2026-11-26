# Partpoint Android apps

Two apps from one Gradle project (Kotlin, Jetpack Compose, Hilt, Retrofit):

| Module | App | Who uses it |
|---|---|---|
| `app-partpoint` | Partpoint (`<prefix>.app`) | Retailers and wholesalers |
| `app-delivery` | Partpoint Delivery (`<prefix>.delivery`) | Delivery partners |
| `core:network` | — | HTTP client, auth header, refresh-on-401, API errors |
| `core:auth` | — | Phone OTP sign-in, session, encrypted token storage, account screens |
| `core:ui` | — | Theme and shared components |

## Toolchain (this machine)

Installed on E: to save space on C:, all free: JDK 17 (Temurin) in `E:\Android\jdk-17…`, Android SDK in
`E:\Android\Sdk` (platforms 36, 37.0, 37.1; build-tools 37.0.0; platform-tools), Gradle cache in
`E:\Android\gradle-home`. `JAVA_HOME`, `ANDROID_HOME` and `GRADLE_USER_HOME` are set for your Windows user.

```bash
./gradlew testDebugUnitTest                                   # unit tests
./gradlew :app-partpoint:assembleDebug :app-delivery:assembleDebug   # APKs in app-*/build/outputs/apk/debug
```

Debug builds talk to the local backend at `http://10.0.2.2/` (the host machine as seen from the emulator).
On a real phone over USB: `adb reverse tcp:80 tcp:80` and set `partpoint.debugApiBaseUrl=http://localhost/`.

## Before the first Play upload

- **Application IDs are permanent.** `partpoint.appIdPrefix` in `gradle.properties` is a placeholder
  (`in.partpoint`); set it to the client's domain in reverse (e.g. `com.clientname`) before uploading.
- Set `partpoint.apiBaseUrl` to the HTTPS API URL (release builds refuse plain HTTP).
- Replace the placeholder icon and brand colour (`core/ui/.../Theme.kt`).

## Security

- Access token in memory only; refresh token encrypted with an Android Keystore AES-GCM key.
- Backups and device transfer disabled; release builds allow HTTPS only and strip debug logs (R8).
- OTP screen blocks screenshots (`FLAG_SECURE`); the code is filled from the SMS by the keyboard, so no
  SMS permission is requested. Neither app requests location yet; only the delivery app will.
