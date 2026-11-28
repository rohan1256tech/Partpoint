package `in`.partpoint.core.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Where the refresh token and device id live. An interface so the session logic is unit-testable. */
interface TokenStore {
    fun refreshToken(): String?
    fun saveRefreshToken(token: String?)
    /** A stable random id for this install; sessions are bound to it. */
    fun deviceId(): String
}

/** Encrypts and decrypts small secrets. */
interface SecretCipher {
    fun encrypt(plain: String): String
    fun decrypt(sealed: String): String?
}

/**
 * AES-256-GCM with a key generated inside the Android Keystore: the key never leaves secure
 * hardware (where available) and cannot be copied off the device. Backups are disabled for the
 * app, and even a copied data file is useless without the key.
 */
class KeystoreCipher(private val alias: String = "partpoint_tokens") : SecretCipher {
    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    override fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val out = cipher.iv + cipher.doFinal(plain.toByteArray())
        return Base64.encodeToString(out, Base64.NO_WRAP)
    }

    override fun decrypt(sealed: String): String? = runCatching {
        val bytes = Base64.decode(sealed, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, 12))
        String(cipher.doFinal(bytes, 12, bytes.size - 12))
    }.getOrNull() // a reset Keystore (e.g. after a backup restore) just means "signed out"
}

private val Context.authStore by preferencesDataStore(name = "auth")
private val REFRESH = stringPreferencesKey("refresh_token_enc")
private val DEVICE = stringPreferencesKey("device_id")

/**
 * DataStore-backed store. Reads are rare (start-up, refresh) and small, so blocking calls are
 * acceptable; they run on OkHttp's or a background thread, never the main thread.
 */
class DataStoreTokenStore(private val context: Context, private val cipher: SecretCipher) : TokenStore {
    @Volatile private var cachedRefresh: String? = null
    @Volatile private var loaded = false

    override fun refreshToken(): String? {
        if (!loaded) {
            cachedRefresh = runBlocking { context.authStore.data.first()[REFRESH] }?.let(cipher::decrypt)
            loaded = true
        }
        return cachedRefresh
    }

    override fun saveRefreshToken(token: String?) {
        cachedRefresh = token
        loaded = true
        runBlocking {
            context.authStore.edit { prefs ->
                if (token == null) prefs.remove(REFRESH) else prefs[REFRESH] = cipher.encrypt(token)
            }
        }
    }

    override fun deviceId(): String = runBlocking {
        context.authStore.data.first()[DEVICE] ?: "android-${UUID.randomUUID()}".also { id ->
            context.authStore.edit { it[DEVICE] = id }
        }
    }
}
