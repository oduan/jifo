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
    override suspend fun push(body: SyncPushRequest): SyncPushResponse = SyncPushResponse(pushResults)
    override suspend fun pull(updatedAt: String?, id: String?, limit: Int): SyncPullResponse = SyncPullResponse(notes = pullNotes)
}
