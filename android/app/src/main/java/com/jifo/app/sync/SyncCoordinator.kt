package com.jifo.app.sync

import androidx.room.withTransaction
import com.jifo.app.data.local.JifoDatabase
import com.jifo.app.data.local.NoteEntity
import com.jifo.app.data.local.OutboxOperationEntity
import com.jifo.app.data.local.SyncStateEntity
import com.jifo.app.network.ApiNoteDto
import com.jifo.app.network.PushResultDto
import com.jifo.app.notes.LocalTagIndex
import com.jifo.app.notes.OfflineMediaRepository
import com.jifo.app.network.MediaAssetDto
import org.json.JSONArray
import org.json.JSONObject
import retrofit2.HttpException
import java.util.UUID

class SyncCoordinator(
    private val db: JifoDatabase,
    private val remote: SyncRemote
) {
    suspend fun runOnce() {
        repairPendingCreateMutations()
        val operations = db.outboxDao().pendingOrFailed()
        for (op in operations) {
            pushOperation(op)
        }
        pullAllPages()
    }

    private suspend fun pushOperation(op: OutboxOperationEntity) {
        try {
            val prepared = preparePendingMedia(op)
            val response = remote.push(SyncDtoMapper.toPushRequest(listOf(prepared)))
            response.results.forEach { result -> applyPushResult(result) }
        } catch (error: HttpException) {
            if (error.code() == 404) {
                handlePushNotFound(op)
            } else {
                throw error
            }
        }
    }

    private suspend fun preparePendingMedia(original: OutboxOperationEntity): OutboxOperationEntity {
        if (original.action == "delete") return original
        var current = original
        val root = runCatching { JSONObject(current.payloadJson) }.getOrNull() ?: return current
        val blocks = root.optJSONObject("content")?.optJSONArray("blocks") ?: return current
        for (index in 0 until blocks.length()) {
            val block = blocks.optJSONObject(index) ?: continue
            if (block.optString("type") != "image" || block.optString("mediaId").isNotBlank()) continue
            val localUrl = block.optString("url")
            val localId = OfflineMediaRepository.localId(localUrl) ?: continue
            val pending = db.pendingMediaDao().get(localId) ?: error("pending media $localId is missing")
            val asset = remote.uploadMedia(pending)
            block.put("mediaId", asset.id).put("url", asset.url)
            val updatedPayload = root.toString()
            db.withTransaction {
                db.outboxDao().updatePayload(current.opId, updatedPayload)
                val note = current.noteId?.let { db.noteDao().getById(it) } ?: db.noteDao().getByClientId(current.clientId)
                if (note != null) {
                    db.noteDao().upsert(note.copy(contentJson = replaceLocalMedia(note.contentJson, localUrl, asset)))
                }
                db.pendingMediaDao().delete(localId)
            }
            current = current.copy(payloadJson = updatedPayload)
        }
        return current
    }

    private fun replaceLocalMedia(contentJson: String, localUrl: String, asset: MediaAssetDto): String {
        val blocks = runCatching { JSONArray(contentJson) }.getOrNull() ?: return contentJson
        for (index in 0 until blocks.length()) {
            val block = blocks.optJSONObject(index) ?: continue
            if (block.optString("type") == "image" && block.optString("url") == localUrl) {
                block.put("mediaId", asset.id).put("url", asset.url)
            }
        }
        return blocks.toString()
    }

    private suspend fun handlePushNotFound(op: OutboxOperationEntity) {
        when (op.action) {
            "update", "restore" -> rescueMissingRemoteUpdate(op)
            "delete" -> db.withTransaction {
                db.outboxDao().deleteByOpId(op.opId)
                op.noteId?.let { id -> db.noteDao().getById(id)?.let { note -> db.noteDao().upsert(note.copy(syncStatus = "SYNCED", lastError = null)) } }
                LocalTagIndex.rebuild(db)
            }
            else -> db.outboxDao().updateStatus(op.opId, "blocked", "note_not_found")
        }
    }

    private suspend fun rescueMissingRemoteUpdate(op: OutboxOperationEntity) {
        val local = op.noteId?.let { db.noteDao().getById(it) } ?: db.noteDao().getByClientId(op.clientId)
        if (local == null) {
            db.outboxDao().updateStatus(op.opId, "blocked", "note_not_found")
            return
        }
        val rescueClientId = "android-note-${UUID.randomUUID()}"
        val rescueOp = OutboxOperationEntity(
            opId = "op-${UUID.randomUUID()}",
            entity = "note",
            action = "create",
            clientId = rescueClientId,
            baseVersion = 0,
            payloadJson = op.payloadJson,
            createdAt = op.createdAt
        )
        db.withTransaction {
            if (local.id != rescueClientId) {
                db.noteDao().deleteById(local.id)
            }
            db.noteDao().upsert(local.copy(id = rescueClientId, clientId = rescueClientId, version = 0, deletedAt = null, syncStatus = "PENDING", lastError = null))
            db.outboxDao().deleteByOpId(op.opId)
            db.outboxDao().insert(rescueOp)
            LocalTagIndex.rebuild(db)
        }
        pushOperation(rescueOp)
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
