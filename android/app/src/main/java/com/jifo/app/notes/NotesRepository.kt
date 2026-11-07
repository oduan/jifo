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
    fun observeNotes(search: String?, tagPath: String?, limit: Int = 50, trash: Boolean = false) = db.noteDao()
        .observeNotes(search?.takeIf { it.isNotBlank() }, tagPath?.takeIf { it.isNotBlank() }, limit.coerceAtLeast(1), trash)
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
                // 连续离线编辑合并进最早的未推送 update:第二条编辑若带着相同(已
                // 过期)的 baseVersion 入队,服务端必 fork 伪冲突副本,一条笔记变两条。
                // 覆盖 payload、保留原 baseVersion、清零失败计数,与 pendingCreate 合并
                // 一致。刻意不合并进 pending restore:RestoreTx 成功路径不消费 payload
                // 内容,合并会让本次编辑在推送后的 pull 中被服务端旧内容静默覆盖;
                // 保持独立 update op,baseVersion 过期时服务端 conflict_copied 会把
                // 编辑以冲突副本形式保留(吵而不丢)。
                val pendingUpdate = db.outboxDao().pendingUpdateForClient(current.clientId)
                if (pendingUpdate != null) {
                    db.outboxDao().updatePayload(pendingUpdate.opId, payloadJson)
                    db.outboxDao().deletePendingUpdatesForClientExcept(current.clientId, pendingUpdate.opId)
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
        var scheduleSync = false
        db.withTransaction {
            val removedPendingDelete = db.outboxDao().deletePendingDeleteForNote(snapshot.id, snapshot.clientId)
            // 服务端已知该笔记(version>0)而删除已推送(outbox 已无 pending delete)时,
            // 只改本地行是假成功:几十秒后的 pull 会把它拖回回收站。必须补 restore op,
            // 让服务端一并恢复。恢复期间行保持 PENDING,pull 不会用服务端的回收站状态覆盖它。
            var restoreQueued = false
            if (snapshot.version > 0L && removedPendingDelete == 0) {
                if (db.outboxDao().pendingRestoreForClient(snapshot.clientId) == null) {
                    db.outboxDao().insert(OutboxOperationEntity(
                        opId = idGenerator.newOpId(),
                        entity = "note",
                        action = "restore",
                        noteId = snapshot.id,
                        clientId = snapshot.clientId,
                        baseVersion = snapshot.version,
                        payloadJson = NoteJson.encodePayload(NoteJson.decodeBlocks(snapshot.contentJson), snapshot.plainText),
                        createdAt = now
                    ))
                }
                restoreQueued = true
                scheduleSync = true
            }
            db.noteDao().upsert(snapshot.copy(
                deletedAt = null,
                updatedAt = now,
                syncStatus = when {
                    snapshot.version == 0L || restoreQueued -> "PENDING"
                    // 仍有未推送的内容变更时保持 PENDING,防止 pull 用服务端旧内容
                    // 覆盖待推送的编辑。
                    db.outboxDao().pendingMutationForClient(snapshot.clientId) != null -> "PENDING"
                    else -> "SYNCED"
                },
                lastError = null
            ))
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
                scheduleSync = true
            }
            LocalTagIndex.rebuild(db)
        }
        if (scheduleSync) syncScheduler.scheduleNow()
    }

    suspend fun restoreNote(id: String) {
        val current = db.noteDao().getById(id) ?: return
        if (current.deletedAt == null) return
        val now = clock.nowIso()
        val payloadJson = NoteJson.encodePayload(NoteJson.decodeBlocks(current.contentJson), current.plainText)
        var scheduleSync = false
        db.withTransaction {
            val removedPendingDelete = db.outboxDao().deletePendingDeleteForNote(current.id, current.clientId)
            var syncStatus: String
            when {
                // 删除尚未推送:服务端仍是 active 且内容与本地一致,无需任何服务端恢复
                // 操作;若还有未推送的内容变更则行保持 PENDING(防 pull 覆盖待推编辑),
                // 否则直接 SYNCED(置 PENDING 而不排队会让该行永远跳过 pull)。
                removedPendingDelete > 0 -> syncStatus =
                    if (db.outboxDao().pendingMutationForClient(current.clientId) != null) "PENDING" else "SYNCED"
                // 从未推送过的笔记服务端不存在,restore 必被服务端拒绝;按 undoDelete
                // 的既有做法补 create,让恢复后的笔记走 create 通道正常同步
                // (create 尚在时,其 payload 已携带同样内容,无需任何新操作)。
                current.version == 0L -> {
                    if (db.outboxDao().pendingCreateForClient(current.clientId) == null) {
                        db.outboxDao().insert(OutboxOperationEntity(
                            opId = idGenerator.newOpId(),
                            entity = "note",
                            action = "create",
                            noteId = null,
                            clientId = current.clientId,
                            baseVersion = 0,
                            payloadJson = payloadJson,
                            createdAt = now
                        ))
                    }
                    syncStatus = "PENDING"
                    scheduleSync = true
                }
                else -> {
                    // 已有未推送的 restore 时判重,不重复插入。不把恢复内容合并进
                    // update op:服务端对回收站笔记的 update 必拒(ErrNoteNotFound),
                    // undelete 必须由独立 restore op 完成。
                    if (db.outboxDao().pendingRestoreForClient(current.clientId) == null) {
                        db.outboxDao().insert(OutboxOperationEntity(
                            opId = idGenerator.newOpId(),
                            entity = "note",
                            action = "restore",
                            noteId = current.id,
                            clientId = current.clientId,
                            baseVersion = current.version,
                            payloadJson = payloadJson,
                            createdAt = now
                        ))
                    }
                    syncStatus = "PENDING"
                    scheduleSync = true
                }
            }
            db.noteDao().upsert(current.copy(deletedAt = null, updatedAt = now, syncStatus = syncStatus, lastError = null))
            LocalTagIndex.rebuild(db)
        }
        if (scheduleSync) syncScheduler.scheduleNow()
    }
}
