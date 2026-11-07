package com.jifo.app.notes

import com.jifo.app.core.model.NoteBlock
import com.jifo.app.data.local.NoteEntity
import com.jifo.app.test.FakeSyncScheduler
import com.jifo.app.test.FixedClock
import com.jifo.app.test.FixedIdGenerator
import com.jifo.app.test.TestDatabaseFactory
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NotesRepositoryTest {
    private val opened = mutableListOf<com.jifo.app.data.local.JifoDatabase>()

    @org.junit.After fun tearDown() {
        opened.forEach { it.close() }
        opened.clear()
    }

    private fun database() = TestDatabaseFactory.create().also { opened += it }

    @Test fun createNoteWritesLocalNoteAndOutboxInOneOperation() = runTest {
        val db = database()
        val repo = NotesRepository(db, FakeSyncScheduler(), FixedIdGenerator("client-note-1", "op-1"), FixedClock("2026-05-31T09:00:00Z"))

        repo.createNote(listOf(NoteBlock.Paragraph("本地记录 #Android")))

        val notes = db.noteDao().observeNotes(null, null, limit = 50).first()
        val outbox = db.outboxDao().pendingOrFailed()
        assertEquals("本地记录 #Android", notes.single().plainText)
        assertEquals("PENDING", notes.single().syncStatus)
        assertEquals("create", outbox.single().action)
        assertEquals(0, outbox.single().baseVersion)
    }

    @Test fun updateNoteUsesCurrentVersionAsBaseVersion() = runTest {
        val db = database()
        db.noteDao().upsert(NoteEntity(id = "note-1", clientId = "client-1", contentJson = "[]", plainText = "old", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 3))
        val repo = NotesRepository(db, FakeSyncScheduler(), FixedIdGenerator("client-unused", "op-update"), FixedClock("2026-05-31T09:00:00Z"))

        repo.updateNote("note-1", listOf(NoteBlock.Paragraph("new")))

        val note = db.noteDao().getById("note-1")!!
        val op = db.outboxDao().pendingOrFailed().single()
        assertEquals("new", note.plainText)
        assertEquals("PENDING", note.syncStatus)
        assertEquals("update", op.action)
        assertEquals(3, op.baseVersion)
    }

    @Test fun updateUnsyncedCreateCoalescesIntoCreateOutbox() = runTest {
        val db = database()
        val repo = NotesRepository(db, FakeSyncScheduler(), FixedIdGenerator("client-note-1", "op-create"), FixedClock("2026-05-31T09:00:00Z"))

        repo.createNote(listOf(NoteBlock.Paragraph("draft")))
        repo.updateNote("client-note-1", listOf(NoteBlock.Paragraph("edited before sync")))

        val outbox = db.outboxDao().pendingOrFailed()
        val note = db.noteDao().getById("client-note-1")!!
        assertEquals(listOf("create"), outbox.map { it.action })
        assertEquals("edited before sync", note.plainText)
        assertEquals(true, outbox.single().payloadJson.contains("edited before sync"))
    }

    @Test fun deleteUnsyncedCreateRemovesCreateOutboxWithoutInvalidDelete() = runTest {
        val db = database()
        val repo = NotesRepository(db, FakeSyncScheduler(), FixedIdGenerator("client-note-1", "op-create"), FixedClock("2026-05-31T09:00:00Z"))

        repo.createNote(listOf(NoteBlock.Paragraph("draft")))
        repo.deleteNote("client-note-1")

        val note = db.noteDao().getById("client-note-1")!!
        assertNotNull(note.deletedAt)
        assertEquals(emptyList<String>(), db.outboxDao().pendingOrFailed().map { it.action })
    }

    @Test fun deleteNoteMarksLocalDeletedAndQueuesDelete() = runTest {
        val db = database()
        db.noteDao().upsert(NoteEntity(id = "note-1", clientId = "client-1", contentJson = "[]", plainText = "old", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 4))
        val repo = NotesRepository(db, FakeSyncScheduler(), FixedIdGenerator("client-unused", "op-delete"), FixedClock("2026-05-31T09:00:00Z"))

        repo.deleteNote("note-1")

        val note = db.noteDao().getById("note-1")!!
        val op = db.outboxDao().pendingOrFailed().single()
        assertNotNull(note.deletedAt)
        assertEquals("delete", op.action)
        assertEquals(4, op.baseVersion)
    }

    @Test fun undoDeleteRestoresNoteAndRemovesPendingDelete() = runTest {
        val db = database()
        val original = NoteEntity(id = "note-1", clientId = "client-1", contentJson = "[]", plainText = "old", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 4)
        db.noteDao().upsert(original)
        val repo = NotesRepository(db, FakeSyncScheduler(), FixedIdGenerator("client-unused", "op-delete"), FixedClock("2026-05-31T09:00:00Z"))

        repo.deleteNote("note-1")
        repo.undoDeleteNote(original)

        val note = db.noteDao().getById("note-1")!!
        assertEquals(null, note.deletedAt)
        assertEquals("old", note.plainText)
        assertEquals(emptyList<String>(), db.outboxDao().pendingOrFailed().map { it.action })
    }

    @Test fun trashQueryAndRestoreRoundTripQueueRestoreOperation() = runTest {
        val db = database()
        db.noteDao().upsert(NoteEntity(id = "note-1", clientId = "client-1", contentJson = "[{\"type\":\"paragraph\",\"text\":\"old\"}]", plainText = "old", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 4, deletedAt = "2026-05-31T09:00:00Z"))
        val repo = NotesRepository(db, FakeSyncScheduler(), FixedIdGenerator("client-unused", "op-restore"), FixedClock("2026-05-31T10:00:00Z"))

        assertEquals("note-1", repo.observeNotes(null, null, trash = true).first().single().id)
        repo.restoreNote("note-1")

        assertEquals(null, db.noteDao().getById("note-1")!!.deletedAt)
        assertEquals("restore", db.outboxDao().pendingOrFailed().single().action)
        assertEquals("note-1", repo.observeNotes(null, null).first().single().id)
    }

    @Test fun secondOfflineEditMergesIntoPendingUpdateInsteadOfForking() = runTest {
        val db = database()
        db.noteDao().upsert(NoteEntity(id = "note-1", clientId = "client-1", contentJson = "[]", plainText = "v3", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 3))
        val repo = NotesRepository(db, FakeSyncScheduler(), FixedIdGenerator("client-unused", "op-update-2"), FixedClock("2026-05-31T09:00:00Z"))

        repo.updateNote("note-1", listOf(NoteBlock.Paragraph("edit one")))
        repo.updateNote("note-1", listOf(NoteBlock.Paragraph("edit two")))

        // 第二次编辑合并进最早的未推送 update:保留其 baseVersion,不新增 op,
        // 否则过期 baseVersion 会让服务端 fork 伪冲突副本
        val ops = db.outboxDao().pendingOrFailed()
        assertEquals(1, ops.size)
        assertEquals("update", ops.single().action)
        assertEquals(3, ops.single().baseVersion)
        assertEquals(true, ops.single().payloadJson.contains("edit two"))
        assertEquals("edit two", db.noteDao().getById("note-1")!!.plainText)
    }

    @Test fun updateAfterPendingRestoreStaysSeparateOperation() = runTest {
        val db = database()
        db.noteDao().upsert(NoteEntity(id = "note-1", clientId = "client-1", contentJson = "[{\"type\":\"paragraph\",\"text\":\"old\"}]", plainText = "old", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 2, deletedAt = "2026-05-31T08:30:00Z"))
        val repo = NotesRepository(db, FakeSyncScheduler(), FixedIdGenerator("client-unused", "op-update"), FixedClock("2026-05-31T09:00:00Z"))

        repo.restoreNote("note-1")
        repo.updateNote("note-1", listOf(NoteBlock.Paragraph("edited after restore")))

        // 编辑绝不合并进未推送的 restore:RestoreTx 成功路径不消费 payload,合并会让
        // 编辑在推送后的 pull 中被服务端旧内容静默覆盖。保持独立 update op——即便
        // baseVersion 过期,服务端 conflict_copied 也会把编辑以冲突副本形式保留(吵而不丢)。
        val ops = db.outboxDao().pendingOrFailed().sortedBy { it.localSeq }
        assertEquals(listOf("restore", "update"), ops.map { it.action })
        assertEquals(2, ops[0].baseVersion)
        assertEquals(true, ops[0].payloadJson.contains("old"))
        assertEquals(2, ops[1].baseVersion)
        assertEquals(true, ops[1].payloadJson.contains("edited after restore"))
        assertEquals("PENDING", db.noteDao().getById("note-1")!!.syncStatus)
    }

    @Test fun restoreAfterUnpushedDeleteNeedsNoServerOperation() = runTest {
        val db = database()
        db.noteDao().upsert(NoteEntity(id = "note-1", clientId = "client-1", contentJson = "[]", plainText = "v3", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 3))
        val repo = NotesRepository(db, FakeSyncScheduler(), FixedIdGenerator("client-unused", "op-delete"), FixedClock("2026-05-31T09:00:00Z"))

        repo.updateNote("note-1", listOf(NoteBlock.Paragraph("edited")))
        repo.deleteNote("note-1")
        repo.restoreNote("note-1")

        // 删除尚未推送,服务端仍是 active:撤销删除不需要服务端操作,
        // 只剩未推送的内容变更(update),其 baseVersion 仍然有效
        val ops = db.outboxDao().pendingOrFailed()
        assertEquals(listOf("update"), ops.map { it.action })
        assertEquals(3, ops.single().baseVersion)
        assertEquals(null, db.noteDao().getById("note-1")!!.deletedAt)
        assertEquals("PENDING", db.noteDao().getById("note-1")!!.syncStatus)
    }

    @Test fun undoDeleteAfterDeleteAlreadyPushedQueuesRestoreOperation() = runTest {
        val db = database()
        val original = NoteEntity(id = "note-1", clientId = "client-1", contentJson = "[{\"type\":\"paragraph\",\"text\":\"old\"}]", plainText = "old", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 4, deletedAt = "2026-05-31T09:00:00Z")
        db.noteDao().upsert(original)
        val repo = NotesRepository(db, FakeSyncScheduler(), FixedIdGenerator("client-unused", "op-restore"), FixedClock("2026-05-31T10:00:00Z"))

        // outbox 已无 pending delete(删除已推送):只改本地行是假成功,必须补 restore op
        repo.undoDeleteNote(original)

        val op = db.outboxDao().pendingOrFailed().single()
        assertEquals("restore", op.action)
        assertEquals("note-1", op.noteId)
        assertEquals("client-1", op.clientId)
        assertEquals(4, op.baseVersion)
        assertEquals(true, op.payloadJson.contains("old"))
        val note = db.noteDao().getById("note-1")!!
        assertEquals(null, note.deletedAt)
        assertEquals("PENDING", note.syncStatus)
    }
}
