package com.jifo.app.notes

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import com.jifo.app.core.model.NoteBlock
import com.jifo.app.data.local.JifoDatabase
import com.jifo.app.data.local.PendingMediaEntity
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class OfflineMediaRepository(private val db: JifoDatabase) {
    suspend fun stage(resolver: ContentResolver, uri: Uri): NoteBlock.Image {
        val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: error("无法读取图片")
        val mimeType = resolver.getType(uri) ?: "image/jpeg"
        val fileName = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        } ?: "android-image"
        // 原图动辄 4000×3000(数十 MB),同步完成前会一直压在 pending_media 表里;入库前先压缩。
        // 解码/编码是重活,放到 IO 线程,避免拖慢调用方所在的主线程。
        val stored = withContext(Dispatchers.IO) { downscaleForStorage(bytes, mimeType) }
        val localId = UUID.randomUUID().toString()
        db.pendingMediaDao().put(PendingMediaEntity(localId, stored, mimeType, fileName, Instant.now().toString()))
        return NoteBlock.Image(url = localUrl(localId), alt = fileName)
    }

    companion object {
        // 入库存储上限:超过该最长边的图先降采样再存,控制 pending_media 的 BLOB 体积。
        const val MAX_STORED_EDGE = 4096
        private const val COMPRESS_QUALITY = 85
        const val LOCAL_PREFIX = "local-media://"
        fun localUrl(localId: String) = LOCAL_PREFIX + localId
        fun localId(url: String?) = url?.takeIf { it.startsWith(LOCAL_PREFIX) }?.removePrefix(LOCAL_PREFIX)

        // 只对能按原格式重编码的类型压缩,文件名与 mime 语义保持不变;
        // 其余格式(gif/heic 等)无法保证等格式回写,原样入库。
        private fun compressFormat(mimeType: String): Bitmap.CompressFormat? = when (mimeType) {
            "image/jpeg" -> Bitmap.CompressFormat.JPEG
            "image/png" -> Bitmap.CompressFormat.PNG
            "image/webp" -> @Suppress("DEPRECATION") Bitmap.CompressFormat.WEBP
            else -> null
        }

        // 超过 maxEdge 的图降采样后按原格式重编码;尺寸已达标、解码失败或压完反而更大时,原样返回。
        // maxEdge 供单测注入小阈值驱动完整路径,生产走默认的 MAX_STORED_EDGE。
        internal fun downscaleForStorage(bytes: ByteArray, mimeType: String, maxEdge: Int = MAX_STORED_EDGE): ByteArray {
            val format = compressFormat(mimeType) ?: return bytes
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return bytes
            val sample = MediaImageLoader.calculateInSampleSize(bounds.outWidth, bounds.outHeight, maxEdge)
            if (sample <= 1) return bytes
            val options = BitmapFactory.Options().apply { inSampleSize = sample }
            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return bytes
            val out = ByteArrayOutputStream()
            if (!bitmap.compress(format, COMPRESS_QUALITY, out)) return bytes
            return if (out.size() in 1 until bytes.size) out.toByteArray() else bytes
        }
    }
}
