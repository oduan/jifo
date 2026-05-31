package com.jifo.app.sync

import com.jifo.app.network.ApiNoteDto
import com.jifo.app.network.PushResultDto
import com.jifo.app.network.SyncPullResponse
import com.jifo.app.network.SyncPushRequest
import com.jifo.app.network.SyncPushResponse

class FakeSyncApi(
    private val pushResults: List<PushResultDto>,
    private val pullNotes: List<ApiNoteDto>
) : SyncRemote {
    val pullCalls = mutableListOf<Pair<String?, String?>>()

    override suspend fun push(body: SyncPushRequest): SyncPushResponse = SyncPushResponse(pushResults)

    override suspend fun pull(updatedAt: String?, id: String?, limit: Int): SyncPullResponse {
        pullCalls += updatedAt to id
        val start = if (updatedAt == null) 0 else 1
        val page = pullNotes.drop(start).take(1)
        val next = page.lastOrNull()?.let { com.jifo.app.network.SyncCursorDto(it.updatedAt, it.id.ifBlank { it.noteId }) }
        return SyncPullResponse(notes = page, cursor = next, nextCursor = next)
    }
}
