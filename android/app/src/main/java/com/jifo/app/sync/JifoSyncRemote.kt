package com.jifo.app.sync

import com.jifo.app.network.JifoApi
import com.jifo.app.network.SyncPullResponse
import com.jifo.app.network.SyncPushRequest
import com.jifo.app.network.SyncPushResponse

class JifoSyncRemote(private val api: JifoApi) : SyncRemote {
    override suspend fun push(body: SyncPushRequest): SyncPushResponse = api.push(body)
    override suspend fun pull(updatedAt: String?, id: String?, limit: Int): SyncPullResponse = api.pull(updatedAt, id, limit)
}
