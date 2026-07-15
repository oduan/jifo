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
}
