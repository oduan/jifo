package com.jifo.app.notes

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.widget.ImageView
import com.jifo.app.ServiceLocator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.ConcurrentHashMap

object MediaImageLoader {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val cache = ConcurrentHashMap<String, Bitmap>()

    fun load(context: Context, mediaId: String, view: ImageView) {
        view.tag = mediaId
        cache[mediaId]?.let { view.setImageBitmap(it); return }
        scope.launch {
            val bitmap = withContext(Dispatchers.IO) {
                runCatching { ServiceLocator.api(context.applicationContext).media(mediaId).use { BitmapFactory.decodeStream(it.byteStream()) } }.getOrNull()
            }
            if (bitmap != null) {
                cache[mediaId] = bitmap
                if (view.tag == mediaId) view.setImageBitmap(bitmap)
            }
        }
    }

    fun loadLocal(context: Context, localUrl: String, view: ImageView) {
        view.tag = localUrl
        val localId = OfflineMediaRepository.localId(localUrl) ?: return
        scope.launch {
            val bitmap = withContext(Dispatchers.IO) {
                val media = ServiceLocator.database(context.applicationContext).pendingMediaDao().get(localId)
                media?.bytes?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
            }
            if (bitmap != null && view.tag == localUrl) view.setImageBitmap(bitmap)
        }
    }
}
