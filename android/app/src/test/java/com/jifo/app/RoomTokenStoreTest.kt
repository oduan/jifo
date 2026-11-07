package com.jifo.app

import com.jifo.app.data.local.NoteEntity
import com.jifo.app.data.local.OutboxOperationEntity
import com.jifo.app.data.local.SyncStateEntity
import com.jifo.app.network.AuthResponse
import com.jifo.app.network.UserDto
import com.jifo.app.test.TestDatabaseFactory
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
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

    @Test
    fun sameAccountReloginKeepsCachedNotesOutboxAndCursor() = runTest {
        val db = TestDatabaseFactory.create()
        try {
            val store = RoomTokenStore(db)
            store.save(AuthResponse("access-a", "refresh-a", UserDto("user-a", "a@example.com", "a")), "device")
            db.noteDao().upsert(NoteEntity("note-a", "client-a", "[]", "private", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", 1))
            db.outboxDao().insert(OutboxOperationEntity(opId = "op-a", entity = "note", action = "create", clientId = "client-a", baseVersion = 0, payloadJson = "{}", createdAt = "2026-01-01T00:00:00Z"))
            db.syncStateDao().put(SyncStateEntity("cursor", "cursor-a"))

            store.save(AuthResponse("access-a2", "refresh-a2", UserDto("user-a", "a@example.com", "a")), "device")

            assertEquals("user-a", db.authSessionDao().current()?.userId)
            assertNotNull(db.noteDao().getById("note-a"))
            assertEquals(1, db.outboxDao().pendingOrFailed().size)
            assertEquals("cursor-a", db.syncStateDao().get("cursor")?.value)
        } finally {
            db.close()
        }
    }

    @Test
    fun clearCredentialsInvalidatesTokensAndKeepsSessionRowAndBusinessData() = runTest {
        val db = TestDatabaseFactory.create()
        try {
            val store = RoomTokenStore(db)
            store.save(AuthResponse("access-a", "refresh-a", UserDto("user-a", "a@example.com", "a")), "device")
            db.noteDao().upsert(NoteEntity("note-a", "client-a", "[]", "private", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", 1))
            db.outboxDao().insert(OutboxOperationEntity(opId = "op-a", entity = "note", action = "create", clientId = "client-a", baseVersion = 0, payloadJson = "{}", createdAt = "2026-01-01T00:00:00Z"))
            db.syncStateDao().put(SyncStateEntity("cursor", "cursor-a"))

            store.clearCredentials()

            // 对外表现为已登出（回登录页、请求不带 token）
            assertNull(store.accessToken())
            assertNull(store.refreshToken())
            assertNull(store.current())
            // 但会话行保留：userId/deviceCode 是 save() 判断「是否换号」的依据
            val row = db.authSessionDao().current()!!
            assertEquals("user-a", row.userId)
            assertEquals("device", row.deviceCode)
            assertEquals("", row.accessToken)
            assertNull(row.refreshToken)
            // 本地业务数据原样保留
            assertNotNull(db.noteDao().getById("note-a"))
            assertEquals(1, db.outboxDao().pendingOrFailed().size)
            assertEquals("cursor-a", db.syncStateDao().get("cursor")?.value)
        } finally {
            db.close()
        }
    }

    @Test
    fun reloginSameAccountAfterCredentialClearKeepsBusinessData() = runTest {
        val db = TestDatabaseFactory.create()
        try {
            val store = RoomTokenStore(db)
            store.save(AuthResponse("access-a", "refresh-a", UserDto("user-a", "a@example.com", "a")), "device")
            db.noteDao().upsert(NoteEntity("note-a", "client-a", "[]", "private", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", 1))
            db.outboxDao().insert(OutboxOperationEntity(opId = "op-a", entity = "note", action = "create", clientId = "client-a", baseVersion = 0, payloadJson = "{}", createdAt = "2026-01-01T00:00:00Z"))
            db.syncStateDao().put(SyncStateEntity("cursor", "cursor-a"))

            // 复合场景（审计 High H3 的恢复路径）：refresh 401 → 只清凭证 → 同一账号重新登录
            store.clearCredentials()
            // AuthRepository.login 走 SessionStore.save；deviceCode 由保留的会话行复用
            assertEquals("device", store.deviceCode())
            store.save(AuthResponse("access-a2", "refresh-a2", UserDto("user-a", "a@example.com", "a")), store.deviceCode()!!)

            assertEquals("user-a", store.current()!!.userId)
            assertEquals("access-a2", store.accessToken())
            assertNotNull(db.noteDao().getById("note-a"))
            assertEquals(1, db.outboxDao().pendingOrFailed().size)
            assertEquals("cursor-a", db.syncStateDao().get("cursor")?.value)
        } finally {
            db.close()
        }
    }

    @Test
    fun reloginDifferentAccountAfterCredentialClearStillClearsBusinessData() = runTest {
        val db = TestDatabaseFactory.create()
        try {
            val store = RoomTokenStore(db)
            store.save(AuthResponse("access-a", "refresh-a", UserDto("user-a", "a@example.com", "a")), "device")
            db.noteDao().upsert(NoteEntity("note-a", "client-a", "[]", "private", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", 1))
            db.outboxDao().insert(OutboxOperationEntity(opId = "op-a", entity = "note", action = "create", clientId = "client-a", baseVersion = 0, payloadJson = "{}", createdAt = "2026-01-01T00:00:00Z"))
            db.syncStateDao().put(SyncStateEntity("cursor", "cursor-a"))

            // 换账号仍是清库边界：user-a 的数据不能泄漏给 user-b
            store.clearCredentials()
            store.save(AuthResponse("access-b", "refresh-b", UserDto("user-b", "b@example.com", "b")), "device")

            assertNull(db.noteDao().getById("note-a"))
            assertEquals(emptyList<OutboxOperationEntity>(), db.outboxDao().pendingOrFailed())
            assertNull(db.syncStateDao().get("cursor"))
            assertEquals("user-b", store.current()!!.userId)
        } finally {
            db.close()
        }
    }

    @Test
    fun logoutClearRemovesBusinessDataAndSession() = runTest {
        val db = TestDatabaseFactory.create()
        try {
            val store = RoomTokenStore(db)
            store.save(AuthResponse("access-a", "refresh-a", UserDto("user-a", "a@example.com", "a")), "device")
            db.noteDao().upsert(NoteEntity("note-a", "client-a", "[]", "private", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", 1))
            db.outboxDao().insert(OutboxOperationEntity(opId = "op-a", entity = "note", action = "create", clientId = "client-a", baseVersion = 0, payloadJson = "{}", createdAt = "2026-01-01T00:00:00Z"))
            db.syncStateDao().put(SyncStateEntity("cursor", "cursor-a"))

            store.clear()

            assertNull(db.authSessionDao().current())
            assertNull(store.accessToken())
            assertNull(store.refreshToken())
            assertNull(db.noteDao().getById("note-a"))
            assertEquals(emptyList<OutboxOperationEntity>(), db.outboxDao().pendingOrFailed())
            assertNull(db.syncStateDao().get("cursor"))
        } finally {
            db.close()
        }
    }
}
