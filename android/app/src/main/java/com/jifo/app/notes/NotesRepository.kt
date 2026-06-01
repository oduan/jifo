package com.jifo.app.notes

import androidx.room.withTransaction
import com.jifo.app.core.id.IdGenerator
import com.jifo.app.core.model.NoteBlock
import com.jifo.app.core.model.toPlainText
import com.jifo.app.core.time.Clock
import com.jifo.app.data.local.JifoDatabase
import com.jifo.app.data.local.NoteEntity
import com.jifo.app.data.local.OutboxOperationEntity
import com.jifo.app.sync.SyncScheduler
import kotlinx.coroutines.flow.map

class NotesRepository(
    private val db: JifoDatabase,
    private val syncScheduler: SyncScheduler,
    private val idGenerator: IdGenerator,
    private val clock: Clock
) {
    fun observeNotes(search: String?, tagPath: String?, limit: Int = 50) = db.noteDao()
        .observeNotes(search?.takeIf { it.isNotBlank() }, tagPath?.takeIf { it.isNotBlank() }, limit.coerceAtLeast(1))
        .map { it }

    suspend fun getNote(id: String): NoteEntity? = db.noteDao().getById(id)

    suspend fun createNote(blocks: List<NoteBlock>) {
        val clientId = idGenerator.newClientId("android-note")
        val opId = idGenerator.newOpId()
        val now = clock.nowIso()
        val plainText = blocks.toPlainText()
        db.withTransaction {
            db.noteDao().upsert(NoteEntity(
                id = clientId,
                clientId = clientId,
                contentJson = NoteJson.encodeBlocks(blocks),
                plainText = plainText,
                createdAt = now,
                updatedAt = now,
                version = 0,
                syncStatus = "PENDING"
            ))
            db.outboxDao().insert(OutboxOperationEntity(
                opId = opId,
                entity = "note",
                action = "create",
                clientId = clientId,
                baseVersion = 0,
                payloadJson = NoteJson.encodePayload(blocks, plainText),
                createdAt = now
            ))
            LocalTagIndex.rebuild(db)
        }
        syncScheduler.scheduleNow()
    }

    suspend fun updateNote(id: String, blocks: List<NoteBlock>) {
        val current = db.noteDao().getById(id) ?: return
        val opId = idGenerator.newOpId()
        val now = clock.nowIso()
        val plainText = blocks.toPlainText()
        val payloadJson = NoteJson.encodePayload(blocks, plainText)
        db.withTransaction {
            db.noteDao().upsert(current.copy(
                contentJson = NoteJson.encodeBlocks(blocks),
                plainText = plainText,
                updatedAt = now,
                syncStatus = "PENDING",
                lastError = null
            ))
            val pendingCreate = db.outboxDao().pendingCreateForClient(current.clientId)
            if (pendingCreate != null) {
                db.outboxDao().updatePayload(pendingCreate.opId, payloadJson)
                db.outboxDao().deletePendingMutationsForClient(current.clientId)
            } else {
                db.outboxDao().insert(OutboxOperationEntity(
                    opId = opId,
                    entity = "note",
                    action = "update",
                    noteId = id,
                    clientId = current.clientId,
                    baseVersion = current.version,
                    payloadJson = payloadJson,
                    createdAt = now
                ))
            }
            LocalTagIndex.rebuild(db)
        }
        syncScheduler.scheduleNow()
    }

    suspend fun deleteNote(id: String) {
        val current = db.noteDao().getById(id) ?: return
        val opId = idGenerator.newOpId()
        val now = clock.nowIso()
        db.withTransaction {
            db.noteDao().upsert(current.copy(deletedAt = now, updatedAt = now, syncStatus = "PENDING"))
            val pendingCreate = db.outboxDao().pendingCreateForClient(current.clientId)
            if (pendingCreate != null) {
                db.outboxDao().deletePendingCreateForClient(current.clientId)
                db.outboxDao().deletePendingMutationsForClient(current.clientId)
            } else {
                db.outboxDao().insert(OutboxOperationEntity(
                    opId = opId,
                    entity = "note",
                    action = "delete",
                    noteId = id,
                    clientId = current.clientId,
                    baseVersion = current.version,
                    payloadJson = "{}",
                    createdAt = now
                ))
            }
            LocalTagIndex.rebuild(db)
        }
        syncScheduler.scheduleNow()
    }

    suspend fun undoDeleteNote(snapshot: NoteEntity) {
        val now = clock.nowIso()
        db.withTransaction {
            db.outboxDao().deletePendingDeleteForNote(snapshot.id, snapshot.clientId)
            db.noteDao().upsert(snapshot.copy(deletedAt = null, updatedAt = now, syncStatus = if (snapshot.version > 0) "SYNCED" else "PENDING", lastError = null))
            if (snapshot.version == 0L && db.outboxDao().pendingCreateForClient(snapshot.clientId) == null) {
                db.outboxDao().insert(OutboxOperationEntity(
                    opId = idGenerator.newOpId(),
                    entity = "note",
                    action = "create",
                    clientId = snapshot.clientId,
                    baseVersion = 0,
                    payloadJson = NoteJson.encodePayload(listOf(NoteBlock.Paragraph(snapshot.plainText)), snapshot.plainText),
                    createdAt = now
                ))
            }
            LocalTagIndex.rebuild(db)
        }
        if (snapshot.version == 0L) syncScheduler.scheduleNow()
    }
}
