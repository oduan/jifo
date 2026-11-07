package com.jifo.app.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface OutboxDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(operation: OutboxOperationEntity): Long

    @Query("SELECT * FROM outbox_operations WHERE status IN ('pending', 'failed') ORDER BY localSeq ASC")
    suspend fun pendingOrFailed(): List<OutboxOperationEntity>

    @Query("SELECT * FROM outbox_operations WHERE opId = :opId LIMIT 1")
    suspend fun getByOpId(opId: String): OutboxOperationEntity?

    @Query("UPDATE outbox_operations SET status = :status, lastError = :lastError WHERE opId = :opId")
    suspend fun updateStatus(opId: String, status: String, lastError: String?)

    @Query("DELETE FROM outbox_operations WHERE opId = :opId")
    suspend fun deleteByOpId(opId: String)

    @Query("DELETE FROM outbox_operations WHERE action = 'delete' AND (noteId = :noteId OR clientId = :clientId) AND status IN ('pending', 'failed')")
    suspend fun deletePendingDeleteForNote(noteId: String, clientId: String): Int

    @Query("SELECT * FROM outbox_operations WHERE clientId = :clientId AND action = 'create' AND status IN ('pending', 'failed') ORDER BY localSeq ASC LIMIT 1")
    suspend fun pendingCreateForClient(clientId: String): OutboxOperationEntity?

    /** 合并新内容进未推送操作:重置 status 为 pending、清 lastError、失败计数清零——全新 payload 不应继承旧内容攒下的失败预算。 */
    @Query("UPDATE outbox_operations SET payloadJson = :payloadJson, status = 'pending', lastError = NULL, retryCount = 0 WHERE opId = :opId")
    suspend fun updatePayload(opId: String, payloadJson: String)

    /** 只更新 payload,不动 status 与 lastError(剥离失效 pending 媒体时使用)。 */
    @Query("UPDATE outbox_operations SET payloadJson = :payloadJson WHERE opId = :opId")
    suspend fun updatePayloadJson(opId: String, payloadJson: String)

    /** 推送失败的通用落账:递增重试计数、记录 lastError、置为 failed(下一轮 pendingOrFailed 仍会捞起重试)。 */
    @Query("UPDATE outbox_operations SET retryCount = retryCount + 1, status = 'failed', lastError = :lastError WHERE opId = :opId")
    suspend fun recordPushFailure(opId: String, lastError: String)

    /** 同一笔记最早的未推送 update:后续编辑合并进它并保留其 baseVersion,避免过期 baseVersion 的第二条操作在服务端 fork 伪冲突副本。 */
    @Query("SELECT * FROM outbox_operations WHERE clientId = :clientId AND action = 'update' AND status IN ('pending', 'failed') ORDER BY localSeq ASC LIMIT 1")
    suspend fun pendingUpdateForClient(clientId: String): OutboxOperationEntity?

    /** 同一笔记最早的未推送 restore:撤销删除/回收站恢复前判重,避免重复 restore op。 */
    @Query("SELECT * FROM outbox_operations WHERE clientId = :clientId AND action = 'restore' AND status IN ('pending', 'failed') ORDER BY localSeq ASC LIMIT 1")
    suspend fun pendingRestoreForClient(clientId: String): OutboxOperationEntity?

    /** 同一笔记是否有未推送的内容变更(update/restore),用于判定本地行能否回到 SYNCED。 */
    @Query("SELECT * FROM outbox_operations WHERE clientId = :clientId AND action IN ('update', 'restore') AND status IN ('pending', 'failed') ORDER BY localSeq ASC LIMIT 1")
    suspend fun pendingMutationForClient(clientId: String): OutboxOperationEntity?

    /** 合并进最早一条 update 后,清掉同 clientId 其余未推送 update(不动 restore/delete,各自语义独立),防止陈旧 payload 在其后复活。 */
    @Query("DELETE FROM outbox_operations WHERE clientId = :clientId AND action = 'update' AND status IN ('pending', 'failed') AND opId != :keepOpId")
    suspend fun deletePendingUpdatesForClientExcept(clientId: String, keepOpId: String): Int

    @Query("DELETE FROM outbox_operations WHERE clientId = :clientId AND action IN ('update', 'delete', 'restore') AND status IN ('pending', 'failed')")
    suspend fun deletePendingMutationsForClient(clientId: String)

    @Query("DELETE FROM outbox_operations WHERE clientId = :clientId AND action = 'create' AND status IN ('pending', 'failed')")
    suspend fun deletePendingCreateForClient(clientId: String)

    @Query("DELETE FROM outbox_operations WHERE noteId = :noteId OR clientId = :clientId")
    suspend fun deleteForNote(noteId: String, clientId: String)

    @Query("DELETE FROM outbox_operations")
    suspend fun clear()
}
