package com.jifo.app.data.local

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NoteDaoTest {
    private lateinit var db: JifoDatabase

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            JifoDatabase::class.java
        ).allowMainThreadQueries().build()
    }

    @After fun tearDown() { db.close() }

    @Test fun observesNotesNewestFirstAndSearchesPlainText() = runTest {
        db.noteDao().upsertAll(listOf(
            NoteEntity(id = "1", clientId = "c1", contentJson = "[]", plainText = "苹果 #食物", createdAt = "2026-05-30T01:00:00Z", updatedAt = "2026-05-30T01:00:00Z", version = 1),
            NoteEntity(id = "2", clientId = "c2", contentJson = "[]", plainText = "香蕉 #食物", createdAt = "2026-05-31T01:00:00Z", updatedAt = "2026-05-31T01:00:00Z", version = 1)
        ))

        val rows = db.noteDao().observeNotes(search = "香蕉", tagPath = null, limit = 50).first()

        assertEquals(listOf("2"), rows.map { it.id })
    }

    @Test fun tagFilterMatchesExactTagAndChildrenOnly() = runTest {
        db.noteDao().upsertAll(listOf(
            NoteEntity(id = "exact", clientId = "c1", contentJson = "[]", plainText = "#测试 精准标签", createdAt = "2026-05-31T01:00:00Z", updatedAt = "2026-05-31T01:00:00Z", version = 1),
            NoteEntity(id = "child", clientId = "c2", contentJson = "[]", plainText = "#测试/子标签 子标签", createdAt = "2026-05-31T02:00:00Z", updatedAt = "2026-05-31T02:00:00Z", version = 1),
            NoteEntity(id = "suffix-one", clientId = "c3", contentJson = "[]", plainText = "#测试1 不应该匹配", createdAt = "2026-05-31T03:00:00Z", updatedAt = "2026-05-31T03:00:00Z", version = 1),
            NoteEntity(id = "suffix-three", clientId = "c4", contentJson = "[]", plainText = "#测试三 不应该匹配", createdAt = "2026-05-31T04:00:00Z", updatedAt = "2026-05-31T04:00:00Z", version = 1),
            NoteEntity(id = "newline", clientId = "c5", contentJson = "[]", plainText = "换行后\n#测试", createdAt = "2026-05-31T05:00:00Z", updatedAt = "2026-05-31T05:00:00Z", version = 1)
        ))

        val rows = db.noteDao().observeNotes(search = null, tagPath = "测试", limit = 50).first()

        assertEquals(listOf("newline", "child", "exact"), rows.map { it.id })
    }

    @Test fun searchTreatsLikeWildcardsLiterally() = runTest {
        db.noteDao().upsertAll(listOf(
            NoteEntity(id = "percent", clientId = "c1", contentJson = "[]", plainText = "进度 100% 完成", createdAt = "2026-05-31T01:00:00Z", updatedAt = "2026-05-31T01:00:00Z", version = 1),
            NoteEntity(id = "percent-lookalike", clientId = "c2", contentJson = "[]", plainText = "进度 100x 完成", createdAt = "2026-05-31T02:00:00Z", updatedAt = "2026-05-31T02:00:00Z", version = 1),
            NoteEntity(id = "underscore", clientId = "c3", contentJson = "[]", plainText = "变量 under_score 定义", createdAt = "2026-05-31T03:00:00Z", updatedAt = "2026-05-31T03:00:00Z", version = 1),
            NoteEntity(id = "underscore-lookalike", clientId = "c4", contentJson = "[]", plainText = "变量 underXscore 定义", createdAt = "2026-05-31T04:00:00Z", updatedAt = "2026-05-31T04:00:00Z", version = 1),
            NoteEntity(id = "backslash", clientId = "c5", contentJson = "[]", plainText = "路径 back\\slash 文件", createdAt = "2026-05-31T05:00:00Z", updatedAt = "2026-05-31T05:00:00Z", version = 1)
        ))

        // % _ 是 LIKE 通配符,旧实现会把 "100%" 搜成 "100任意字符"、"under_score" 搜成
        // "under任意字符score",误匹配 lookalike 行;转义后必须按字面匹配。
        assertEquals(listOf("percent"), db.noteDao().observeNotes(search = "%", tagPath = null, limit = 50).first().map { it.id })
        assertEquals(listOf("underscore"), db.noteDao().observeNotes(search = "under_score", tagPath = null, limit = 50).first().map { it.id })
        assertEquals(listOf("backslash"), db.noteDao().observeNotes(search = "back\\slash", tagPath = null, limit = 50).first().map { it.id })
        // 无通配符的常规搜索不受影响:两行都含 "100",按 createdAt 倒序返回
        assertEquals(listOf("percent-lookalike", "percent"), db.noteDao().observeNotes(search = "100", tagPath = null, limit = 50).first().map { it.id })
    }

    @Test fun tagFilterTreatsLikeWildcardsLiterally() = runTest {
        db.noteDao().upsertAll(listOf(
            NoteEntity(id = "literal", clientId = "c1", contentJson = "[]", plainText = "#a_b 字面标签", createdAt = "2026-05-31T01:00:00Z", updatedAt = "2026-05-31T01:00:00Z", version = 1),
            NoteEntity(id = "lookalike", clientId = "c2", contentJson = "[]", plainText = "#axb 不应该匹配", createdAt = "2026-05-31T02:00:00Z", updatedAt = "2026-05-31T02:00:00Z", version = 1)
        ))

        val rows = db.noteDao().observeNotes(search = null, tagPath = "a_b", limit = 50).first()

        assertEquals(listOf("literal"), rows.map { it.id })
    }

    @Test fun outboxOrdersPendingOperationsByLocalSeq() = runTest {
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-2", entity = "note", action = "update", clientId = "c", baseVersion = 1, payloadJson = "{}", createdAt = "2026-05-31T02:00:00Z"))
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-1", entity = "note", action = "create", clientId = "c", baseVersion = 0, payloadJson = "{}", createdAt = "2026-05-31T01:00:00Z"))

        assertEquals(listOf("op-2", "op-1"), db.outboxDao().pendingOrFailed().map { it.opId })
    }
}
