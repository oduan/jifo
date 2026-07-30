package com.jifo.app

import com.jifo.app.data.local.NoteEntity
import com.jifo.app.data.local.OutboxOperationEntity
import com.jifo.app.data.local.SyncStateEntity
import com.jifo.app.network.AuthResponse
import com.jifo.app.network.UserDto
import com.jifo.app.test.TestDatabaseFactory
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RoomTokenStoreTest {
    @Test
    fun changingAccountsClearsCachedNotesOutboxAndCursor() = runTest {
        val db = TestDatabaseFactory.create()
        try {
            val store = RoomTokenStore(db)
            store.save(AuthResponse("access-a", "refresh-a", UserDto("user-a", "a@example.com", "a")), "device")
            db.noteDao().upsert(NoteEntity("note-a", "client-a", "[]", "private", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", 1))
            db.outboxDao().insert(OutboxOperationEntity(opId = "op-a", entity = "note", action = "create", clientId = "client-a", baseVersion = 0, payloadJson = "{}", createdAt = "2026-01-01T00:00:00Z"))
            db.syncStateDao().put(SyncStateEntity("cursor", "cursor-a"))

            store.save(AuthResponse("access-b", "refresh-b", UserDto("user-b", "b@example.com", "b")), "device")

            assertNull(db.noteDao().getById("note-a"))
            assertEquals(emptyList<OutboxOperationEntity>(), db.outboxDao().pendingOrFailed())
            assertNull(db.syncStateDao().get("cursor"))
            assertEquals("user-b", store.current()!!.userId)
        } finally {
            db.close()
        }
    }
}
