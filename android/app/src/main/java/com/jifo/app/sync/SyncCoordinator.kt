package com.jifo.app.sync

import androidx.room.withTransaction
import com.jifo.app.data.local.JifoDatabase
import com.jifo.app.data.local.NoteEntity
import com.jifo.app.data.local.SyncStateEntity
import com.jifo.app.network.ApiNoteDto
import com.jifo.app.network.PushResultDto
import com.jifo.app.notes.LocalTagIndex
import java.util.UUID

class SyncCoordinator(
    private val db: JifoDatabase,
    private val remote: SyncRemote
) {
    suspend fun runOnce() {
        repairPendingCreateMutations()
        val operations = db.outboxDao().pendingOrFailed()
        if (operations.isNotEmpty()) {
            val response = remote.push(SyncDtoMapper.toPushRequest(operations))
            response.results.forEach { result -> applyPushResult(result) }
        }
        pullAllPages()
    }

    private suspend fun repairPendingCreateMutations() {
        val operations = db.outboxDao().pendingOrFailed()
        val invalidLocalMutations = operations.filter { op ->
            op.action in setOf("update", "delete", "restore") && !isUuid(op.noteId)
        }
        if (invalidLocalMutations.isEmpty()) return
        db.withTransaction {
            invalidLocalMutations.forEach { op ->
                val pendingCreate = db.outboxDao().pendingCreateForClient(op.clientId)
                if (pendingCreate != null) {
                    when (op.action) {
                        "update", "restore" -> db.outboxDao().updatePayload(pendingCreate.opId, op.payloadJson)
                        "delete" -> db.outboxDao().deletePendingCreateForClient(op.clientId)
                    }
                    db.outboxDao().deleteByOpId(op.opId)
                } else {
                    db.outboxDao().updateStatus(op.opId, "blocked", "invalid_note_id")
                }
            }
        }
    }

    private fun isUuid(value: String?): Boolean {
        if (value.isNullOrBlank()) return false
        return runCatching { UUID.fromString(value); true }.getOrDefault(false)
    }

    private suspend fun pullAllPages() {
        var cursor = db.syncStateDao().get("cursor")
        var parts = cursor?.value?.split('|') ?: emptyList()
        repeat(100) {
            val pull = remote.pull(parts.getOrNull(0), parts.getOrNull(1), 100)
            val notes = if (pull.notes.isNotEmpty()) pull.notes else pull.items
            var nextValue: String? = null
            db.withTransaction {
                notes.forEach { note -> upsertPulledNote(note) }
                LocalTagIndex.rebuild(db)
                val next = pull.cursor ?: pull.nextCursor
                if (next?.updatedAt != null) {
                    nextValue = next.updatedAt + "|" + (next.id ?: "")
                    db.syncStateDao().put(SyncStateEntity("cursor", nextValue!!))
                }
            }
            if (notes.isEmpty() || nextValue == null || nextValue == cursor?.value) return
            cursor = SyncStateEntity("cursor", nextValue!!)
            parts = nextValue!!.split('|')
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
        val noteId = note.id.ifBlank { note.noteId.orEmpty() }
        if (noteId.isBlank()) return
        val existing = db.noteDao().getById(noteId)
        if (existing?.syncStatus == "PENDING" || existing?.syncStatus == "SYNCING") return
        db.noteDao().upsert(NoteEntity(
            id = noteId,
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
