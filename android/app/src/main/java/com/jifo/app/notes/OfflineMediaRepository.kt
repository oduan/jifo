package com.jifo.app.notes

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import com.jifo.app.core.model.NoteBlock
import com.jifo.app.data.local.JifoDatabase
import com.jifo.app.data.local.PendingMediaEntity
import java.time.Instant
import java.util.UUID

class OfflineMediaRepository(private val db: JifoDatabase) {
    suspend fun stage(resolver: ContentResolver, uri: Uri): NoteBlock.Image {
        val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: error("无法读取图片")
        val mimeType = resolver.getType(uri) ?: "image/jpeg"
        val fileName = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.getString(0) else null
        } ?: "android-image"
        val localId = UUID.randomUUID().toString()
        db.pendingMediaDao().put(PendingMediaEntity(localId, bytes, mimeType, fileName, Instant.now().toString()))
        return NoteBlock.Image(url = localUrl(localId), alt = fileName)
    }

    companion object {
        const val LOCAL_PREFIX = "local-media://"
        fun localUrl(localId: String) = LOCAL_PREFIX + localId
        fun localId(url: String?) = url?.takeIf { it.startsWith(LOCAL_PREFIX) }?.removePrefix(LOCAL_PREFIX)
    }
}
