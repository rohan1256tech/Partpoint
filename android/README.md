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

## Release builds (Google Play)

Release builds use R8 (shrunk and obfuscated; about 2.5 MB per app) and HTTPS only.

1. **Upload key** (once, kept by the client, never committed):
   keytool error: java.lang.NumberFormatException: For input string: "9125"
java.lang.NumberFormatException: For input string: "9125"
	at java.base/java.lang.NumberFormatException.forInputString(NumberFormatException.java:67)
	at java.base/java.lang.Long.parseLong(Long.java:711)
	at java.base/java.lang.Long.parseLong(Long.java:836)
	at java.base/sun.security.tools.keytool.Main.parseArgs(Main.java:625)
	at java.base/sun.security.tools.keytool.Main.run(Main.java:419)
	at java.base/sun.security.tools.keytool.Main.main(Main.java:414)
   Enrol in **Play App Signing**: Google holds the app signing key; this upload key can be reset if lost.
2. **GitHub secrets**:  (), ,
   , ; for automatic upload also .
3. **GitHub variables**: , , the five  values, then
    (and  once both apps exist in Play Console; the very first
   upload of each app must be done by hand).
4. Every push to  then builds both signed AABs (downloadable from the workflow run with the R8 mapping
   files) and, if enabled, publishes them to the **internal testing** track.

Locally:  with the passwords in
, , . Without a key the release
build is produced unsigned.

## Push notifications

Create one Firebase project, add both Android apps (their final application IDs), and copy the project ID,
web API key, sender ID and each app ID into  (or the CI variables). On the server, set
. With values missing, the apps run normally without push.

## Security

- Access token in memory only; refresh token encrypted with an Android Keystore AES-GCM key.
- Backups and device transfer disabled; release builds allow HTTPS only and strip debug logs (R8).
- OTP screen blocks screenshots (`FLAG_SECURE`); the code is filled from the SMS by the keyboard, so no
  SMS permission is requested. Neither app requests location: riders get directions through Google Maps.
