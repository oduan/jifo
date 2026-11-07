package com.jifo.app.notes

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import android.widget.ImageView
import com.jifo.app.ServiceLocator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

object MediaImageLoader {
    // 列表/详情都以固定高度 CENTER_CROP 展示缩略图。视图尚未完成布局时按此上限解码,
    // 避免把 4000×3000 的原图按全尺寸解码(≈48MB ARGB_8888)导致滚动列表 OOM。
    private const val DEFAULT_MAX_EDGE = 2048

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    @Volatile private var cache = newCache(defaultMaxBytes())

    fun load(context: Context, mediaId: String, view: ImageView) {
        view.tag = mediaId
        cachedBitmap(mediaId)?.let { view.setImageBitmap(it); return }
        scope.launch {
            val bitmap = withContext(Dispatchers.IO) {
                runCatching {
                    ServiceLocator.api(context.applicationContext).media(mediaId).use { response ->
                        // 网络流只能消费一次,先落成字节数组,再做两段式降采样解码
                        decodeSampled(response.bytes(), targetMaxEdge(view))
                    }
                }.getOrNull()
            }
            if (bitmap != null) {
                cacheBitmap(mediaId, bitmap)
                if (view.tag == mediaId) view.setImageBitmap(bitmap)
            }
        }
    }

    fun loadLocal(context: Context, localUrl: String, view: ImageView) {
        view.tag = localUrl
        val localId = OfflineMediaRepository.localId(localUrl) ?: return
        cachedBitmap(localUrl)?.let { view.setImageBitmap(it); return }
        scope.launch {
            val bitmap = withContext(Dispatchers.IO) {
                val media = ServiceLocator.database(context.applicationContext).pendingMediaDao().get(localId)
                media?.bytes?.let { decodeSampled(it, targetMaxEdge(view)) }
            }
            if (bitmap != null) {
                cacheBitmap(localUrl, bitmap)
                if (view.tag == localUrl) view.setImageBitmap(bitmap)
            }
        }
    }

    // 切换账号/服务器清库时同步作废内存位图,防止上一边界的图片残留在新会话里。
    fun clearMemoryCache() {
        cache.evictAll()
    }

    // 纯函数:返回 2 的幂 inSampleSize,使解码后最长边不超过 maxEdge。
    // 例:4000×3000、上限 2048 → 2(解码为 2000×1500);已在上限内 → 1。
    internal fun calculateInSampleSize(width: Int, height: Int, maxEdge: Int): Int {
        if (width <= 0 || height <= 0 || maxEdge <= 0) return 1
        val longest = maxOf(width, height)
        var sample = 1
        while (longest / sample > maxEdge) sample *= 2
        return sample
    }

    // 两段式解码:先用 inJustDecodeBounds 只读尺寸,再按采样率二次解码,
    // 内存里只驻留最终那份降采样位图。
    internal fun decodeSampled(bytes: ByteArray, maxEdge: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        val options = BitmapFactory.Options().apply {
            inSampleSize = calculateInSampleSize(bounds.outWidth, bounds.outHeight, maxEdge)
        }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    }

    // 缓存读写入口,internal 以便单测直接驱动真实的淘汰路径
    internal fun cachedBitmap(key: String): Bitmap? = cache.get(key)

    internal fun cacheBitmap(key: String, bitmap: Bitmap) {
        cache.put(key, bitmap)
    }

    // 仅供单测:以指定字节容量重建缓存(缺省恢复按堆内存估算的默认容量)
    internal fun rebuildCacheForTest(maxBytes: Int = defaultMaxBytes()) {
        cache = newCache(maxBytes)
    }

    // 按应用可用堆的 1/8 估算缓存上限,条目大小取位图真实字节数,超限自动淘汰最久未用条目。
    private fun newCache(maxBytes: Int): LruCache<String, Bitmap> = object : LruCache<String, Bitmap>(maxBytes) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
    }

    private fun defaultMaxBytes(): Int =
        (Runtime.getRuntime().maxMemory() / 8).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()

    // 优先按视图真实像素的最长边解码;视图尚未布局时退回保守上限。
    private fun targetMaxEdge(view: ImageView): Int {
        return if (view.width > 0 && view.height > 0) maxOf(view.width, view.height) else DEFAULT_MAX_EDGE
    }
}
