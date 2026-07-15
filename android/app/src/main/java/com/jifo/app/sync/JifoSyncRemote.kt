package com.jifo.app.sync

import com.jifo.app.network.JifoApi
import com.jifo.app.network.SyncPullResponse
import com.jifo.app.network.SyncPushRequest
import com.jifo.app.network.SyncPushResponse
import com.jifo.app.network.MediaAssetDto
import com.jifo.app.data.local.PendingMediaEntity
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody

class JifoSyncRemote(private val api: JifoApi) : SyncRemote {
    override suspend fun push(body: SyncPushRequest): SyncPushResponse = api.push(body)
    override suspend fun pull(updatedAt: String?, id: String?, limit: Int): SyncPullResponse = api.pull(updatedAt, id, limit)
    override suspend fun uploadMedia(media: PendingMediaEntity): MediaAssetDto {
        val body = media.bytes.toRequestBody(media.mimeType.toMediaTypeOrNull())
        val part = MultipartBody.Part.createFormData("file", media.fileName, body)
        return api.uploadMedia(part).item
    }
}
