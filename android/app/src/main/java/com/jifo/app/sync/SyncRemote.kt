package com.jifo.app.sync

import com.jifo.app.network.SyncPullResponse
import com.jifo.app.network.SyncPushRequest
import com.jifo.app.network.SyncPushResponse

interface SyncRemote {
    suspend fun push(body: SyncPushRequest): SyncPushResponse
    suspend fun pull(updatedAt: String? = null, id: String? = null, limit: Int = 100): SyncPullResponse
}
