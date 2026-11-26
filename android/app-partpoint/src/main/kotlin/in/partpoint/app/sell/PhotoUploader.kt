package `in`.partpoint.app.sell

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import dagger.hilt.android.qualifiers.ApplicationContext
import `in`.partpoint.app.shop.ProductDetail
import `in`.partpoint.core.network.ApiException
import `in`.partpoint.core.network.BareClient
import `in`.partpoint.core.network.apiCall
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayOutputStream
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.math.max
import kotlin.math.roundToInt

const val MAX_UPLOAD_BYTES = 1024 * 1024
const val MAX_DIMENSION = 1600

/** Scales (w, h) to fit inside max × max, keeping the aspect ratio. Never upscales. */
fun fitWithin(w: Int, h: Int, maxSide: Int = MAX_DIMENSION): Pair<Int, Int> {
    val scale = minOf(1.0, maxSide.toDouble() / max(w, h))
    return max(1, (w * scale).roundToInt()) to max(1, (h * scale).roundToInt())
}

/**
 * Product photos: picked with the system Photo Picker (no storage permission), resized and
 * re-encoded as WebP ≤ 1 MB on the phone — which also drops EXIF metadata such as GPS — then
 * uploaded straight to storage with a short-lived signed URL and attached to the product.
 */
@Singleton
class PhotoUploader @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: SellerApi,
    /** No Authorization header: storage URLs are signed and reject a second auth method. */
    @BareClient private val http: OkHttpClient,
) {
    suspend fun upload(productId: String, uri: Uri): ProductDetail {
        val webp = withContext(Dispatchers.Default) { toWebp(uri) }
        val ticket = apiCall { api.imageUploadUrl(productId, UploadRequest(sizeBytes = webp.size)) }
        withContext(Dispatchers.IO) {
            val request = Request.Builder()
                .url(ticket.upload.url)
                .put(webp.toRequestBody("image/webp".toMediaType()))
                // content-length comes from the body; it equals the signed size.
                .apply { ticket.upload.headers.filterKeys { !it.equals("content-length", true) }.forEach { (k, v) -> header(k, v) } }
                .build()
            try {
                http.newCall(request).execute().use { res -> if (!res.isSuccessful) throw ApiException.Http(res.code, "UPLOAD_FAILED", "Photo upload failed (${res.code}). Please try again.") }
            } catch (e: IOException) {
                throw ApiException.Network(e)
            }
        }
        return apiCall { api.attachImage(productId, AttachImage(ticket.objectKey)) }
    }

    /** Decodes the photo already scaled to fit MAX_DIMENSION, so large camera images never fill memory. */
    private fun decodeScaled(uri: Uri): Bitmap {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val source = ImageDecoder.createSource(context.contentResolver, uri)
            return ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
                val (w, h) = fitWithin(info.size.width, info.size.height)
                decoder.setTargetSize(w, h)
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
        }
        // Android 8: read the size, decode with power-of-two sampling, then scale exactly.
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_DIMENSION) sample *= 2
        val sampled = context.contentResolver.openInputStream(uri).use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: throw ApiException.Http(0, "IMAGE_UNREADABLE", "This photo can't be read. Try a different one.")
        val (w, h) = fitWithin(sampled.width, sampled.height)
        if (w == sampled.width && h == sampled.height) return sampled
        return Bitmap.createScaledBitmap(sampled, w, h, true).also { sampled.recycle() }
    }

    private fun toWebp(uri: Uri): ByteArray {
        val decoded = decodeScaled(uri)
        var bitmap = decoded
        try {
            // Lower quality first, then size, until it fits.
            for (attempt in 0 until 6) {
                val quality = (85 - attempt * 10).coerceAtLeast(50)
                val out = ByteArrayOutputStream()
                val format = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Bitmap.CompressFormat.WEBP_LOSSY else @Suppress("DEPRECATION") Bitmap.CompressFormat.WEBP
                bitmap.compress(format, quality, out)
                if (out.size() <= MAX_UPLOAD_BYTES) return out.toByteArray()
                if (attempt >= 2) {
                    val (w, h) = fitWithin(bitmap.width, bitmap.height, (max(bitmap.width, bitmap.height) * 0.75).roundToInt())
                    val smaller = Bitmap.createScaledBitmap(bitmap, w, h, true)
                    if (bitmap !== decoded) bitmap.recycle()
                    bitmap = smaller
                }
            }
            throw ApiException.Http(0, "IMAGE_TOO_LARGE", "This photo is too large. Try a different one.")
        } finally {
            if (bitmap !== decoded) bitmap.recycle()
            decoded.recycle()
        }
    }
}
