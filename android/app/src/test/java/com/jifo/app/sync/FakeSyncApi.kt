package com.jifo.app.sync

import com.jifo.app.network.ApiNoteDto
import com.jifo.app.network.PushResultDto
import com.jifo.app.network.SyncPullResponse
import com.jifo.app.network.SyncPushRequest
import com.jifo.app.network.SyncPushResponse
import com.jifo.app.network.MediaAssetDto
import com.jifo.app.data.local.PendingMediaEntity

class FakeSyncApi(
    private val pushResults: List<PushResultDto>,
    private val pullNotes: List<ApiNoteDto>
) : SyncRemote {
    val pullCalls = mutableListOf<Pair<String?, String?>>()
    val pushedOpIds = mutableListOf<String>()
    val pushedBodies = mutableListOf<SyncPushRequest>()
    val uploadedMediaIds = mutableListOf<String>()

    override suspend fun push(body: SyncPushRequest): SyncPushResponse {
        pushedBodies += body
        pushedOpIds += body.operations.map { it.opId }
        return SyncPushResponse(pushResults)
    }

    override suspend fun pull(updatedAt: String?, id: String?, limit: Int): SyncPullResponse {
        pullCalls += updatedAt to id
        val start = if (updatedAt == null) 0 else 1
        val page = pullNotes.drop(start).take(1)
        val next = page.lastOrNull()?.let { com.jifo.app.network.SyncCursorDto(it.updatedAt, it.id.ifBlank { it.noteId }) }
        return SyncPullResponse(notes = page, cursor = next, nextCursor = next)
    }

    override suspend fun uploadMedia(media: PendingMediaEntity): MediaAssetDto {
        uploadedMediaIds += media.localId
        return MediaAssetDto("media-${media.localId}", "image", media.mimeType, media.bytes.size.toLong(), "checksum", "/api/media/media-${media.localId}", "2026-05-31T00:00:00Z")
    }
}
