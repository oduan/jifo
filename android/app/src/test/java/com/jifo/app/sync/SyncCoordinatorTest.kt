package com.jifo.app.sync

import com.jifo.app.data.local.NoteEntity
import com.jifo.app.data.local.OutboxOperationEntity
import com.jifo.app.data.local.PendingMediaEntity
import com.jifo.app.data.local.AuthSessionEntity
import com.jifo.app.network.*
import com.jifo.app.notes.LocalTagIndex
import com.jifo.app.test.TestDatabaseFactory
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import okhttp3.ResponseBody.Companion.toResponseBody
import retrofit2.HttpException
import retrofit2.Response
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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

    @Test fun missingRemoteUpdateIsRescuedAsCreateAndDoesNotBlockOutbox() = runTest {
        val db = database()
        val oldId = "ec5a954d-b3de-419f-95b3-dc0cee91e5bc"
        db.noteDao().upsert(NoteEntity(id = oldId, clientId = "web-note-old", contentJson = "[]", plainText = "edited stale note", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-06-01T02:24:04Z", version = 1, syncStatus = "PENDING"))
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-stale-update", entity = "note", action = "update", noteId = oldId, clientId = "web-note-old", baseVersion = 1, payloadJson = """{"content":{"blocks":[{"type":"paragraph","text":"edited stale note"}]},"plainText":"edited stale note"}""", createdAt = "2026-06-01T02:24:04Z"))
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-new-create", entity = "note", action = "create", clientId = "android-note-new", baseVersion = 0, payloadJson = """{"content":{"blocks":[{"type":"paragraph","text":"new note"}]},"plainText":"new note"}""", createdAt = "2026-06-01T02:25:00Z"))
        val remote = object : SyncRemote {
            val pushedActions = mutableListOf<String>()
            override suspend fun push(body: SyncPushRequest): SyncPushResponse {
                val op = body.operations.single()
                pushedActions += op.action
                if (op.opId == "op-stale-update") throw HttpException(Response.error<String>(404, "{}".toResponseBody()))
                return SyncPushResponse(listOf(PushResultDto(op.opId, "created", "11111111-1111-1111-1111-111111111111", 1)))
            }
            override suspend fun pull(updatedAt: String?, id: String?, limit: Int): SyncPullResponse = SyncPullResponse()
            override suspend fun uploadMedia(media: PendingMediaEntity): MediaAssetDto = error("unexpected upload")
        }
        val sync = SyncCoordinator(db, remote)

        sync.runOnce()

        assertEquals(listOf("update", "create", "create"), remote.pushedActions)
        assertEquals(emptyList<String>(), db.outboxDao().pendingOrFailed().map { it.action })
        assertNull(db.noteDao().getById(oldId))
        assertNotNull(db.noteDao().getById("11111111-1111-1111-1111-111111111111"))
    }

    @Test fun conflictCopiedRemapsPendingLocalEditSoPullCanRestoreOriginal() = runTest {
        val db = database()
        val noteId = "11111111-1111-1111-1111-111111111111"
        db.noteDao().upsert(NoteEntity(id = noteId, clientId = "client-1", contentJson = "[]", plainText = "本地冲突编辑", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 2, syncStatus = "PENDING"))
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-1", entity = "note", action = "update", noteId = noteId, clientId = "client-1", baseVersion = 1, payloadJson = "{}", createdAt = "2026-05-31T09:00:00Z"))
        val api = FakeSyncApi(pushResults = listOf(PushResultDto("op-1", "conflict_copied", "conflict-1", 3)), pullNotes = emptyList())
        val sync = SyncCoordinator(db, api)

        sync.runOnce()

        assertNull(db.outboxDao().getByOpId("op-1"))
        assertEquals("SYNCED", db.noteDao().getById(noteId)!!.syncStatus)
        assertEquals("SYNCED", db.noteDao().getById("conflict-1")!!.syncStatus)
        assertEquals("本地冲突编辑", db.noteDao().getById("conflict-1")!!.plainText)
    }

    @Test fun alreadyTrashedIsSettledAsIdempotentSuccess() = runTest {
        val db = database()
        val noteId = "11111111-1111-1111-1111-111111111111"
        db.noteDao().upsert(NoteEntity(id = noteId, clientId = "client-1", contentJson = "[]", plainText = "deleted", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 1, deletedAt = "2026-05-31T09:00:00Z", syncStatus = "PENDING"))
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-delete", entity = "note", action = "delete", noteId = noteId, clientId = "client-1", baseVersion = 1, payloadJson = "{}", createdAt = "2026-05-31T09:00:00Z"))

        SyncCoordinator(db, FakeSyncApi(listOf(PushResultDto("op-delete", "already_trashed", noteId, 2)), emptyList())).runOnce()

        assertNull(db.outboxDao().getByOpId("op-delete"))
        assertEquals("SYNCED", db.noteDao().getById(noteId)!!.syncStatus)
        assertEquals(2, db.noteDao().getById(noteId)!!.version)
    }

    @Test fun permanentTombstoneRemovesLocalNoteAndPendingMutation() = runTest {
        val db = database()
        val noteId = "11111111-1111-1111-1111-111111111111"
        db.noteDao().upsert(NoteEntity(id = noteId, clientId = "client-1", contentJson = "[]", plainText = "stale", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 1))
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-update", entity = "note", action = "update", noteId = noteId, clientId = "client-1", baseVersion = 1, payloadJson = "{}", createdAt = "2026-05-31T09:00:00Z", status = "blocked"))
        val tombstone = ApiNoteDto(id = noteId, clientId = "client-1", permanentlyDeletedAt = "2026-06-01T00:00:00Z", updatedAt = "2026-06-01T00:00:00Z", version = 2)

        SyncCoordinator(db, FakeSyncApi(emptyList(), listOf(tombstone))).runOnce()

        assertNull(db.noteDao().getById(noteId))
        assertNull(db.outboxDao().getByOpId("op-update"))
    }

    @Test fun accountChangeDuringPullCannotWritePreviousAccountResponse() = runTest {
        val db = database()
        db.authSessionDao().save(AuthSessionEntity(accessToken = "token-a", refreshToken = "refresh-a", userJson = null, deviceCode = "device", userId = "user-a"))
        val staleNoteId = "33333333-3333-3333-3333-333333333333"
        val remote = object : SyncRemote {
            override suspend fun push(body: SyncPushRequest): SyncPushResponse = SyncPushResponse()
            override suspend fun uploadMedia(media: PendingMediaEntity): MediaAssetDto = error("unexpected upload")
            override suspend fun pull(updatedAt: String?, id: String?, limit: Int): SyncPullResponse {
                db.authSessionDao().save(AuthSessionEntity(accessToken = "token-b", refreshToken = "refresh-b", userJson = null, deviceCode = "device", userId = "user-b"))
                return SyncPullResponse(notes = listOf(ApiNoteDto(id = staleNoteId, clientId = "old-account-note", plainText = "stale", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 1)))
            }
        }

        var accountChanged = false
        try {
            SyncCoordinator(db, remote).runOnce()
        } catch (_: SyncAccountChangedException) {
            accountChanged = true
        }

        assertTrue(accountChanged)
        assertNull(db.noteDao().getById(staleNoteId))
    }

    @Test fun pendingImageIsUploadedAndRewrittenBeforeNotePush() = runTest {
        val db = database()
        val localId = "local-image-1"
        val localUrl = "local-media://$localId"
        val content = """[{"type":"paragraph","text":"offline"},{"type":"image","url":"$localUrl","alt":"photo.jpg"}]"""
        val payload = """{"content":{"blocks":[{"type":"paragraph","text":"offline"},{"type":"image","url":"$localUrl","alt":"photo.jpg"}]},"plainText":"offline"}"""
        db.pendingMediaDao().put(PendingMediaEntity(localId, byteArrayOf(1, 2, 3), "image/jpeg", "photo.jpg", "2026-05-31T08:00:00Z"))
        db.noteDao().upsert(NoteEntity(id = "client-1", clientId = "client-1", contentJson = content, plainText = "offline", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 0, syncStatus = "PENDING"))
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-1", entity = "note", action = "create", clientId = "client-1", baseVersion = 0, payloadJson = payload, createdAt = "2026-05-31T08:00:00Z"))
        val api = FakeSyncApi(listOf(PushResultDto("op-1", "created", "11111111-1111-1111-1111-111111111111", 1)), emptyList())

        SyncCoordinator(db, api).runOnce()

        assertEquals(listOf(localId), api.uploadedMediaIds)
        val pushedImage = api.pushedBodies.single().operations.single().payload["content"] as Map<*, *>
        val blocks = pushedImage["blocks"] as List<*>
        assertEquals("media-$localId", (blocks[1] as Map<*, *>)["mediaId"])
        assertNull(db.pendingMediaDao().get(localId))
        assertEquals(true, db.noteDao().getById("11111111-1111-1111-1111-111111111111")!!.contentJson.contains("media-$localId"))
    }

    @Test fun rejectedOperationIsBlockedAndDoesNotBlockFollowingOpsOrPull() = runTest {
        val db = database()
        db.noteDao().upsert(NoteEntity(id = "client-1", clientId = "client-1", contentJson = "[]", plainText = "poison", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 1, syncStatus = "PENDING"))
        db.noteDao().upsert(NoteEntity(id = "client-2", clientId = "client-2", contentJson = "[]", plainText = "fresh", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 0, syncStatus = "PENDING"))
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-1", entity = "note", action = "update", noteId = "11111111-1111-1111-1111-111111111111", clientId = "client-1", baseVersion = 1, payloadJson = "{}", createdAt = "2026-05-31T09:00:00Z"))
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-2", entity = "note", action = "create", clientId = "client-2", baseVersion = 0, payloadJson = "{}", createdAt = "2026-05-31T09:01:00Z"))
        val remote = object : SyncRemote {
            val pushedOpIds = mutableListOf<String>()
            override suspend fun push(body: SyncPushRequest): SyncPushResponse {
                val op = body.operations.single()
                pushedOpIds += op.opId
                if (op.opId == "op-1") throw HttpException(Response.error<String>(422, "{}".toResponseBody()))
                return SyncPushResponse(listOf(PushResultDto(op.opId, "created", "22222222-2222-2222-2222-222222222222", 1)))
            }
            override suspend fun pull(updatedAt: String?, id: String?, limit: Int): SyncPullResponse = SyncPullResponse(
                notes = listOf(ApiNoteDto(id = "33333333-3333-3333-3333-333333333333", clientId = "remote-1", plainText = "pulled", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 1))
            )
            override suspend fun uploadMedia(media: PendingMediaEntity): MediaAssetDto = error("unexpected upload")
        }

        SyncCoordinator(db, remote).runOnce()

        // 422 的操作被标记 blocked,不再被 pendingOrFailed 捞起
        val blocked = db.outboxDao().getByOpId("op-1")!!
        assertEquals("blocked", blocked.status)
        assertEquals("push_rejected_422", blocked.lastError)
        // 后续操作照常推送,本轮 pull 照常执行
        assertEquals(listOf("op-1", "op-2"), remote.pushedOpIds)
        assertNull(db.outboxDao().getByOpId("op-2"))
        assertNotNull(db.noteDao().getById("22222222-2222-2222-2222-222222222222"))
        assertNotNull(db.noteDao().getById("33333333-3333-3333-3333-333333333333"))
    }

    @Test fun unexpectedOperationFailureIsCountedAndDoesNotBlockOutbox() = runTest {
        val db = database()
        db.noteDao().upsert(NoteEntity(id = "client-2", clientId = "client-2", contentJson = "[]", plainText = "fresh", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 0, syncStatus = "PENDING"))
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-1", entity = "note", action = "update", noteId = "11111111-1111-1111-1111-111111111111", clientId = "client-1", baseVersion = 1, payloadJson = "{}", createdAt = "2026-05-31T09:00:00Z"))
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-2", entity = "note", action = "create", clientId = "client-2", baseVersion = 0, payloadJson = "{}", createdAt = "2026-05-31T09:01:00Z"))
        val remote = object : SyncRemote {
            override suspend fun push(body: SyncPushRequest): SyncPushResponse {
                val op = body.operations.single()
                if (op.opId == "op-1") throw IllegalStateException("boom")
                return SyncPushResponse(listOf(PushResultDto(op.opId, "created", "22222222-2222-2222-2222-222222222222", 1)))
            }
            override suspend fun pull(updatedAt: String?, id: String?, limit: Int): SyncPullResponse = SyncPullResponse(
                notes = listOf(ApiNoteDto(id = "33333333-3333-3333-3333-333333333333", clientId = "remote-1", plainText = "pulled", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 1))
            )
            override suspend fun uploadMedia(media: PendingMediaEntity): MediaAssetDto = error("unexpected upload")
        }

        SyncCoordinator(db, remote).runOnce()

        // 非 HTTP 异常按瞬时失败计数,等待下轮重试,而不是让整轮 runOnce 崩掉
        val failed = db.outboxDao().getByOpId("op-1")!!
        assertEquals("failed", failed.status)
        assertEquals(1, failed.retryCount)
        assertEquals("IllegalStateException:boom", failed.lastError)
        assertNull(db.outboxDao().getByOpId("op-2"))
        assertNotNull(db.noteDao().getById("22222222-2222-2222-2222-222222222222"))
        assertNotNull(db.noteDao().getById("33333333-3333-3333-3333-333333333333"))
    }

    @Test fun repeatedPushFailuresAreBlockedAfterRetryLimit() = runTest {
        val db = database()
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-1", entity = "note", action = "update", noteId = "11111111-1111-1111-1111-111111111111", clientId = "client-1", baseVersion = 1, payloadJson = "{}", createdAt = "2026-05-31T09:00:00Z"))
        val remote = object : SyncRemote {
            var pushCalls = 0
            override suspend fun push(body: SyncPushRequest): SyncPushResponse {
                pushCalls++
                throw HttpException(Response.error<String>(500, "{}".toResponseBody()))
            }
            override suspend fun pull(updatedAt: String?, id: String?, limit: Int): SyncPullResponse = SyncPullResponse()
            override suspend fun uploadMedia(media: PendingMediaEntity): MediaAssetDto = error("unexpected upload")
        }
        val sync = SyncCoordinator(db, remote)

        repeat(8) { attempt ->
            sync.runOnce()
            val op = db.outboxDao().getByOpId("op-1")!!
            assertEquals("failed", op.status)
            assertEquals(attempt + 1, op.retryCount)
        }
        // 第 9 次失败超过上限 8:转 blocked,不再被捞起、不再重试
        sync.runOnce()
        val blocked = db.outboxDao().getByOpId("op-1")!!
        assertEquals("blocked", blocked.status)
        assertEquals(8, blocked.retryCount)
        assertEquals(true, blocked.lastError!!.startsWith("retries_exhausted:"))
        assertEquals(emptyList<String>(), db.outboxDao().pendingOrFailed().map { it.opId })
        sync.runOnce()
        assertEquals(9, remote.pushCalls)
    }

    @Test fun missingPendingMediaIsStrippedFromPayloadAndPushContinues() = runTest {
        val db = database()
        val localUrl = "local-media://gone"
        val content = """[{"type":"paragraph","text":"keep"},{"type":"image","url":"$localUrl"},{"type":"divider"}]"""
        val payload = """{"content":{"blocks":[{"type":"paragraph","text":"keep"},{"type":"image","url":"$localUrl"},{"type":"divider"}]},"plainText":"keep"}"""
        db.noteDao().upsert(NoteEntity(id = "client-1", clientId = "client-1", contentJson = content, plainText = "keep", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 0, syncStatus = "PENDING"))
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-1", entity = "note", action = "create", clientId = "client-1", baseVersion = 0, payloadJson = payload, createdAt = "2026-05-31T08:00:00Z"))
        val api = FakeSyncApi(listOf(PushResultDto("op-1", "created", "11111111-1111-1111-1111-111111111111", 1)), emptyList())

        SyncCoordinator(db, api).runOnce()

        // 丢失的 image block 被剥离,其余内容照常推送
        val pushedBlocks = (api.pushedBodies.single().operations.single().payload["content"] as Map<*, *>)["blocks"] as List<*>
        assertEquals(2, pushedBlocks.size)
        assertEquals("paragraph", (pushedBlocks[0] as Map<*, *>)["type"])
        assertEquals("divider", (pushedBlocks[1] as Map<*, *>)["type"])
        // 操作照常结算成功,而不是抛异常卡死整轮同步
        assertNull(db.outboxDao().getByOpId("op-1"))
        assertNotNull(db.noteDao().getById("11111111-1111-1111-1111-111111111111"))
    }

    @Test fun missingPendingMediaStrippedPayloadIsPersistedForRetries() = runTest {
        val db = database()
        val localUrl = "local-media://gone"
        val content = """[{"type":"paragraph","text":"keep"},{"type":"image","url":"$localUrl"},{"type":"divider"}]"""
        val payload = """{"content":{"blocks":[{"type":"paragraph","text":"keep"},{"type":"image","url":"$localUrl"},{"type":"divider"}]},"plainText":"keep"}"""
        db.noteDao().upsert(NoteEntity(id = "client-1", clientId = "client-1", contentJson = content, plainText = "keep", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 0, syncStatus = "PENDING"))
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-1", entity = "note", action = "create", clientId = "client-1", baseVersion = 0, payloadJson = payload, createdAt = "2026-05-31T08:00:00Z"))
        val remote = object : SyncRemote {
            val pushedBlockCounts = mutableListOf<Int>()
            override suspend fun push(body: SyncPushRequest): SyncPushResponse {
                val op = body.operations.single()
                val blocks = (op.payload["content"] as Map<*, *>)["blocks"] as List<*>
                pushedBlockCounts += blocks.size
                throw HttpException(Response.error<String>(500, "{}".toResponseBody()))
            }
            override suspend fun pull(updatedAt: String?, id: String?, limit: Int): SyncPullResponse = SyncPullResponse()
            override suspend fun uploadMedia(media: PendingMediaEntity): MediaAssetDto = error("unexpected upload")
        }
        val sync = SyncCoordinator(db, remote)

        sync.runOnce()

        // 推送失败时 op 仍在:剥离结果必须已落回 op 行,payload 不再引用缺失媒体
        val op = db.outboxDao().getByOpId("op-1")!!
        assertEquals("failed", op.status)
        assertEquals(1, op.retryCount)
        assertEquals(false, op.payloadJson.contains(localUrl))
        assertEquals(listOf(2), remote.pushedBlockCounts)

        sync.runOnce()

        // 第二轮基于落库的剥离 payload 重推:不再触达缺失媒体,推送体同样不含图
        val retried = db.outboxDao().getByOpId("op-1")!!
        assertEquals(2, retried.retryCount)
        assertEquals(false, retried.payloadJson.contains(localUrl))
        assertEquals(listOf(2, 2), remote.pushedBlockCounts)
    }

    @Test fun allRequestLevelRejectionCodesBlockTheOperation() = runTest {
        for (code in listOf(400, 409, 413, 422)) {
            val db = database()
            db.outboxDao().insert(OutboxOperationEntity(opId = "op-$code", entity = "note", action = "update", noteId = "11111111-1111-1111-1111-111111111111", clientId = "client-1", baseVersion = 1, payloadJson = "{}", createdAt = "2026-05-31T09:00:00Z"))
            val remote = object : SyncRemote {
                override suspend fun push(body: SyncPushRequest): SyncPushResponse = throw HttpException(Response.error<String>(code, "{}".toResponseBody()))
                override suspend fun pull(updatedAt: String?, id: String?, limit: Int): SyncPullResponse = SyncPullResponse()
                override suspend fun uploadMedia(media: PendingMediaEntity): MediaAssetDto = error("unexpected upload")
            }

            SyncCoordinator(db, remote).runOnce()

            val blocked = db.outboxDao().getByOpId("op-$code")!!
            assertEquals("blocked", blocked.status)
            assertEquals("push_rejected_$code", blocked.lastError)
        }
    }

    @Test fun authFailuresDoNotConsumeRetryBudget() = runTest {
        val db = database()
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-1", entity = "note", action = "update", noteId = "11111111-1111-1111-1111-111111111111", clientId = "client-1", baseVersion = 1, payloadJson = "{}", createdAt = "2026-05-31T09:00:00Z"))
        val remote = object : SyncRemote {
            var pushCalls = 0
            override suspend fun push(body: SyncPushRequest): SyncPushResponse {
                pushCalls++
                throw HttpException(Response.error<String>(401, "{}".toResponseBody()))
            }
            override suspend fun pull(updatedAt: String?, id: String?, limit: Int): SyncPullResponse = SyncPullResponse()
            override suspend fun uploadMedia(media: PendingMediaEntity): MediaAssetDto = error("unexpected upload")
        }
        val sync = SyncCoordinator(db, remote)

        // 登出窗口内反复 401:失败留痕但绝不消耗重试预算,不会把离线编辑打成
        // 不可复活的 blocked,重新登录后可正常推送
        repeat(9) { sync.runOnce() }

        val op = db.outboxDao().getByOpId("op-1")!!
        assertEquals("failed", op.status)
        assertEquals(0, op.retryCount)
        assertEquals("push_http_401", op.lastError)
        assertEquals(9, remote.pushCalls)
        assertEquals(listOf("op-1"), db.outboxDao().pendingOrFailed().map { it.opId })
    }

    // ---- (M6b)LocalTagIndex 重建削减:逐页/逐结果事务内不再 rebuild,
    // 收敛为 push 循环末一次 + pull 循环末一次(pull 侧无条件,保留每轮自愈) ----

    @Test fun multiPagePullRebuildsTagIndexOnlyOnceAfterAllPages() = runTest {
        val db = database()
        val api = FakeSyncApi(
            pushResults = emptyList(),
            pullNotes = listOf(
                ApiNoteDto(id = "11111111-1111-1111-1111-111111111111", clientId = "client-1", plainText = "#alpha 第一页", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 1),
                ApiNoteDto(id = "22222222-2222-2222-2222-222222222222", clientId = "client-2", plainText = "#beta 第二页", createdAt = "2026-05-31T09:00:00Z", updatedAt = "2026-05-31T09:00:00Z", version = 1)
            )
        )
        var rebuildCalls = 0
        LocalTagIndex.rebuildObserver = { rebuildCalls += 1 }
        try {
            SyncCoordinator(db, api).runOnce()
        } finally {
            LocalTagIndex.rebuildObserver = null
        }

        // 两页数据 + 一页空收尾(与 pullLoopsUntilAllPagesAreFetched 相同的分页轨迹):
        // 原实现每页事务内各 rebuild 一次,现在整轮 pull 结束后只 rebuild 一次
        assertEquals(3, api.pullCalls.size)
        assertEquals(1, rebuildCalls)
        // 唯一一次 rebuild 发生在全部页写库之后:两页的标签都进入索引
        assertEquals(listOf("alpha", "beta"), db.tagDao().observeTags().first().map { it.path })
    }

    @Test fun pushResultsRebuildTagIndexOnlyOnceAfterTheWholePushLoop() = runTest {
        val db = database()
        db.noteDao().upsert(NoteEntity(id = "client-1", clientId = "client-1", contentJson = "[]", plainText = "#one", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 0, syncStatus = "PENDING"))
        db.noteDao().upsert(NoteEntity(id = "client-2", clientId = "client-2", contentJson = "[]", plainText = "#two", createdAt = "2026-05-31T08:01:00Z", updatedAt = "2026-05-31T08:01:00Z", version = 0, syncStatus = "PENDING"))
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-1", entity = "note", action = "create", clientId = "client-1", baseVersion = 0, payloadJson = "{}", createdAt = "2026-05-31T09:00:00Z"))
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-2", entity = "note", action = "create", clientId = "client-2", baseVersion = 0, payloadJson = "{}", createdAt = "2026-05-31T09:01:00Z"))
        val api = FakeSyncApi(
            pushResults = listOf(
                PushResultDto("op-1", "created", "11111111-1111-1111-1111-111111111111", 1),
                PushResultDto("op-2", "created", "22222222-2222-2222-2222-222222222222", 1)
            ),
            pullNotes = emptyList()
        )
        var rebuildCalls = 0
        LocalTagIndex.rebuildObserver = { rebuildCalls += 1 }
        try {
            SyncCoordinator(db, api).runOnce()
        } finally {
            LocalTagIndex.rebuildObserver = null
        }

        // 两次 push、各 applyPushResult 两次,push 阶段也只在循环结束后 rebuild 一次;
        // pull 阶段无条件重建一次(自愈语义),合计 2 次。旧实现此处为 5 次
        // (每个 push 结果事务内各一次 ×4 + pull 页事务一次)。
        assertEquals(2, api.pushedOpIds.size)
        assertEquals(2, rebuildCalls)
        assertEquals(listOf("one", "two"), db.tagDao().observeTags().first().map { it.path })
    }

    @Test fun emptySyncRoundStillRebuildsTagIndexOnce() = runTest {
        val db = database()
        db.noteDao().upsert(NoteEntity(id = "note-1", clientId = "client-1", contentJson = "[]", plainText = "#keep", createdAt = "2026-05-31T08:00:00Z", updatedAt = "2026-05-31T08:00:00Z", version = 1))
        val api = FakeSyncApi(pushResults = emptyList(), pullNotes = emptyList())
        var rebuildCalls = 0
        LocalTagIndex.rebuildObserver = { rebuildCalls += 1 }
        try {
            SyncCoordinator(db, api).runOnce()
        } finally {
            LocalTagIndex.rebuildObserver = null
        }

        // 无推送操作、无拉取变更,pull 阶段仍无条件重建一次:这是与旧实现一致的自愈
        // 语义——任意一轮 runOnce 都至少把索引追平到当前 notes 表一次,上一轮若在
        // "页已提交、重建未跑"之间被打断,下一轮空轮也能修复,索引不会长期滞后。
        assertEquals(1, api.pullCalls.size)
        assertEquals(1, rebuildCalls)
    }
}
