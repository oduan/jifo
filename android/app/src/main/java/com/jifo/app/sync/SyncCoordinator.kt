package com.jifo.app.sync

import androidx.room.withTransaction
import com.jifo.app.data.local.JifoDatabase
import com.jifo.app.data.local.NoteEntity
import com.jifo.app.data.local.SyncStateEntity
import com.jifo.app.network.ApiNoteDto
import com.jifo.app.network.PushResultDto
import com.jifo.app.notes.LocalTagIndex

class SyncCoordinator(
    private val db: JifoDatabase,
    private val remote: SyncRemote
) {
    suspend fun runOnce() {
        val operations = db.outboxDao().pendingOrFailed()
        if (operations.isNotEmpty()) {
            val response = remote.push(SyncDtoMapper.toPushRequest(operations))
            response.results.forEach { result -> applyPushResult(result) }
        }
        val cursor = db.syncStateDao().get("cursor")
        val parts = cursor?.value?.split('|') ?: emptyList()
        val pull = remote.pull(parts.getOrNull(0), parts.getOrNull(1), 100)
        val notes = if (pull.notes.isNotEmpty()) pull.notes else pull.items
        db.withTransaction {
            notes.forEach { note -> upsertPulledNote(note) }
            LocalTagIndex.rebuild(db)
            val next = pull.cursor ?: pull.nextCursor
            if (next?.updatedAt != null) {
                db.syncStateDao().put(SyncStateEntity("cursor", next.updatedAt + "|" + (next.id ?: "")))
            }
        }
    }

    private suspend fun applyPushResult(result: PushResultDto) {
        when (result.status) {
            "created", "updated", "deleted", "restored", "duplicate" -> db.withTransaction {
                val op = db.outboxDao().getByOpId(result.opId)
                if (op != null && result.noteId != null) {
                    val local = db.noteDao().getByClientId(op.clientId)
                    if (local != null) {
                        if (local.id != result.noteId) {
                            db.noteDao().deleteById(local.id)
                        }
                        db.noteDao().upsert(local.copy(id = result.noteId, version = result.version, syncStatus = "SYNCED", lastError = null))
                    }
                }
                db.outboxDao().deleteByOpId(result.opId)
                LocalTagIndex.rebuild(db)
            }
            "conflict_copied", "delete_conflict_ignored" -> db.withTransaction {
                db.outboxDao().deleteByOpId(result.opId)
                LocalTagIndex.rebuild(db)
            }
            else -> db.outboxDao().updateStatus(result.opId, "failed", "push_status:${result.status}")
        }
    }

    private suspend fun upsertPulledNote(note: ApiNoteDto) {
        val existing = db.noteDao().getById(note.id)
        if (existing?.syncStatus == "PENDING" || existing?.syncStatus == "SYNCING") return
        db.noteDao().upsert(NoteEntity(
            id = note.id,
            clientId = note.clientId,
            contentJson = NoteNetworkJson.encodeContent(note.content),
            plainText = note.plainText.orEmpty(),
            createdAt = note.createdAt ?: note.updatedAt.orEmpty(),
            updatedAt = note.updatedAt ?: note.createdAt.orEmpty(),
            version = note.version,
            deletedAt = note.deletedAt,
            syncStatus = "SYNCED"
        ))
    }
}
