package com.jifo.app.sync

import com.jifo.app.data.local.NoteEntity
import com.jifo.app.data.local.OutboxOperationEntity
import com.jifo.app.network.*
import com.jifo.app.test.TestDatabaseFactory
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SyncCoordinatorTest {
    private val opened = mutableListOf<com.jifo.app.data.local.JifoDatabase>()
    @After fun tearDown() { opened.forEach { it.close() }; opened.clear() }
    private fun database() = TestDatabaseFactory.create().also { opened += it }

    @Test fun createdPushReplacesTemporaryLocalIdAndClearsOutbox() = runTest {
        val db = database()
        db.noteDao().upsert(NoteEntity(id = "client-1", clientId = "client-1", contentJson = "[]", plainText = "hello", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 0, syncStatus = "PENDING"))
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-1", entity = "note", action = "create", clientId = "client-1", baseVersion = 0, payloadJson = "{}", createdAt = "2026-05-31T09:00:00Z"))
        val api = FakeSyncApi(pushResults = listOf(PushResultDto("op-1", "created", "11111111-1111-1111-1111-111111111111", 1)), pullNotes = emptyList())
        val sync = SyncCoordinator(db, api)

        sync.runOnce()

        assertNull(db.outboxDao().getByOpId("op-1"))
        assertNull(db.noteDao().getById("client-1"))
        val synced = db.noteDao().getById("11111111-1111-1111-1111-111111111111")
        assertNotNull(synced)
        assertEquals("SYNCED", synced!!.syncStatus)
        assertEquals(1, synced.version)
    }

    @Test fun pullLoopsUntilAllPagesAreFetched() = runTest {
        val db = database()
        val api = FakeSyncApi(
            pushResults = emptyList(),
            pullNotes = listOf(
                ApiNoteDto(id = "11111111-1111-1111-1111-111111111111", clientId = "client-1", plainText = "first", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 1),
                ApiNoteDto(id = "22222222-2222-2222-2222-222222222222", clientId = "client-2", plainText = "second", createdAt = "2026-05-31T09:00:00Z", updatedAt = "2026-05-31T09:00:00Z", version = 1)
            )
        )
        val sync = SyncCoordinator(db, api)

        sync.runOnce()

        assertEquals(3, api.pullCalls.size)
        assertNotNull(db.noteDao().getById("11111111-1111-1111-1111-111111111111"))
        assertNotNull(db.noteDao().getById("22222222-2222-2222-2222-222222222222"))
    }

    @Test fun legacyInvalidUpdateForPendingCreateIsMergedBeforePush() = runTest {
        val db = database()
        db.noteDao().upsert(NoteEntity(id = "android-note-local", clientId = "android-note-local", contentJson = "[]", plainText = "edited", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T09:00:00Z", version = 0, syncStatus = "PENDING"))
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-create", entity = "note", action = "create", clientId = "android-note-local", baseVersion = 0, payloadJson = """{"content":{"blocks":[{"type":"paragraph","text":"draft"}]},"plainText":"draft"}""", createdAt = "2026-05-31T08:00:00Z"))
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-update", entity = "note", action = "update", noteId = "android-note-local", clientId = "android-note-local", baseVersion = 0, payloadJson = """{"content":{"blocks":[{"type":"paragraph","text":"edited"}]},"plainText":"edited"}""", createdAt = "2026-05-31T09:00:00Z"))
        val api = FakeSyncApi(pushResults = listOf(PushResultDto("op-create", "created", "11111111-1111-1111-1111-111111111111", 1)), pullNotes = emptyList())
        val sync = SyncCoordinator(db, api)

        sync.runOnce()

        assertEquals(listOf("op-create"), api.pushedOpIds)
        assertNull(db.outboxDao().getByOpId("op-update"))
        assertNull(db.outboxDao().getByOpId("op-create"))
    }

    @Test fun conflictCopiedClearsOutboxAndDoesNotOverwriteOriginalNote() = runTest {
        val db = database()
        val noteId = "11111111-1111-1111-1111-111111111111"
        db.noteDao().upsert(NoteEntity(id = noteId, clientId = "client-1", contentJson = "[]", plainText = "远端原始", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 2))
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-1", entity = "note", action = "update", noteId = noteId, clientId = "client-1", baseVersion = 1, payloadJson = "{}", createdAt = "2026-05-31T09:00:00Z"))
        val api = FakeSyncApi(pushResults = listOf(PushResultDto("op-1", "conflict_copied", "conflict-1", 3)), pullNotes = emptyList())
        val sync = SyncCoordinator(db, api)

        sync.runOnce()

        assertNull(db.outboxDao().getByOpId("op-1"))
        assertEquals("远端原始", db.noteDao().getById(noteId)!!.plainText)
    }
}
