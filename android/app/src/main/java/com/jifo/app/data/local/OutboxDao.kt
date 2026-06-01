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
    suspend fun deletePendingDeleteForNote(noteId: String, clientId: String)
}
